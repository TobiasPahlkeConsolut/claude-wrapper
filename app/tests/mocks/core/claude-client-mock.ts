/**
 * Claude Client Mock for externalized test mocking
 * Externalized mock following clean architecture principles
 *
 * Single Responsibility: Mock Claude client execution
 */

import { ClaudeRequest, ClaudeStreamEvent } from '../../../src/types';

export interface ClaudeClientMockConfig {
  shouldFailExecution?: boolean;
  executionDelay?: number;
  defaultResponse?: string;
  streamFinishReason?: 'stop' | 'length' | 'tool_calls';
}

export interface MockClaudeClient {
  execute: jest.MockedFunction<(request: ClaudeRequest) => Promise<string>>;
  executeStreaming: (request: ClaudeRequest) => AsyncGenerator<ClaudeStreamEvent, void, unknown>;
}

/**
 * Claude client mock utility for externalized test mocking
 */
export class ClaudeClientMock {
  private static mockInstance: MockClaudeClient | null = null;
  private static config: ClaudeClientMockConfig = {};

  /**
   * Setup Claude client mock with configuration
   */
  static setup(config: ClaudeClientMockConfig = {}): MockClaudeClient {
    this.config = { ...this.config, ...config };

    // Create mock execute function
    const mockExecute = jest.fn(async (_request: ClaudeRequest): Promise<string> => {
      if (this.config.shouldFailExecution) {
        throw new Error('Claude CLI execution failed');
      }

      if (this.config.executionDelay) {
        await new Promise(resolve => setTimeout(resolve, this.config.executionDelay));
      }

      return this.config.defaultResponse || 'Mock response';
    });

    // Mock streaming: yield the default response as a single text event, then done.
    const streamConfig = this.config;
    async function* mockExecuteStreaming(_request: ClaudeRequest): AsyncGenerator<ClaudeStreamEvent, void, unknown> {
      if (streamConfig.shouldFailExecution) {
        throw new Error('Claude CLI execution failed');
      }
      const text = streamConfig.defaultResponse || 'Mock response';
      yield { type: 'text', text };
      yield { type: 'done', finishReason: streamConfig.streamFinishReason || 'stop' };
    }

    this.mockInstance = {
      execute: mockExecute,
      executeStreaming: mockExecuteStreaming
    };

    return this.mockInstance;
  }

  /**
   * Set execution failure
   */
  static setExecutionFailure(shouldFail: boolean = true): void {
    this.config.shouldFailExecution = shouldFail;
  }

  /**
   * Set default response
   */
  static setDefaultResponse(response: string): void {
    this.config.defaultResponse = response;
  }

  /**
   * Set the finishReason the streaming mock reports on its terminal 'done'
   * event (defaults to 'stop'). Used to exercise the length-truncated path,
   * where trailing-bracket repair must be suppressed.
   */
  static setStreamFinishReason(reason: 'stop' | 'length' | 'tool_calls'): void {
    this.config.streamFinishReason = reason;
  }

  /**
   * Set execution delay
   */
  static setExecutionDelay(delay: number): void {
    this.config.executionDelay = delay;
  }

  /**
   * Reset all mock configurations
   */
  static reset(): void {
    this.config = {};
    this.mockInstance = null;
  }

  /**
   * Get current mock instance
   */
  static getMockInstance(): MockClaudeClient | null {
    return this.mockInstance;
  }

  /**
   * Update configuration
   */
  static updateConfig(updates: Partial<ClaudeClientMockConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}
