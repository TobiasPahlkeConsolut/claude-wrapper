import {
  IStreamingFormatter,
  OpenAIStreamingResponse,
  OpenAIToolCall,
  OpenAIUsage
} from '../types';
import { 
  OPENAI_STREAMING
} from '../config/constants';
import { logger } from '../utils/logger';

/**
 * StreamingFormatter - Formats streaming responses for OpenAI compatibility
 * Single Responsibility: Convert data to OpenAI SSE format
 * Max 200 lines, functions under 50 lines (SOLID compliance)
 */
export class StreamingFormatter implements IStreamingFormatter {
  
  /**
   * Format a streaming chunk in OpenAI SSE format
   */
  formatChunk(chunk: OpenAIStreamingResponse): string {
    try {
      const jsonChunk = JSON.stringify(chunk);
      return `${OPENAI_STREAMING.DATA_PREFIX}${jsonChunk}${OPENAI_STREAMING.LINE_ENDING}`;
    } catch (error) {
      logger.error('Failed to format streaming chunk', error instanceof Error ? error : new Error(String(error)));
      return this.formatError(new Error('Failed to format chunk'));
    }
  }

  /**
   * Format error message in SSE format
   */
  formatError(error: Error): string {
    const errorResponse = {
      error: {
        message: error.message,
        type: 'streaming_error',
        code: 'stream_error'
      }
    };
    
    return `${OPENAI_STREAMING.DATA_PREFIX}${JSON.stringify(errorResponse)}${OPENAI_STREAMING.LINE_ENDING}`;
  }

  /**
   * Format the final [DONE] message
   */
  formatDone(): string {
    return `${OPENAI_STREAMING.DATA_PREFIX}${OPENAI_STREAMING.DONE_MESSAGE}${OPENAI_STREAMING.LINE_ENDING}`;
  }

  /**
   * Format initial streaming chunk with role
   */
  formatInitialChunk(requestId: string, model: string): string {
    const initialChunk: OpenAIStreamingResponse = {
      id: requestId,
      object: OPENAI_STREAMING.OBJECT_TYPE,
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{
        index: 0,
        delta: { role: 'assistant' },
        finish_reason: null
      }]
    };
    
    return this.formatChunk(initialChunk);
  }

  /**
   * Create content chunk with delta content
   */
  createContentChunk(requestId: string, model: string, content: string): string {
    const contentChunk: OpenAIStreamingResponse = {
      id: requestId,
      object: OPENAI_STREAMING.OBJECT_TYPE,
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{
        index: 0,
        delta: { content },
        finish_reason: null
      }]
    };
    
    return this.formatChunk(contentChunk);
  }

  /**
   * Create a tool_calls delta chunk. The full call (id/name/arguments) is
   * sent in one delta rather than fragmented across multiple chunks - most
   * OpenAI-compatible clients accumulate tool_calls by index regardless of
   * how many chunks the data arrives in, so a single complete chunk parses
   * the same as a properly fragmented stream would.
   */
  createToolCallsChunk(requestId: string, model: string, toolCalls: OpenAIToolCall[]): string {
    const toolCallsChunk: OpenAIStreamingResponse = {
      id: requestId,
      object: OPENAI_STREAMING.OBJECT_TYPE,
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          content: null,
          tool_calls: toolCalls.map((call, index) => ({
            index,
            id: call.id,
            type: call.type,
            function: {
              name: call.function.name,
              arguments: call.function.arguments
            }
          }))
        },
        finish_reason: null
      }]
    };

    return this.formatChunk(toolCallsChunk);
  }

  /**
   * Create final chunk with finish reason
   */
  createFinalChunk(requestId: string, model: string, finishReason: string = OPENAI_STREAMING.FINISH_REASONS.STOP, usage?: OpenAIUsage): string {
    const finalChunk: OpenAIStreamingResponse = {
      id: requestId,
      object: OPENAI_STREAMING.OBJECT_TYPE,
      created: Math.floor(Date.now() / 1000),
      model: model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: finishReason as any
      }],
      // Real token counts when available (streaming path). Clients that don't
      // request usage simply ignore the extra field.
      ...(usage && { usage })
    };

    return this.formatChunk(finalChunk);
  }
}