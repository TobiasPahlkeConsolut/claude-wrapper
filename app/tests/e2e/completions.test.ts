/**
 * End-to-end tests that drive a REAL Claude CLI completion through the full
 * HTTP stack (no mocks). Unlike the integration suite — which mocks the CLI at
 * the resolver boundary — these verify that an actual completion works: request
 * in, real `claude` invocation, OpenAI-shaped response out, including live SSE
 * streaming and the tool-carrying (buffered) path.
 *
 * They require the `claude` CLI to be installed and authenticated, so the whole
 * suite auto-skips when it isn't present — keeping the run green on machines
 * (and future CI) without the CLI.
 */

import request from 'supertest';
import { execSync } from 'child_process';
import { createServer } from '../../src/api/server';

function claudeAvailable(): boolean {
  try {
    const out = execSync('claude --version', { stdio: 'pipe', timeout: 8000 }).toString().toLowerCase();
    return out.includes('claude') || out.includes('anthropic') || /\d+\.\d+/.test(out);
  } catch {
    return false;
  }
}

// Collect a streamed SSE response into a single string (supertest buffers it).
const collectSSE = (res: any, cb: (err: Error | null, body: string) => void) => {
  let data = '';
  res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
  res.on('end', () => cb(null, data));
};

const CLAUDE_PRESENT = claudeAvailable();
const suite = CLAUDE_PRESENT ? describe : describe.skip;

if (!CLAUDE_PRESENT) {
  // eslint-disable-next-line no-console
  console.error('[e2e] Skipping real-CLI completion tests: `claude` not found on PATH.');
}

suite('E2E: real Claude CLI completions', () => {
  let app: any;

  beforeAll(() => {
    app = createServer();
  });

  it('returns a non-streaming chat completion with real content', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'haiku',
        messages: [{ role: 'user', content: 'Reply with exactly one word: ping' }],
      })
      .expect(200);

    expect(res.body.object).toBe('chat.completion');
    const content = res.body.choices?.[0]?.message?.content;
    expect(typeof content).toBe('string');
    expect(content.length).toBeGreaterThan(0);
  }, 60000);

  it('streams a chat completion as SSE and terminates with [DONE]', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'haiku',
        stream: true,
        messages: [{ role: 'user', content: 'Reply with exactly one word: ping' }],
      })
      .buffer(true)
      .parse(collectSSE)
      .expect(200);

    const body = res.body as unknown as string;
    expect(body).toContain('chat.completion.chunk');
    expect(body).toContain('"content"'); // at least one text delta
    expect(body.trimEnd().endsWith('[DONE]')).toBe(true);
  }, 60000);

  it('streams a tool-carrying request to completion without erroring', async () => {
    // Tool requests take the buffered path: the wrapper emits either a single
    // tool_calls chunk or plain text, then [DONE] — never a half-open stream.
    // Whether the model actually calls the tool is nondeterministic, so we only
    // assert the stream is well-formed and terminates.
    const tools = [
      {
        type: 'function',
        function: {
          name: 'get_time',
          description: 'Get the current time',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];

    const res = await request(app)
      .post('/v1/chat/completions')
      .send({
        model: 'haiku',
        stream: true,
        tools,
        messages: [{ role: 'user', content: 'What time is it? Use the get_time tool.' }],
      })
      .buffer(true)
      .parse(collectSSE)
      .expect(200);

    const body = res.body as unknown as string;
    expect(body).toContain('chat.completion.chunk');
    expect(body.trimEnd().endsWith('[DONE]')).toBe(true);
  }, 60000);
});
