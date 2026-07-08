import {
  OpenAIRequest,
  OpenAIResponse,
  OpenAIMessage,
  ClaudeRequest,
  ICoreWrapper,
  IClaudeClient,
  IResponseValidator
} from '../types';
import { ClaudeClient } from './claude-client';
import { ResponseValidator } from './validator';
import { logger } from '../utils/logger';
import { ClaudeStreamEvent, OpenAIUsage } from '../types';
import {
  API_CONSTANTS,
  TEMPLATE_CONSTANTS,
  DEFAULT_USAGE
} from '../config/constants';

export class CoreWrapper implements ICoreWrapper {
  private claudeClient: IClaudeClient;
  private validator: IResponseValidator;

  constructor(claudeClient?: IClaudeClient, validator?: IResponseValidator) {
    this.claudeClient = claudeClient || new ClaudeClient();
    this.validator = validator || new ResponseValidator();
  }

  async handleChatCompletion(request: OpenAIRequest): Promise<OpenAIResponse> {
    logger.info('Processing chat completion request', {
      model: request.model,
      messageCount: request.messages.length,
      stream: request.stream
    });

    // Callers (VS Code, etc.) resend the full message history on every
    // request, so there's nothing to gain from a stateful Claude CLI session
    // (`--resume`) - it only added a second full CLI round-trip per turn and,
    // worse, could bleed context between unrelated conversations that happened
    // to share the same system prompt. One call, full history, every time.
    const claudeRequest = this.addFormatInstructions(request);
    const rawResponse = await this.claudeClient.execute(claudeRequest);

    return this.validateAndCorrect(rawResponse, claudeRequest);
  }

  private addFormatInstructions(request: OpenAIRequest): ClaudeRequest {
    const needsFormatting = this.shouldUseFormatInstructions(request);
    
    if (!needsFormatting) {
      logger.debug('Skipping format instructions for simple request', {
        messageCount: request.messages.length,
        hasTools: !!request.tools
      });
      
      return {
        model: request.model,
        messages: request.messages,
        ...(request.tools && { tools: request.tools })
      };
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const requestId = this.generateRequestId();
    
    const formatInstruction: OpenAIMessage = {
      role: TEMPLATE_CONSTANTS.FORMAT_INSTRUCTION_ROLE,
      content: this.createFormatTemplate(requestId, timestamp, request.model)
    };

    const enhancedMessages = [formatInstruction, ...request.messages];

    logger.debug('Added format instructions for complex request', {
      originalMessageCount: request.messages.length,
      enhancedMessageCount: enhancedMessages.length,
      requestId
    });

    return {
      model: request.model,
      messages: enhancedMessages,
      ...(request.tools && { tools: request.tools })
    };
  }

  private shouldUseFormatInstructions(request: OpenAIRequest): boolean {
    // The injected instruction exists for exactly one reason: teaching the
    // model our minimal {"tool_calls": [...]} convention (see
    // createFormatTemplate) - Claude answers in plain text by default, so
    // there's nothing to instruct otherwise for tool-less requests. Adding it
    // unconditionally (multi-turn, system message present, long message, ...)
    // only diluted the caller's own system prompt for no behavioral benefit.
    return !!(request.tools && request.tools.length > 0);
  }

  private createFormatTemplate(_requestId: string, _timestamp: number, _model: string): string {
    // Note: deliberately does NOT ask the model to fabricate a full API response
    // envelope (id/created/usage) or "adopt" an API/tool schema wholesale — Claude
    // Code (which is what's actually running behind the CLI) treats that framing as
    // an impersonation/prompt-injection attempt and refuses. Only ask for the
    // minimal, purpose-specific data; the server fills in id/created/usage itself
    // in validateAndCorrect().
    return 'Respond to the message below directly and in plain text — no JSON, ' +
      'no metadata, no wrapper of any kind, just your answer. ' +
      'If (and only if) you need to call one of the tools listed above to answer, ' +
      'respond with nothing but this minimal JSON object (no other text): ' +
      '{"tool_calls":[{"name":"<tool name>","arguments":{<arguments as an object>}}]}';
  }

  private async validateAndCorrect(
    response: string, 
    originalRequest: ClaudeRequest, 
    attempt: number = 1
  ): Promise<OpenAIResponse> {
    
    const validation = this.validator.validate(response);

    if (validation.valid) {
      logger.info('Valid response received', { attempt });
      return this.validator.parse(response);
    }

    // Model was only ever asked for a minimal {"tool_calls": [...]} snippet (see
    // createFormatTemplate) — not a full envelope — so check for that shape before
    // falling back to plain text.
    const toolCallsResponse = this.tryParseMinimalToolCalls(response, originalRequest.model);
    if (toolCallsResponse) {
      logger.info('Minimal tool_calls response received', { attempt });
      return toolCallsResponse;
    }

    // Instead of trying to self-correct, wrap non-JSON response in OpenAI format
    logger.info('Non-JSON response received, wrapping in OpenAI format', {
      responseLength: response.length,
      responsePreview: response.substring(0, 100)
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const requestId = this.generateRequestId();

    const wrappedResponse: OpenAIResponse = {
      id: requestId,
      object: TEMPLATE_CONSTANTS.COMPLETION_OBJECT_TYPE,
      created: timestamp,
      model: originalRequest.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: response
        },
        finish_reason: TEMPLATE_CONSTANTS.DEFAULT_FINISH_REASON
      }],
      usage: {
        prompt_tokens: DEFAULT_USAGE.PROMPT_TOKENS,
        completion_tokens: DEFAULT_USAGE.COMPLETION_TOKENS,
        total_tokens: DEFAULT_USAGE.TOTAL_TOKENS
      }
    };

    return wrappedResponse;
  }

