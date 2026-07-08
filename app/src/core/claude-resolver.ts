import { exec, spawn } from 'child_process';
import * as readline from 'readline';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { IClaudeResolver, ClaudeStreamEvent, OpenAIUsage } from '../types';
import { ClaudeCliError, TimeoutError } from '../utils/errors';
import { logger } from '../utils/logger';
import { EnvironmentManager } from '../config/env';

const execAsync = promisify(exec);

export class ClaudeResolver implements IClaudeResolver {
  private claudeCommand: string | null = null;

  async findClaudeCommand(): Promise<string> {
    if (this.claudeCommand) {
      return this.claudeCommand;
    }

    const config = EnvironmentManager.getConfig();
    if (config.claudeCommand) {
      logger.debug('Using Claude command from config', { command: config.claudeCommand });
      this.claudeCommand = config.claudeCommand;
      return config.claudeCommand;
    }

    // Try PATH resolution - covers npm global installs and aliases
    const pathCommands = [
      // Interactive shells (handles aliases)
      'bash -i -c "which claude"',
      'zsh -i -c "which claude"',

      // Direct PATH lookups (handles npm global installs)
      'command -v claude',
      'which claude',

      // Docker detection disabled for performance — probing these actually
      // launches a container (with a 2s timeout each) on every startup.
      // 'docker run --rm anthropic/claude --version',
      // 'podman run --rm anthropic/claude --version'
    ];
    
    // Windows-specific commands
    if (process.platform === 'win32') {
      pathCommands.push(
        'where claude',
        'powershell -c "Get-Command claude -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source"'
      );
    }

    for (const pathCmd of pathCommands) {
      try {
        logger.debug('Trying PATH resolution', { command: pathCmd });
        const { stdout } = await execAsync(pathCmd, { timeout: 2000 });
        const claudePath = stdout.trim();
        
        if (claudePath && !claudePath.includes('not found')) {
          // Clean up shell prompt output that might be mixed in
          const cleanedPath = claudePath.replace(/\]633;[^;]*;[^;]*;[^;]*;[^;]*]/g, '').trim();
          
          // Handle different command types
          let actualPath = cleanedPath;
          logger.debug('Processing Claude path detection', { claudePath: cleanedPath, pathCmd });
          
          // Docker command handling disabled for performance (detection above
          // no longer probes Docker/podman).
          // if (pathCmd.includes('docker run') || pathCmd.includes('podman run')) {
          //   // For Docker, the full command is the "path"
          //   actualPath = pathCmd.replace(' --version', '');
          //   logger.debug('Parsed Docker command', { actualPath });
          // }
          // Handle shell alias output
          if (cleanedPath.includes(': aliased to ')) {
            const splitPath = cleanedPath.split(': aliased to ')[1];
            actualPath = splitPath ? splitPath.trim() : cleanedPath;
            logger.debug('Parsed alias', { actualPath });
          } else if (cleanedPath.includes('aliased to ')) {
            const splitPath = cleanedPath.split('aliased to ')[1];
            actualPath = splitPath ? splitPath.trim() : cleanedPath;
            logger.debug('Parsed alias', { actualPath });
          } else {
            logger.debug('Using path as-is', { actualPath });
          }
          // Verify it works
          const testResult = await this.testClaudeCommand(actualPath);
          if (testResult) {
            logger.info('Found Claude via PATH resolution', { path: actualPath, original: claudePath });
            this.claudeCommand = actualPath;
            return actualPath;
          }
        }
      } catch (error) {
        logger.debug('PATH resolution failed', { command: pathCmd, error });
        continue;
      }
    }


    // Try environment variables as fallback
    const envVars = [
      process.env['CLAUDE_COMMAND'],
      process.env['CLAUDE_CLI_PATH'],
      // Docker-based fallbacks disabled for performance:
      // process.env['CLAUDE_DOCKER_IMAGE'] ? `docker run --rm ${process.env['CLAUDE_DOCKER_IMAGE']}` : undefined,
      // process.env['DOCKER_CLAUDE_CMD']
    ].filter(Boolean) as string[];

    for (const envPath of envVars) {
      try {
        logger.debug('Trying environment variable path', { path: envPath });
        const isWorking = await this.testClaudeCommand(envPath);
        
        if (isWorking) {
          logger.info('Found Claude via environment variable', { path: envPath });
          this.claudeCommand = envPath;
          return envPath;
        }
      } catch (error) {
        logger.debug('Environment path failed', { 
          path: envPath, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
        continue;
      }
    }


    // No more guessing - fail clearly if not found
    throw new ClaudeCliError(
      'Claude CLI not found. Please either:\n' +
      '1. Install Claude CLI: npm install -g @anthropic-ai/claude\n' +
      '2. Use Docker: docker pull anthropic/claude\n' +
      '3. Ensure \'claude\' is in your PATH\n' +
      '4. Set CLAUDE_COMMAND environment variable with the correct path\n' +
      '\nSupported detection methods:\n' +
      '- npm global installs (recommended)\n' +
      '- Docker containers (docker run anthropic/claude)\n' +
      '- Shell aliases (bash, zsh)\n' +
      '- Environment variables (CLAUDE_COMMAND, CLAUDE_CLI_PATH, CLAUDE_DOCKER_IMAGE, etc.)'
    );
  }

  async executeClaudeCommand(prompt: string, model: string): Promise<string> {
    return this.executeClaudeCommandWithSession(prompt, model, null, false);
  }

  async executeClaudeCommandWithSession(
    prompt: string,
    model: string,
    sessionId: string | null,
    useJsonOutput: boolean,
    systemPrompt?: string | null
  ): Promise<string> {
    const claudeCmd = await this.findClaudeCommand();
    const config = EnvironmentManager.getConfig();

    // Build command flags. This wrapper is a text/JSON completion backend -
    // the caller (VS Code, etc.) owns tool execution and expects it back via
    // our tool_calls JSON convention. Without --tools "", Claude Code tries to
    // actually invoke tools/MCP servers itself using its own (separate,
    // often-unreachable-from-here) session config, producing confusing
    // "No such tool available" narration instead of an answer. --safe-mode
    // additionally skips CLAUDE.md/MCP/plugins/hooks so a request isn't
    // shaped by whatever happens to be configured in this process's cwd.
    let flags = `--print --model ${model} --safe-mode --tools ""`;

    // Add session flag if provided
    if (sessionId) {
      flags += ` --resume ${sessionId}`;
    }

    // Add JSON output flag if requested
    if (useJsonOutput) {
      flags += ` --output-format json`;
    }

    let command: string;

    // The prompt is passed to the CLI via stdin, redirected from a temp file
    // rather than inlined as `echo '<prompt>' | ...`. Inlining puts the whole
    // prompt on the shell command line, which blows past the ~8191 character
    // limit cmd.exe imposes on Windows for long prompts (e.g. IDE context).
    const tempFile = path.join(os.tmpdir(), `claude-wrapper-prompt-${crypto.randomUUID()}.txt`);
    await fs.promises.writeFile(tempFile, prompt, 'utf-8');

    // --system-prompt-file replaces Claude Code's own default identity/system
    // prompt outright (same file-based approach, same reason: avoids the
    // command-line length limit for long IDE-supplied system prompts). Without
    // this, the CLI keeps its baked-in "I'm Claude Code" identity, which then
    // conflicts with - and can refuse - whatever persona the caller asked for.
    let systemPromptFile: string | null = null;
    if (systemPrompt) {
      systemPromptFile = path.join(os.tmpdir(), `claude-wrapper-system-${crypto.randomUUID()}.txt`);
      await fs.promises.writeFile(systemPromptFile, systemPrompt, 'utf-8');
      flags += ` --system-prompt-file "${systemPromptFile}"`;
    }

    // Docker command handling disabled for performance (Docker detection is
    // no longer attempted, so claudeCmd is never a docker/podman invocation).
    // if (claudeCmd.includes('docker run') || claudeCmd.includes('podman run')) {
    //   // For Docker, we need to modify the container command
    //   const dockerCommand = claudeCmd + ` ${flags}`;
    //   command = `${dockerCommand} < "${tempFile}"`;
    // }
    // Handle bash -c wrapped commands
    if (claudeCmd.includes('bash -c')) {
      command = `${claudeCmd.replace('"claude"', `"claude ${flags}"`)} < "${tempFile}"`;
    }
    // Handle regular commands
    else {
      command = `"${claudeCmd}" ${flags} < "${tempFile}"`;
    }

    logger.debug('Executing Claude command with session', {
      model,
      promptLength: prompt.length,
      sessionId,
      useJsonOutput,
      hasSystemPrompt: !!systemPrompt,
      isDocker: claudeCmd.includes('docker') || claudeCmd.includes('podman')
    });

    try {
      const { stdout, stderr } = await execAsync(command, {
        maxBuffer: 1024 * 1024 * 10,
        timeout: config.timeout
      });

      if (stderr && stderr.trim()) {
        logger.warn('Claude CLI warning', { stderr: stderr.trim() });
      }

      logger.debug('Claude command completed successfully');
      return stdout.trim();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Claude CLI execution failed', error as Error);

      if (errorMessage.includes('timeout')) {
        throw new TimeoutError(`Claude CLI execution timed out after ${config.timeout}ms`);
      }

      throw new ClaudeCliError(`Claude CLI execution failed: ${errorMessage}`);
    } finally {
      await fs.promises.unlink(tempFile).catch(() => {});
      if (systemPromptFile) {
        await fs.promises.unlink(systemPromptFile).catch(() => {});
      }
    }
  }

  /**
   * Stream a Claude completion token-by-token.
   *
   * Unlike executeClaudeCommandWithSession (which uses a buffered `exec` and
   * only returns once the whole answer is ready), this spawns the CLI with
   * `--output-format stream-json --include-partial-messages` and forwards each
   * text delta as the model produces it. The prompt is written to the child's
   * stdin and args are passed as an array (no shell), so there's no command
   * line length limit and no shell-metacharacter interpretation of `model`.
   *
   * Only text_delta content is forwarded; the CLI also emits thinking/signature
   * deltas which the buffered path already discards, so we skip them here for
   * parity. A final 'done' event carries the real token usage from the CLI's
   * `result` event.
   *
   * Assumes the resolved command is a directly-spawnable executable (the normal
   * case: an npm-global bin or a `where claude` path). Shell-wrapped commands
   * are not supported on the streaming path; callers fall back to the buffered
   * path for tool requests, which is where any such exotic setup would surface.
   */
  async *executeClaudeCommandStreaming(
    prompt: string,
    model: string,
    systemPrompt?: string | null
  ): AsyncGenerator<ClaudeStreamEvent, void, unknown> {
    const claudeCmd = await this.findClaudeCommand();
    const config = EnvironmentManager.getConfig();

    let systemPromptFile: string | null = null;
    if (systemPrompt) {
      systemPromptFile = path.join(os.tmpdir(), `claude-wrapper-system-${crypto.randomUUID()}.txt`);
      await fs.promises.writeFile(systemPromptFile, systemPrompt, 'utf-8');
    }

    // Same completion flags as the buffered path (see executeClaudeCommandWithSession
    // for why --safe-mode --tools "" are required), plus the streaming output format.
    const args = [
      '--print',
      '--model', model,
      '--safe-mode',
      '--tools', '',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
    ];
    if (systemPromptFile) {
      args.push('--system-prompt-file', systemPromptFile);
    }

    logger.debug('Streaming Claude command', {
      model,
      promptLength: prompt.length,
      hasSystemPrompt: !!systemPrompt,
    });

    const child = spawn(claudeCmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    // If the child dies before we finish writing, stdin emits EPIPE; swallow it
    // so it doesn't crash the process (the close handler surfaces the real error).
    child.stdin.on('error', () => {});
    child.stdin.write(prompt);
    child.stdin.end();

    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, config.timeout);
    const exitPromise = new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code));
    });

    const rl = readline.createInterface({ input: child.stdout });

    let finishReason: 'stop' | 'length' | 'tool_calls' = 'stop';
    let usage: OpenAIUsage | undefined;
    let sawResult = false;

    try {
      for await (const line of rl) {
        if (!line.trim()) continue;

        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          continue; // non-JSON line (shouldn't happen with stream-json, but be safe)
        }

        if (event.type === 'stream_event' && event.event) {
          const inner = event.event;
          if (inner.type === 'content_block_delta' && inner.delta?.type === 'text_delta') {
            const text: string = inner.delta.text ?? '';
            if (text) {
              yield { type: 'text', text };
            }
          } else if (inner.type === 'message_delta' && inner.delta?.stop_reason) {
            finishReason = this.mapStopReason(inner.delta.stop_reason);
          }
        } else if (event.type === 'result') {
          sawResult = true;
          if (event.is_error) {
            throw new ClaudeCliError(
              `Claude CLI returned an error: ${event.subtype || event.api_error_status || 'unknown'}`
            );
          }
          if (event.usage) {
            usage = this.mapUsage(event.usage);
          }
        }
      }

      const code = await exitPromise;
      clearTimeout(timer);

      if (timedOut) {
        throw new TimeoutError(`Claude CLI execution timed out after ${config.timeout}ms`);
      }
      if (code !== 0 && !sawResult) {
        throw new ClaudeCliError(
          `Claude CLI exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`
        );
      }
      if (stderr.trim()) {
        logger.warn('Claude CLI warning (streaming)', { stderr: stderr.trim() });
      }

      yield { type: 'done', finishReason, ...(usage && { usage }) };
    } finally {
      clearTimeout(timer);
      rl.close();
      if (!child.killed) {
        child.kill();
      }
      if (systemPromptFile) {
        await fs.promises.unlink(systemPromptFile).catch(() => {});
      }
    }
  }

  private mapStopReason(reason: string): 'stop' | 'length' | 'tool_calls' {
    if (reason === 'max_tokens') return 'length';
    return 'stop';
  }

  private mapUsage(u: any): OpenAIUsage {
    const cacheReadTokens = u.cache_read_input_tokens || 0;
    const cacheCreationTokens = u.cache_creation_input_tokens || 0;
    const uncachedInputTokens = u.input_tokens || 0;
    const promptTokens = uncachedInputTokens + cacheReadTokens + cacheCreationTokens;
    const completionTokens = u.output_tokens || 0;

    // Prompt-cache visibility. The Claude CLI caches a stable prompt prefix and
    // reports how much of this turn's input it served from cache. A healthy hit
    // ratio across a conversation means the prefix (system prompt, tools, earlier
    // turns) is staying byte-stable; a persistent 0 across similar requests means
    // something at the front of the prompt is churning per-request and busting
    // the cache. (Expected 0 on the first turn - that request writes the cache.)
    if (promptTokens > 0) {
      logger.debug('Claude prompt-cache usage', {
        cacheReadTokens,
        cacheCreationTokens,
        uncachedInputTokens,
        cacheHitRatio: Number((cacheReadTokens / promptTokens).toFixed(3)),
      });
    }

    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    };
  }

  private async testClaudeCommand(command: string): Promise<boolean> {
    try {
      const testCmd = `${command} --version`;
      const { stdout, stderr } = await execAsync(testCmd, { timeout: 3000 });
      const output = (stdout + stderr).toLowerCase();
      
      // Check for Claude CLI indicators
      return output.includes('claude') || 
             output.includes('anthropic') ||
             output.includes('@anthropic-ai');
    } catch (error) {
      logger.debug('Command test failed', { 
        command, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return false;
    }
  }

}