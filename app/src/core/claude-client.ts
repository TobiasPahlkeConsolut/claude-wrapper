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
    return this.executeWithSession(request, null, false);
  }

  async executeWithSession(request: ClaudeRequest, sessionId: string | null, useJsonOutput: boolean): Promise<string> {
    try {
      const systemPrompt = this.extractSystemPrompt(request.messages, request.systemPrompt);
      const conversationMessages = request.messages.filter(m => m.role !== 'system');
      const prompt = this.messagesToPrompt(conversationMessages, request.tools);
      logger.debug('Converting messages to prompt', {
        messageCount: request.messages.length,
        model: request.model,
        hasTools: !!request.tools,
        hasSystemPrompt: !!systemPrompt,
        sessionId,
        useJsonOutput
      });

      const result = await this.resolver.executeClaudeCommandWithSession(
        prompt,
        request.model,
        sessionId,
        useJsonOutput,
        systemPrompt
      );
      
      logger.info('Claude execution completed successfully', {
        model: request.model,
        responseLength: result.length,
        sessionId,
        useJsonOutput
      });
      
      return result;
      
    } catch (error) {
      logger.error('Claude CLI execution failed', error as Error, { 
        model: request.model,
        messageCount: request.messages.length,
        sessionId 
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
   * executeWithSession, but delegates to the resolver's streaming method so
   * text deltas are forwarded as the CLI produces them. Used only for
   * tool-less requests (the tool_calls convention needs the full text first).
   */
  async *executeStreaming(request: ClaudeRequest): AsyncGenerator<ClaudeStreamEvent, void, unknown> {
    try {
      const systemPrompt = this.extractSystemPrompt(request.messages, request.systemPrompt);
      const conversationMessages = request.messages.filter(m => m.role !== 'system');
      const prompt = this.messagesToPrompt(conversationMessages, request.tools);

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

  private messagesToPrompt(messages: any[], tools?: any[]): string {
    let prompt = '';

    // Add tools if provided
    if (tools && tools.length > 0) {
      prompt += `Available tools: ${JSON.stringify(tools)}\n\n`;
    }

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
      messageCount: messages.length,
      toolCount: tools?.length || 0
    });

    return prompt;
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