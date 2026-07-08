import { ClaudeClient } from '../../../src/core/claude-client';
import { ClaudeResolver } from '../../../src/core/claude-resolver';
import { ClaudeCliError } from '../../../src/utils/errors';
import { ClaudeRequest } from '../../../src/types';

// Mock the ClaudeResolver
jest.mock('../../../src/core/claude-resolver');
const MockClaudeResolver = ClaudeResolver as jest.MockedClass<typeof ClaudeResolver>;

describe('ClaudeClient', () => {
  let claudeClient: ClaudeClient;
  let mockResolver: jest.Mocked<ClaudeResolver>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolver = new MockClaudeResolver() as jest.Mocked<ClaudeResolver>;
    claudeClient = new ClaudeClient();
    // Replace the internal resolver with our mock
    (claudeClient as any).resolver = mockResolver;
  });

  describe('execute', () => {
    const mockRequest: ClaudeRequest = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        { role: 'user', content: 'Hello, how are you?' }
      ]
    };

    it('should execute Claude command successfully', async () => {
      const mockResponse = 'Mock Claude response';
      mockResolver.executeClaudeCommandWithSession.mockResolvedValue(mockResponse);

      const result = await claudeClient.execute(mockRequest);

      expect(result).toBe(mockResponse);
      expect(mockResolver.executeClaudeCommandWithSession).toHaveBeenCalledWith(
        expect.stringContaining('Hello, how are you?'),
        'claude-3-5-sonnet-20241022',
        null,
        false,
        undefined
      );
    });

    it('should convert messages to proper prompt format, extracting the system message separately', async () => {
      const mockResponse = 'Mock response';
      mockResolver.executeClaudeCommandWithSession.mockResolvedValue(mockResponse);

      const requestWithMultipleMessages: ClaudeRequest = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello!' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' }
        ]
      };

      await claudeClient.execute(requestWithMultipleMessages);

      const call = mockResolver.executeClaudeCommandWithSession.mock.calls[0]!;
      const capturedPrompt = call[0]!;
      const capturedSystemPrompt = call[4];

      // System content goes to --system-prompt-file (the 5th arg), not the piped prompt
      expect(capturedSystemPrompt).toBe('You are a helpful assistant.');
      expect(capturedPrompt).not.toContain('You are a helpful assistant.');
      expect(capturedPrompt).toContain('Hello!');
      expect(capturedPrompt).toContain('Hi there!');
      expect(capturedPrompt).toContain('How are you?');
    });

    it('should handle ClaudeCliError and re-throw it', async () => {
      const originalError = new ClaudeCliError('Claude CLI failed');
      mockResolver.executeClaudeCommandWithSession.mockRejectedValue(originalError);

      await expect(claudeClient.execute(mockRequest)).rejects.toThrow(ClaudeCliError);
      await expect(claudeClient.execute(mockRequest)).rejects.toThrow('Claude CLI failed');
    });

    it('should wrap other errors in ClaudeCliError', async () => {
      const originalError = new Error('Some other error');
      mockResolver.executeClaudeCommandWithSession.mockRejectedValue(originalError);

      await expect(claudeClient.execute(mockRequest)).rejects.toThrow(ClaudeCliError);
      await expect(claudeClient.execute(mockRequest)).rejects.toThrow('Claude CLI execution failed: Some other error');
    });

    it('should include tool result messages in the prompt', async () => {
      mockResolver.executeClaudeCommandWithSession.mockResolvedValue('response');

      const requestWithToolMessage: ClaudeRequest = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [
          { role: 'user', content: 'Use this tool' },
          { role: 'tool', content: 'Tool result', tool_call_id: 'call_123' }
        ]
      };

      await claudeClient.execute(requestWithToolMessage);

      const capturedPrompt = mockResolver.executeClaudeCommandWithSession.mock.calls[0]![0]!

      // Without the tool's result in the prompt, Claude has no way to know
      // it already called the tool and gets stuck re-requesting it forever.
      expect(capturedPrompt).toContain('Use this tool');
      expect(capturedPrompt).toContain('Tool result');
    });

    it('should render an assistant tool_calls turn as text instead of the literal word "null"', async () => {
      mockResolver.executeClaudeCommandWithSession.mockResolvedValue('response');

      const requestWithToolCallTurn: ClaudeRequest = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [
          { role: 'user', content: 'What is the weather in Paris?' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_123',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"location":"Paris"}' }
            }]
          },
          { role: 'tool', content: 'Sunny, 20C', tool_call_id: 'call_123' }
        ]
      };

      await claudeClient.execute(requestWithToolCallTurn);

      const capturedPrompt = mockResolver.executeClaudeCommandWithSession.mock.calls[0]![0]!

      expect(capturedPrompt).toContain('get_weather');
      expect(capturedPrompt).toContain('Sunny, 20C');
      // typeof null === 'object' previously made this stringify to "null"
      expect(capturedPrompt).not.toMatch(/^null$/m);
    });

    it('should generate correct prompt structure', async () => {
      mockResolver.executeClaudeCommandWithSession.mockResolvedValue('response');

      await claudeClient.execute(mockRequest);

      const capturedPrompt = mockResolver.executeClaudeCommandWithSession.mock.calls[0]![0]!
      
      // Check that prompt has correct structure
      expect(capturedPrompt).toMatch(/Hello, how are you\?/);
    });
  });

  describe('tool serialization (prompt-cache stability)', () => {
    // The "Available tools:" preamble sits at the front of the piped prompt and
    // is part of the prefix the Claude CLI's prompt cache keys on. It must be
    // byte-identical for the same tools however the client happened to order
    // them (or their keys), or every request silently busts the cache.
    const toolsLine = (callIndex: number): string => {
      const prompt = mockResolver.executeClaudeCommandWithSession.mock.calls[callIndex]![0]!;
      return prompt.split('\n')[0]!;
    };

    beforeEach(() => {
      mockResolver.executeClaudeCommandWithSession.mockResolvedValue('response');
    });

    it('serializes the same tools identically regardless of array order', async () => {
      const toolA = { type: 'function', function: { name: 'a_tool', description: 'A', parameters: { type: 'object' } } };
      const toolB = { type: 'function', function: { name: 'b_tool', description: 'B', parameters: { type: 'object' } } };

      await claudeClient.execute({ model: 'm', messages: [{ role: 'user', content: 'hi' }], tools: [toolA, toolB] } as ClaudeRequest);
      await claudeClient.execute({ model: 'm', messages: [{ role: 'user', content: 'hi' }], tools: [toolB, toolA] } as ClaudeRequest);

      expect(toolsLine(0)).toBe(toolsLine(1));
      expect(toolsLine(0)).toContain('a_tool');
      expect(toolsLine(0)).toContain('b_tool');
    });

    it('serializes the same tool identically regardless of object-key order', async () => {
      const canonical = { type: 'function', function: { name: 'x', description: 'd', parameters: { type: 'object' } } };
      const shuffled = { function: { parameters: { type: 'object' }, name: 'x', description: 'd' }, type: 'function' };

      await claudeClient.execute({ model: 'm', messages: [{ role: 'user', content: 'hi' }], tools: [canonical] } as ClaudeRequest);
      await claudeClient.execute({ model: 'm', messages: [{ role: 'user', content: 'hi' }], tools: [shuffled] } as ClaudeRequest);

      expect(toolsLine(0)).toBe(toolsLine(1));
    });
  });
});