  /**
   * Detect the minimal `{"tool_calls": [{"name": ..., "arguments": {...}}]}` shape
   * the model is asked for in createFormatTemplate, and build a full OpenAI
   * response envelope around it here rather than asking the model to fabricate
   * ids/timestamps/usage itself.
   */
  private tryParseMinimalToolCalls(response: string, model: string): OpenAIResponse | null {
    // The model is asked to respond with nothing but the JSON object, but
    // often prefaces it with a sentence anyway ("I'll check that.\n\n{...}").
    // Try the whole trimmed string first (the common case), then fall back to
    // locating the {"tool_calls": ...} object anywhere in the text so partial
    // non-compliance doesn't silently downgrade a real tool call to plain text.
    let parsed: any;
    try {
      parsed = JSON.parse(response.trim());
    } catch {
      const extracted = this.extractToolCallsJson(response);
      if (!extracted) {
        return null;
      }
      try {
        parsed = JSON.parse(extracted);
      } catch {
        return null;
      }
    }

    // The model is asked for the {"tool_calls":[...]} envelope, but in practice
    // it produces several near-misses that all mean "call this tool". Accept
    // them all rather than leaking a real tool call out as plain text:
    //   {"tool_calls":[{name,arguments}]}   - the requested envelope
    //   {"name":...,"arguments":{...}}        - a single bare call object
    //   [{name,arguments}, ...]               - a bare array of calls
    // ...and within each entry, tolerate the OpenAI-native `function` nesting
    // ({function:{name,arguments}}) as well as name/arguments at the top level.
    let rawCalls: any[] | null = null;
    if (parsed && Array.isArray(parsed.tool_calls)) {
      rawCalls = parsed.tool_calls;
    } else if (Array.isArray(parsed)) {
      rawCalls = parsed;
    } else if (parsed && (typeof parsed.name === 'string' || parsed.function)) {
      rawCalls = [parsed];
    }

    if (!rawCalls || rawCalls.length === 0) {
      return null;
    }

    const toolCalls = rawCalls
      .map((call: any) => (call && call.function ? call.function : call))
      .filter((call: any) => call && typeof call.name === 'string')
      .map((call: any, index: number) => ({
        id: `call_${Math.random().toString(36).substring(2, 15)}_${index}`,
        type: 'function' as const,
        function: {
          name: call.name,
          arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {})
        }
      }));

    if (toolCalls.length === 0) {
      return null;
    }

