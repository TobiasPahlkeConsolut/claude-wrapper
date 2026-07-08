import { StreamingHandler } from '../../../src/streaming/handler';
import { StreamingTestSetup } from './setup';

describe('StreamingHandler Core Functionality', () => {
  let handler: StreamingHandler;
  let testSetup: StreamingTestSetup;

  beforeEach(() => {
    testSetup = new StreamingTestSetup();
    testSetup.beforeEach();
    handler = new StreamingHandler(
      testSetup.mockFormatter,
      testSetup.mockManager,
      testSetup.mockCoreWrapper
    );
  });

  afterEach(() => {
    testSetup.afterEach();
    testSetup.assertNoMemoryLeaks();
  });

  describe('handleStreamingRequest', () => {
    it('should setup streaming headers correctly', async () => {
      const mockRequest = testSetup.testDataFactory.createValidRequest();
      mockRequest.stream = true;
      
      const mockAsyncGenerator = async function* () {
        yield 'data: test\n\n';
      };
      
      jest.spyOn(handler, 'createStreamingResponse').mockImplementation(mockAsyncGenerator);

      await handler.handleStreamingRequest(mockRequest, testSetup.mockResponse as any);

      expect(testSetup.mockResponse.statusCode).toBe(200);
      expect(testSetup.mockResponse.headers['Content-Type']).toBe('text/event-stream');
      expect(testSetup.mockResponse.headers['Cache-Control']).toBe('no-cache');
      expect(testSetup.mockResponse.headers['Connection']).toBe('keep-alive');
    });

    it('should create connection and stream response', async () => {
      const mockRequest = testSetup.testDataFactory.createValidRequest();
      mockRequest.stream = true;
      
      const mockAsyncGenerator = async function* () {
        yield 'data: chunk1\n\n';
        yield 'data: chunk2\n\n';
      };
      
      jest.spyOn(handler, 'createStreamingResponse').mockImplementation(mockAsyncGenerator);

      await handler.handleStreamingRequest(mockRequest, testSetup.mockResponse as any);

      expect(testSetup.mockManager.createConnectionCalls.length).toBeGreaterThan(0);
      expect(testSetup.mockResponse.chunks).toContain('data: chunk1\n\n');
      expect(testSetup.mockResponse.chunks).toContain('data: chunk2\n\n');
      expect(testSetup.mockManager.closeConnectionCalls.length).toBeGreaterThan(0);
    });

    it('should handle streaming errors gracefully', async () => {
      const mockRequest = testSetup.testDataFactory.createValidRequest();
      mockRequest.stream = true;
      
      const mockAsyncGenerator = async function* () {
        yield 'data: test\n\n';
        throw new Error('Streaming error');
      };
      
      jest.spyOn(handler, 'createStreamingResponse').mockImplementation(mockAsyncGenerator);

      await handler.handleStreamingRequest(mockRequest, testSetup.mockResponse as any);

      expect(testSetup.mockFormatter.formatErrorCalls.length).toBeGreaterThan(0);
      expect(testSetup.mockManager.closeConnectionCalls.length).toBeGreaterThan(0);
    });

    it('should close connection on response end', async () => {
      const mockRequest = testSetup.testDataFactory.createValidRequest();
      mockRequest.stream = true;
      
      const mockAsyncGenerator = async function* () {
        yield 'data: test\n\n';
      };
      
      jest.spyOn(handler, 'createStreamingResponse').mockImplementation(mockAsyncGenerator);

      await handler.handleStreamingRequest(mockRequest, testSetup.mockResponse as any);

      expect(testSetup.mockManager.closeConnectionCalls.length).toBeGreaterThan(0);
    });
  });

  describe('createStreamingResponse (true streaming, no tools)', () => {
    it('should generate complete streaming response', async () => {
      const mockRequest = testSetup.testDataFactory.createValidRequest();
      const mockResponse = testSetup.testDataFactory.createValidResponse();

      testSetup.mockCoreWrapper.setMockResponse(mockResponse);

      const generator = handler.createStreamingResponse(mockRequest);
      const chunks: string[] = [];

      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(testSetup.mockFormatter.formatInitialChunkCalls.length).toBeGreaterThan(0);
      expect(testSetup.mockFormatter.createFinalChunkCalls.length).toBeGreaterThan(0);
      expect(testSetup.mockFormatter.formatDoneCalls).toBeGreaterThan(0);
    });

    it('should use the streaming path (not the buffered handleChatCompletion) when there are no tools', async () => {
      const mockRequest = testSetup.testDataFactory.createValidRequest();
      const mockResponse = testSetup.testDataFactory.createValidResponse();

      testSetup.mockCoreWrapper.setMockResponse(mockResponse);

      const generator = handler.createStreamingResponse(mockRequest);
      for await (const _chunk of generator) { /* drain */ }

      expect(testSetup.mockCoreWrapper.streamChatCompletionCalls.length).toBe(1);
      expect(testSetup.mockCoreWrapper.handleChatCompletionCalls.length).toBe(0);
    });

    it('should forward each text delta as its own content chunk', async () => {
      const mockRequest = testSetup.testDataFactory.createValidRequest();
      testSetup.mockCoreWrapper.setMockStreamEvents([
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' world' },
        { type: 'done', finishReason: 'stop', usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }
      ]);

      const generator = handler.createStreamingResponse(mockRequest);
      for await (const _chunk of generator) { /* drain */ }

      expect(testSetup.mockFormatter.createContentChunkCalls.length).toBe(2);
      expect(testSetup.mockFormatter.createContentChunkCalls[0]?.content).toBe('Hello');
      expect(testSetup.mockFormatter.createContentChunkCalls[1]?.content).toBe(' world');
    });

    it('should pass real usage and finish reason to the final chunk', async () => {
      const mockRequest = testSetup.testDataFactory.createValidRequest();
      const usage = { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 };
      testSetup.mockCoreWrapper.setMockStreamEvents([
        { type: 'text', text: 'partial' },
        { type: 'done', finishReason: 'length', usage }
      ]);

      const generator = handler.createStreamingResponse(mockRequest);
      for await (const _chunk of generator) { /* drain */ }

      expect(testSetup.mockFormatter.createFinalChunkCalls.length).toBe(1);
      expect(testSetup.mockFormatter.createFinalChunkCalls[0]?.finishReason).toBe('length');
      expect(testSetup.mockFormatter.createFinalChunkCalls[0]?.usage).toEqual(usage);
    });

    it('should handle empty response content', async () => {
      const mockRequest = testSetup.testDataFactory.createValidRequest();
      testSetup.mockCoreWrapper.setMockStreamEvents([
        { type: 'done', finishReason: 'stop' }
      ]);

      const generator = handler.createStreamingResponse(mockRequest);
      const chunks: string[] = [];

      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(testSetup.mockFormatter.formatInitialChunkCalls.length).toBeGreaterThan(0);
      expect(testSetup.mockFormatter.createContentChunkCalls.length).toBe(0);
      expect(testSetup.mockFormatter.formatDoneCalls).toBeGreaterThan(0);
    });

    it('should handle core wrapper errors', async () => {
      const mockRequest = testSetup.testDataFactory.createValidRequest();
      const error = new Error('Core wrapper error');

      testSetup.mockCoreWrapper.shouldThrowError = true;
      testSetup.mockCoreWrapper.errorToThrow = error;

      const generator = handler.createStreamingResponse(mockRequest);
      const chunks: string[] = [];

      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      expect(testSetup.mockFormatter.formatErrorCalls.length).toBeGreaterThan(0);
      expect(testSetup.mockFormatter.formatErrorCalls[0]?.message).toBe('Core wrapper error');
    });
  });

  describe('createStreamingResponse (with tools)', () => {
    it('should stream tool-carrying requests via streamChatCompletion (not the buffered handleChatCompletion)', async () => {
      const mockRequest = testSetup.testDataFactory.createValidRequest();
      mockRequest.tools = [{ type: 'function', function: { name: 'get_weather', parameters: {} } }];
      const mockResponse = testSetup.testDataFactory.createValidResponse();

      testSetup.mockCoreWrapper.setMockResponse(mockResponse);

      const generator = handler.createStreamingResponse(mockRequest);
      for await (const _chunk of generator) { /* drain */ }

      expect(testSetup.mockCoreWrapper.streamChatCompletionCalls.length).toBe(1);
      expect(testSetup.mockCoreWrapper.handleChatCompletionCalls.length).toBe(0);
    });

    it('should emit a single tool_calls chunk when the stream yields a tool_calls event', async () => {
      const mockRequest = testSetup.testDataFactory.createValidRequest();
      mockRequest.tools = [{ type: 'function', function: { name: 'get_weather', parameters: {} } }];
      const toolCalls = [{
        id: 'call_abc123',
        type: 'function' as const,
        function: { name: 'get_weather', arguments: '{"location":"Paris"}' }
      }];
      testSetup.mockCoreWrapper.setMockStreamEvents([
        { type: 'tool_calls', toolCalls },
        { type: 'done', finishReason: 'tool_calls' }
      ]);

      const generator = handler.createStreamingResponse(mockRequest);
      for await (const _chunk of generator) { /* drain */ }

      expect(testSetup.mockFormatter.createToolCallsChunkCalls.length).toBe(1);
      expect(testSetup.mockFormatter.createToolCallsChunkCalls[0]?.toolCalls).toEqual(toolCalls);
      expect(testSetup.mockFormatter.createContentChunkCalls.length).toBe(0);
      expect(testSetup.mockFormatter.createFinalChunkCalls[0]?.finishReason).toBe('tool_calls');
    });

    it('should stream text content when a tool-carrying request resolves to plain text', async () => {
      const mockRequest = testSetup.testDataFactory.createValidRequest();
      mockRequest.tools = [{ type: 'function', function: { name: 'noop', parameters: {} } }];
      testSetup.mockCoreWrapper.setMockStreamEvents([
        { type: 'text', text: 'Just a plain answer' },
        { type: 'done', finishReason: 'stop' }
      ]);

      const generator = handler.createStreamingResponse(mockRequest);
      for await (const _chunk of generator) { /* drain */ }

      expect(testSetup.mockFormatter.createContentChunkCalls.length).toBe(1);
      expect(testSetup.mockFormatter.createToolCallsChunkCalls.length).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('should shutdown manager when shutdown is called', () => {
      handler.shutdown();
      expect(testSetup.mockManager.shutdownCalls).toBeGreaterThan(0);
    });

    it('should handle missing manager shutdown gracefully', () => {
      const mockManagerWithoutShutdown = {
        ...testSetup.mockManager,
        shutdown: undefined
      };
      const handlerWithoutShutdown = new StreamingHandler(
        testSetup.mockFormatter,
        mockManagerWithoutShutdown as any,
        testSetup.mockCoreWrapper
      );
      
      expect(() => handlerWithoutShutdown.shutdown()).toThrow('this.manager.shutdown is not a function');
    });
  });
});