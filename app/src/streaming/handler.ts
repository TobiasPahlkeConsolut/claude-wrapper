import { Response } from 'express';
import { 
  IStreamingHandler, 
  IStreamingFormatter, 
  IStreamingManager,
  ICoreWrapper,
  OpenAIRequest
} from '../types';
import { StreamingFormatter } from './formatter';
import { StreamingManager } from './manager';
import { CoreWrapper } from '../core/wrapper';
import {
  SSE_CONFIG,
  API_CONSTANTS
} from '../config/constants';
import { logger } from '../utils/logger';

/**
 * StreamingHandler - Handles streaming chat completions
 * Single Responsibility: Coordinate streaming response flow
 * Max 200 lines, functions under 50 lines (SOLID compliance)
 */
export class StreamingHandler implements IStreamingHandler {
  private formatter: IStreamingFormatter;
  private manager: IStreamingManager;
  private coreWrapper: ICoreWrapper;

  constructor(
    formatter?: IStreamingFormatter,
    manager?: IStreamingManager,
    coreWrapper?: ICoreWrapper
  ) {
    this.formatter = formatter || new StreamingFormatter();
    this.manager = manager || new StreamingManager();
    this.coreWrapper = coreWrapper || new CoreWrapper();
  }

  /**
   * Handle streaming request with SSE
   */
  async handleStreamingRequest(request: OpenAIRequest, response: Response): Promise<void> {
    const requestId = this.generateRequestId();
    
    try {
      // Setup SSE headers
      this.setupStreamingHeaders(response);
      
      // Create connection for management
      this.manager.createConnection(requestId, response);
      
      logger.info('Starting streaming response', { 
        requestId, 
        model: request.model,
        messageCount: request.messages.length 
      });

      // Generate and stream response
      const startTime = Date.now();
      let firstChunkSent = false;

      for await (const chunk of this.createStreamingResponse(request)) {
        // Track timing for first chunk
        if (!firstChunkSent) {
          const firstChunkTime = Date.now() - startTime;
          logger.debug('First streaming chunk sent', { 
            requestId, 
            timing: `${firstChunkTime}ms` 
          });
          firstChunkSent = true;
        }

        // Send chunk to client
        response.write(chunk);
        
        // Check if connection is still active
        const connection = this.manager.getConnection(requestId);
        if (!connection || !connection.isActive) {
          break;
        }
      }

      // Close connection
      this.manager.closeConnection(requestId);
      
      const totalTime = Date.now() - startTime;
      logger.info('Streaming response completed', { 
        requestId, 
        totalTime: `${totalTime}ms` 
      });

    } catch (error) {
      logger.error('Streaming request failed', error instanceof Error ? error : new Error(String(error)), { requestId });
      
      // Send error and cleanup
      response.write(this.formatter.formatError(error instanceof Error ? error : new Error(String(error))));
      this.manager.closeConnection(requestId);
    }
  }

  /**
   * Create streaming response generator.
   *
   * Consumes the event stream from CoreWrapper.streamChatCompletion (which
   * handles both plain-text streaming and the tool-call sniff) and maps each
   * event to an OpenAI SSE chunk:
   *   text       → content delta chunk
   *   tool_calls → one tool_calls delta chunk
   *   done       → final chunk (with finish_reason and real usage)
   */
  async* createStreamingResponse(request: OpenAIRequest): AsyncGenerator<string, void, unknown> {
    const requestId = this.generateRequestId();

    try {
      yield this.formatter.formatInitialChunk(requestId, request.model);

      let finishReason: string = 'stop';
      let usage;

      for await (const event of this.coreWrapper.streamChatCompletion(request)) {
        if (event.type === 'text') {
          yield this.formatter.createContentChunk(requestId, request.model, event.text);
        } else if (event.type === 'tool_calls') {
          // Emitted as one complete delta rather than fragmented text chunks -
          // most OpenAI-compatible clients accumulate tool_calls by index
          // regardless of chunk count, so a single complete chunk parses the same.
          yield this.formatter.createToolCallsChunk(requestId, request.model, event.toolCalls);
        } else if (event.type === 'done') {
          finishReason = event.finishReason;
          usage = event.usage;
        }
      }

      yield this.formatter.createFinalChunk(requestId, request.model, finishReason, usage);
      yield this.formatter.formatDone();
    } catch (error) {
      logger.error('Error creating streaming response', error instanceof Error ? error : new Error(String(error)));
      yield this.formatter.formatError(error instanceof Error ? error : new Error(String(error)));
      // Terminate the SSE stream after the error frame. Without the [DONE]
      // sentinel, clients that block until they see it hang until their own
      // timeout instead of failing fast on the error we just sent.
      yield this.formatter.formatDone();
    }
  }

  /**
   * Setup SSE headers for streaming
   */
  private setupStreamingHeaders(response: Response): void {
    response.writeHead(200, {
      'Content-Type': SSE_CONFIG.CONTENT_TYPE,
      'Cache-Control': SSE_CONFIG.CACHE_CONTROL,
      'Connection': SSE_CONFIG.CONNECTION,
      'Access-Control-Allow-Origin': SSE_CONFIG.ACCESS_CONTROL_ALLOW_ORIGIN,
      'Access-Control-Allow-Headers': SSE_CONFIG.ACCESS_CONTROL_ALLOW_HEADERS,
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `${API_CONSTANTS.DEFAULT_REQUEST_ID_PREFIX}${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Cleanup resources
   */
  shutdown(): void {
    this.manager.shutdown();
  }
}