    return {
      id: this.generateRequestId(),
      object: TEMPLATE_CONSTANTS.COMPLETION_OBJECT_TYPE,
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: toolCalls
        },
        finish_reason: 'tool_calls'
      }],
      usage: {
        prompt_tokens: DEFAULT_USAGE.PROMPT_TOKENS,
        completion_tokens: DEFAULT_USAGE.COMPLETION_TOKENS,
        total_tokens: DEFAULT_USAGE.TOTAL_TOKENS
      }
    };
  }

  /**
   * Locate a `{"tool_calls": [...]}` object embedded anywhere in a larger
   * string (e.g. after a leading sentence) via brace matching, respecting
   * string literals so a `}`/`{` inside a quoted argument doesn't end the
   * scan early. Returns the matched substring, or null if none is found.
   */
  private extractToolCallsJson(response: string): string | null {
    const anchor = response.indexOf('"tool_calls"');
    if (anchor === -1) {
      return null;
    }

    const start = response.lastIndexOf('{', anchor);
    if (start === -1) {
      return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < response.length; i++) {
      const char = response[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          return response.slice(start, i + 1);
        }
      }
    }

    return null;
  }

  /**
   * Stream a chat completion as deltas arrive from the Claude CLI.
   *
   * Tool-less requests stream straight through: each text delta is forwarded as
   * it arrives.
   *
   * Tool-carrying requests are buffered in full before anything is emitted. The
   * model is instructed (see createFormatTemplate) to answer in plain text OR
   * reply with a `{"tool_calls":[...]}` object, but in practice it narrates
   * first ("Now let me activate the object.\n\n{...}") - and in a multi-step
   * agent turn that narration can run for many lines before the JSON arrives. A
   * tool call must never leak to the client as visible text, and once a text
   * chunk has been streamed it cannot be retracted, so there is no safe point to
   * commit to "this is plain text" mid-stream (an earlier first-char sniff and a
   * length-threshold sniff both leaked real tool calls this way). We therefore
   * accumulate the whole response, then let tryParseMinimalToolCalls find a
   * tool_calls object anywhere in it (bare, wrapped, fenced, or prose-prefixed)
   * and emit it as a real tool call; if there is none, the buffered text is
   * emitted as-is.
   *
   * Cost: tool-carrying requests are delivered when complete rather than token
   * by token. Plain chat (no tools) still streams live via the early return
   * above. For an IDE agent - where every request carries tools and a single
   * leaked tool call breaks the whole loop - reliable tool detection is worth
   * far more than intra-response streaming.
   */
  async *streamChatCompletion(request: OpenAIRequest): AsyncGenerator<ClaudeStreamEvent, void, unknown> {
    logger.info('Processing streaming chat completion', {
      model: request.model,
      messageCount: request.messages.length,
      hasTools: !!(request.tools && request.tools.length > 0)
    });

    // Reuse the same request shaping as the buffered path: when tools are
    // present this injects the tool_calls format instruction (as a system
    // message) and carries the tools through so the model knows the convention.
    const claudeRequest = this.addFormatInstructions(request);
    const hasTools = !!(request.tools && request.tools.length > 0);

    if (!hasTools) {
      yield* this.claudeClient.executeStreaming(claudeRequest);
      return;
    }

    let buffer = '';
    let finishReason: 'stop' | 'length' | 'tool_calls' = 'stop';
    let usage: OpenAIUsage | undefined;

    for await (const event of this.claudeClient.executeStreaming(claudeRequest)) {
      if (event.type === 'text') {
        buffer += event.text; // accumulate silently - never emit text mid-stream
      } else if (event.type === 'done') {
        finishReason = event.finishReason;
        usage = event.usage;
      }
    }

    // Whole response in hand: pull out a tool call if there is one anywhere in
    // it (tryParseMinimalToolCalls handles bare/wrapped/fenced/prose-prefixed
    // shapes), otherwise deliver the buffered text.
    const toolResponse = this.tryParseMinimalToolCalls(buffer, request.model);
    const toolCalls = toolResponse?.choices[0]?.message?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      yield { type: 'tool_calls', toolCalls };
      yield { type: 'done', finishReason: 'tool_calls', ...(usage && { usage }) };
      return;
    }

    if (buffer) {
      yield { type: 'text', text: buffer };
    }
    yield { type: 'done', finishReason, ...(usage && { usage }) };
  }

  private generateRequestId(): string {
    return `${API_CONSTANTS.DEFAULT_REQUEST_ID_PREFIX}${Math.random().toString(36).substring(2, 15)}`;
  }
}