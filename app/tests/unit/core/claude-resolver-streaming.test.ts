/**
 * Tests for ClaudeResolver.executeClaudeCommandStreaming (the streaming path).
 *
 * This is the primary runtime path for IDE/tool traffic — it spawns the `claude`
 * CLI with `--output-format stream-json`, parses the newline-delimited events,
 * and yields text / done events. It also exercises the private mapStopReason and
 * mapUsage helpers (including the prompt-cache token accounting). It was almost
 * entirely uncovered by unit tests, so this file drives it end-to-end with a
 * fake child process feeding scripted stream-json lines.
 */

import { EventEmitter } from 'events';
import { Readable } from 'stream';

// spawn is what the streaming path uses; exec is only touched by findClaudeCommand,
// which we short-circuit below by setting claudeCommand in config.
jest.mock('child_process', () => ({ exec: jest.fn(), spawn: jest.fn() }));
import { spawn } from 'child_process';

import { ClaudeResolver } from '../../../src/core/claude-resolver';
import { ClaudeCliError, TimeoutError } from '../../../src/utils/errors';
import { ClaudeStreamEvent } from '../../../src/types';

jest.mock('../../../src/utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../../src/config/env', () => ({
  EnvironmentManager: {
    getConfig: jest.fn(() => ({ port: 3000, timeout: 30000, claudeCommand: 'claude', logLevel: 'info' })),
  },
}));

const mockSpawn = spawn as unknown as jest.Mock;
const getConfig = require('../../../src/config/env').EnvironmentManager.getConfig as jest.Mock;

interface FakeChildOptions {
  lines?: string[];
  code?: number;
  stderr?: string;
  autoClose?: boolean; // false → stdout stays open until kill() (for the timeout path)
}

/**
 * Build a ChildProcess-like object whose stdout emits the given stream-json
 * lines. When autoClose is true it ends on its own and emits 'close'; when
 * false it hangs until kill() is called (kill ends stdout and emits 'close',
 * mirroring a real process being terminated on timeout).
 */
function makeChild({ lines = [], code = 0, stderr = '', autoClose = true }: FakeChildOptions = {}): any {
  const child: any = new EventEmitter();
  const stdout = new Readable({ read() {} });
  child.stdout = stdout;
  child.stderr = new EventEmitter();
  child.stdin = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
  child.killed = false;

  const finish = () => {
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    process.nextTick(() => child.emit('close', code));
  };

  child.kill = jest.fn(() => {
    child.killed = true;
    stdout.push(null);
    finish();
  });

  for (const line of lines) stdout.push(line + '\n');
  if (autoClose) {
    stdout.push(null);
    stdout.on('end', finish);
  }
  return child;
}

// stream-json line builders
const textDelta = (text: string) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
const thinkingDelta = (thinking: string) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking } } });
const stopReason = (reason: string) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: reason } } });
const result = (usage?: any, isError = false, extra: any = {}) =>
  JSON.stringify({ type: 'result', is_error: isError, ...(usage && { usage }), ...extra });

async function collect(gen: AsyncGenerator<ClaudeStreamEvent>): Promise<ClaudeStreamEvent[]> {
  const events: ClaudeStreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe('ClaudeResolver.executeClaudeCommandStreaming', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getConfig.mockReturnValue({ port: 3000, timeout: 30000, claudeCommand: 'claude', logLevel: 'info' });
  });

  it('streams text deltas in order and ends with a done event', async () => {
    mockSpawn.mockReturnValue(makeChild({ lines: [textDelta('Hello'), textDelta(' world'), result()] }));

    const resolver = new ClaudeResolver();
    const events = await collect(resolver.executeClaudeCommandStreaming('hi', 'sonnet'));

    expect(events).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'done', finishReason: 'stop' },
    ]);
    // Prompt is piped to the child via stdin.
    const child = mockSpawn.mock.results[0]!.value;
    expect(child.stdin.write).toHaveBeenCalledWith('hi');
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it('maps CLI usage (including cache tokens) onto the done event', async () => {
    const usage = {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 50,
    };
    mockSpawn.mockReturnValue(makeChild({ lines: [textDelta('x'), result(usage)] }));

    const resolver = new ClaudeResolver();
    const events = await collect(resolver.executeClaudeCommandStreaming('hi', 'sonnet'));

    const done = events.find((e) => e.type === 'done') as any;
    // prompt_tokens = input + cache_read + cache_creation = 100 + 900 + 50
    expect(done.usage).toEqual({ prompt_tokens: 1050, completion_tokens: 20, total_tokens: 1070 });
  });

  it('maps stop_reason max_tokens to finishReason "length"', async () => {
    mockSpawn.mockReturnValue(makeChild({ lines: [stopReason('max_tokens'), result()] }));

    const resolver = new ClaudeResolver();
    const events = await collect(resolver.executeClaudeCommandStreaming('hi', 'sonnet'));

    expect((events.find((e) => e.type === 'done') as any).finishReason).toBe('length');
  });

  it('does not forward non-text deltas (e.g. thinking)', async () => {
    mockSpawn.mockReturnValue(makeChild({ lines: [thinkingDelta('reasoning...'), textDelta('answer'), result()] }));

    const resolver = new ClaudeResolver();
    const events = await collect(resolver.executeClaudeCommandStreaming('hi', 'sonnet'));

    const texts = events.filter((e) => e.type === 'text');
    expect(texts).toEqual([{ type: 'text', text: 'answer' }]);
  });

  it('ignores non-JSON lines instead of crashing', async () => {
    mockSpawn.mockReturnValue(makeChild({ lines: ['not json at all', '', textDelta('ok'), result()] }));

    const resolver = new ClaudeResolver();
    const events = await collect(resolver.executeClaudeCommandStreaming('hi', 'sonnet'));

    expect(events.filter((e) => e.type === 'text')).toEqual([{ type: 'text', text: 'ok' }]);
  });

  it('throws ClaudeCliError when the result event reports is_error', async () => {
    mockSpawn.mockReturnValue(makeChild({ lines: [result(undefined, true, { subtype: 'error_max_turns' })] }));

    const resolver = new ClaudeResolver();
    await expect(collect(resolver.executeClaudeCommandStreaming('hi', 'sonnet'))).rejects.toThrow(ClaudeCliError);
  });

  it('throws ClaudeCliError (with stderr) on a non-zero exit and no result event', async () => {
    mockSpawn.mockReturnValue(makeChild({ lines: [], code: 1, stderr: 'boom' }));

    const resolver = new ClaudeResolver();
    await expect(collect(resolver.executeClaudeCommandStreaming('hi', 'sonnet'))).rejects.toThrow(/code 1|boom/);
  });

  it('throws TimeoutError and kills the child when the CLI exceeds the timeout', async () => {
    getConfig.mockReturnValue({ port: 3000, timeout: 25, claudeCommand: 'claude', logLevel: 'info' });
    const child = makeChild({ autoClose: false }); // never ends on its own
    mockSpawn.mockReturnValue(child);

    const resolver = new ClaudeResolver();
    await expect(collect(resolver.executeClaudeCommandStreaming('hi', 'sonnet'))).rejects.toThrow(TimeoutError);
    expect(child.kill).toHaveBeenCalled();
  });
});
