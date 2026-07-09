import { ClaudeRequest, IClaudeClient, ClaudeStreamEvent } from '../types';
import { ClaudeResolver } from './claude-resolver';
import { ClaudeCliError } from '../utils/errors';
import { logger } from '../utils/logger';

export class ClaudeClient implements IClaudeClient {
  private resolver: ClaudeResolver;

  constructor() {
    this.resolver = new ClaudeResolver();
  }

  async execute(request: ClaudeRequest): Promise<string> {
    try {
      const systemPrompt = this.buildSystemPrompt(request.messages, request.systemPrompt, request.tools);
      const conversationMessages = request.messages.filter(m => m.role !== 'system');
      const prompt = this.messagesToPrompt(conversationMessages);
      logger.debug('Converting messages to prompt', {
        messageCount: request.messages.length,
        model: request.model,
        hasTools: !!request.tools,
        hasSystemPrompt: !!systemPrompt
      });

      const result = await this.resolver.executeClaudeCommand(
        prompt,
        request.model,
        systemPrompt
      );

      logger.info('Claude execution completed successfully', {
        model: request.model,
        responseLength: result.length
      });

      return result;

    } catch (error) {
      logger.error('Claude CLI execution failed', error as Error, {
        model: request.model,
        messageCount: request.messages.length
      });

      if (error instanceof ClaudeCliError) {
        throw error;
      }

      throw new ClaudeCliError(
        `Claude CLI execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Stream a completion. Same message→prompt/system-prompt conversion as
   * execute, but delegates to the resolver's streaming method so
   * text deltas are forwarded as the CLI produces them. Used only for
   * tool-less requests (the tool_calls convention needs the full text first).
   */
  async *executeStreaming(request: ClaudeRequest): AsyncGenerator<ClaudeStreamEvent, void, unknown> {
    try {
      const systemPrompt = this.buildSystemPrompt(request.messages, request.systemPrompt, request.tools);
      const conversationMessages = request.messages.filter(m => m.role !== 'system');
      const prompt = this.messagesToPrompt(conversationMessages);

      logger.debug('Streaming Claude execution', {
        model: request.model,
        messageCount: request.messages.length,
        hasSystemPrompt: !!systemPrompt,
      });

      yield* this.resolver.executeClaudeCommandStreaming(prompt, request.model, systemPrompt);

      logger.info('Claude streaming execution completed successfully', { model: request.model });
    } catch (error) {
      logger.error('Claude CLI streaming execution failed', error as Error, {
        model: request.model,
        messageCount: request.messages.length,
      });

      if (error instanceof ClaudeCliError) {
        throw error;
      }
      throw new ClaudeCliError(
        `Claude CLI streaming execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private messagesToPrompt(messages: any[]): string {
    let prompt = '';

    for (const message of messages) {
      if (message.role === 'user') {
        prompt += `${this.stringifyContent(message.content)}\n\n`;
      } else if (message.role === 'assistant') {
        // A tool-call turn has content: null and the actual info in
        // tool_calls - without this branch, typeof null === 'object' made
        // this render as the literal text "null", erasing all evidence that
        // a tool was ever called. With no session/history on Claude's side
        // (every call is stateless), that left it with no way to know it had
        // already asked for this tool, so it just asked again - forever.
        if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
          const calls = message.tool_calls
            .map((call: any) => `${call.function?.name}(${call.function?.arguments})`)
            .join(', ');
          prompt += `[You already requested this tool call: ${calls}]\n\n`;
        } else {
          prompt += `${this.stringifyContent(message.content)}\n\n`;
        }
      } else if (message.role === 'tool') {
        // The actual tool result - previously dropped entirely, which was
        // the other half of why the model kept re-requesting the same call
        // instead of using the result it was already given.
        prompt += `[Result of the tool call above]: ${this.stringifyContent(message.content)}\n\n`;
      }
    }

    logger.debug('Converted messages to prompt', {
      promptLength: prompt.length,
      messageCount: messages.length
    });

    return prompt;
  }

  /**
   * Build the --system-prompt-file content: the caller's system prompt/messages
   * PLUS the tool definitions.
   *
   * The tool defs used to sit at the front of the piped stdin prompt. Measured
   * against a live VS Code / ADT session, that put them in the model's
   * current-turn input, which the Claude CLI never wraps with cache_control - so
   * all ~46 tool schemas (the largest fixed cost of every turn) were reprocessed
   * on every request: prompt-cache hit ratio ~0.06-0.09, cacheReadTokens pinned
   * at exactly the system-prompt size while cacheCreationTokens climbed. The CLI
   * only cache_controls the system prompt, and empirically only a byte-identical
   * prefix is reused (a growing prefix misses - one breakpoint at the block end).
   * The tool list IS byte-stable across a conversation, so co-locating it with
   * the (also stable) system prompt lets it be cached after the first turn.
   *
   * Tools are placed first so the injected format instruction's "tools listed
   * above" wording stays accurate, and canonicalizeTools keeps the block
   * byte-identical regardless of the order the client sent the tools in.
   */
  private buildSystemPrompt(
    messages: any[],
    explicitSystemPrompt: string | undefined,
    tools?: any[]
  ): string | undefined {
    const base = this.extractSystemPrompt(messages, explicitSystemPrompt);
    if (!tools || tools.length === 0) {
      return base;
    }
    const toolsBlock = `Available tools: ${this.canonicalizeTools(tools)}`;
    return base ? `${toolsBlock}\n\n${base}` : toolsBlock;
  }

  /**
   * Serialize tool definitions to a byte-stable string, independent of the order
   * the client sent the tools in or the key order within each tool object. See
   * buildSystemPrompt for why this matters (prompt-cache prefix stability).
   */
  private canonicalizeTools(tools: any[]): string {
    const sorted = [...tools].sort((a, b) => {
      const an = this.toolName(a);
      const bn = this.toolName(b);
      return an < bn ? -1 : an > bn ? 1 : 0;
    });
    return this.stableStringify(sorted);
  }

  private toolName(tool: any): string {
    return (tool && (tool.function?.name ?? tool.name)) || '';
  }

  /**
   * JSON.stringify with object keys sorted recursively, so equivalent objects
   * always serialize to identical bytes. Array order is preserved (it can be
   * semantically meaningful) - callers sort arrays themselves where a canonical
   * order is wanted. Inputs come from the parsed request body (pure JSON values),
   * but undefined is handled defensively to match JSON.stringify semantics.
   */
  private stableStringify(value: any): string {
    if (value === undefined) {
      return 'null';
    }
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((v) => this.stableStringify(v)).join(',')}]`;
    }
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${this.stableStringify(value[k])}`).join(',')}}`;
  }

  private stringifyContent(content: unknown): string {
    if (content === null || content === undefined) {
      return '';
    }
    if (typeof content === 'string') {
      return content;
    }
    return JSON.stringify(content);
  }

  /**
   * Combine any explicit systemPrompt with 'system'-role messages into a
   * single string for --system-prompt-file, instead of flattening system
   * content into the piped conversation text. Sending it as a real system
   * prompt is both correct (it replaces Claude Code's own default identity
   * instead of fighting it) and required for it not to be treated as an
   * embedded persona-override / impersonation attempt.
   */
  private extractSystemPrompt(messages: any[], explicitSystemPrompt?: string): string | undefined {
    const systemMessages = messages
      .filter(m => m.role === 'system')
      .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content));

    const parts = explicitSystemPrompt ? [explicitSystemPrompt, ...systemMessages] : systemMessages;
    return parts.length > 0 ? parts.join('\n\n') : undefined;
  }
}