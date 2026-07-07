import { CoreWrapper } from '../../../src/core/wrapper';
import { OpenAIRequest } from '../../../src/types';
import { ClaudeClientMock } from '../../mocks/core/claude-client-mock';
import { ValidatorMock } from '../../mocks/core/validator-mock';

describe('CoreWrapper', () => {
  let wrapper: CoreWrapper;
  let mockClaudeClient: ReturnType<typeof ClaudeClientMock.setup>;
  let mockValidator: ReturnType<typeof ValidatorMock.setup>;

  beforeEach(() => {
    // Reset all mocks
    ClaudeClientMock.reset();
    ValidatorMock.reset();

    // Setup mocks
    mockClaudeClient = ClaudeClientMock.setup();
    mockValidator = ValidatorMock.setup();

    // Create wrapper with mocked dependencies
    wrapper = new CoreWrapper(mockClaudeClient, mockValidator);
  });

  afterEach(() => {
    ClaudeClientMock.reset();
    ValidatorMock.reset();
  });

  describe('basic completion', () => {
    it('should process a simple request in a single call', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [
          { role: 'user', content: 'What is 2+2?' }
        ]
      };

      ClaudeClientMock.setDefaultResponse('The answer is 4');
      ValidatorMock.setValidationAsValid(false); // Non-JSON response

      const result = await wrapper.handleChatCompletion(request);

      expect(mockClaudeClient.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'sonnet',
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'What is 2+2?' })
          ])
        })
      );
      expect(mockClaudeClient.executeWithSession).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({
        choices: [expect.objectContaining({
          message: expect.objectContaining({
            content: 'The answer is 4'
          })
        })]
      }));
    });

    it('should send system and user messages together in one call', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [
          { role: 'system', content: 'You are a math tutor.' },
          { role: 'user', content: 'What is 5+3?' }
        ]
      };

      ClaudeClientMock.setDefaultResponse('The answer is 8');
      ValidatorMock.setValidationAsValid(false);

      const result = await wrapper.handleChatCompletion(request);

      // Exactly one call - no separate session-setup round trip
      expect(mockClaudeClient.execute).toHaveBeenCalledTimes(1);
      expect(mockClaudeClient.executeWithSession).not.toHaveBeenCalled();

      const [claudeRequest] = mockClaudeClient.execute.mock.calls[0]!;
      expect(claudeRequest.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: 'You are a math tutor.' }),
        expect.objectContaining({ role: 'user', content: 'What is 5+3?' })
      ]));

      expect(result).toEqual(expect.objectContaining({
        choices: [expect.objectContaining({
          message: expect.objectContaining({
            content: 'The answer is 8'
          })
        })]
      }));
    });

    it('should send the full message history on every call (no server-side session state)', async () => {
      const systemPrompt = 'You are a math tutor.';

      const firstRequest: OpenAIRequest = {
        model: 'sonnet',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'What is 5+3?' }
        ]
      };

      const secondRequest: OpenAIRequest = {
        model: 'sonnet',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'What is 5+3?' },
          { role: 'assistant', content: 'The answer is 8' },
          { role: 'user', content: 'What is 10-4?' }
        ]
      };

      ClaudeClientMock.setDefaultResponse('Response');
      ValidatorMock.setValidationAsValid(false);

      await wrapper.handleChatCompletion(firstRequest);
      await wrapper.handleChatCompletion(secondRequest);

      expect(mockClaudeClient.execute).toHaveBeenCalledTimes(2);
      expect(mockClaudeClient.executeWithSession).not.toHaveBeenCalled();

      const [secondClaudeRequest] = mockClaudeClient.execute.mock.calls[1]!;
      expect(secondClaudeRequest.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: systemPrompt }),
        expect.objectContaining({ role: 'user', content: 'What is 5+3?' }),
        expect.objectContaining({ role: 'assistant', content: 'The answer is 8' }),
        expect.objectContaining({ role: 'user', content: 'What is 10-4?' })
      ]));
    });
  });

  describe('response handling', () => {
    it('should wrap non-JSON responses in OpenAI format', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [{ role: 'user', content: 'Hello' }]
      };

      ClaudeClientMock.setDefaultResponse('Hello there!');
      ValidatorMock.setValidationAsValid(false); // Non-JSON response

      const result = await wrapper.handleChatCompletion(request);

      expect(result).toEqual(expect.objectContaining({
        id: expect.stringMatching(/^chatcmpl-/),
        object: 'chat.completion',
        created: expect.any(Number),
        model: 'sonnet',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello there!'
          },
          finish_reason: 'stop'
        }],
        usage: expect.any(Object)
      }));
    });

    it('should return valid JSON responses as-is', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [{ role: 'user', content: 'Hello' }]
      };

      const validJsonResponse = '{"id":"test123","object":"chat.completion","model":"sonnet","choices":[]}';
      const parsedResponse = JSON.parse(validJsonResponse);

      ClaudeClientMock.setDefaultResponse(validJsonResponse);
      ValidatorMock.setValidationAsValid(true); // Valid JSON response
      ValidatorMock.setParseResult(parsedResponse);

      const result = await wrapper.handleChatCompletion(request);

      expect(result).toEqual(parsedResponse);
      expect(mockValidator.parse).toHaveBeenCalledWith(validJsonResponse);
    });

    it('should parse a minimal tool_calls JSON snippet into a full OpenAI response', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
        tools: [
          { type: 'function', function: { name: 'get_weather', description: 'Get weather' } }
        ]
      };

      ClaudeClientMock.setDefaultResponse('{"tool_calls":[{"name":"get_weather","arguments":{"location":"Paris"}}]}');
      ValidatorMock.setValidationAsValid(false);

      const result = await wrapper.handleChatCompletion(request);

      expect(result).toEqual(expect.objectContaining({
        model: 'sonnet',
        choices: [expect.objectContaining({
          message: expect.objectContaining({
            role: 'assistant',
            content: null,
            tool_calls: [expect.objectContaining({
              type: 'function',
              function: expect.objectContaining({
                name: 'get_weather',
                arguments: '{"location":"Paris"}'
              })
            })]
          }),
          finish_reason: 'tool_calls'
        })]
      }));
    });

    it('should still detect a tool_calls JSON object even when the model prefaces it with prose', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
        tools: [
          { type: 'function', function: { name: 'get_weather', description: 'Get weather' } }
        ]
      };

      ClaudeClientMock.setDefaultResponse(
        'I\'ll check that for you.\n\n{"tool_calls":[{"name":"get_weather","arguments":{"location":"Paris"}}]}'
      );
      ValidatorMock.setValidationAsValid(false);

      const result = await wrapper.handleChatCompletion(request);

      expect(result).toEqual(expect.objectContaining({
        choices: [expect.objectContaining({
          message: expect.objectContaining({
            content: null,
            tool_calls: [expect.objectContaining({
              function: expect.objectContaining({
                name: 'get_weather',
                arguments: '{"location":"Paris"}'
              })
            })]
          }),
          finish_reason: 'tool_calls'
        })]
      }));
    });

    it('should treat a response with no tool_calls array as plain text', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [{ role: 'user', content: 'Hello' }]
      };

      ClaudeClientMock.setDefaultResponse('{"not_tool_calls": true}');
      ValidatorMock.setValidationAsValid(false);

      const result = await wrapper.handleChatCompletion(request);

      expect(result.choices[0]!.message.content).toBe('{"not_tool_calls": true}');
    });
  });

  describe('format instructions', () => {
    it('should add format instructions for requests with tools', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [{ role: 'user', content: 'Use this tool' }],
        tools: [{ type: 'function', function: { name: 'test_tool' } }]
      };

      ClaudeClientMock.setDefaultResponse('Tool response');
      ValidatorMock.setValidationAsValid(false);

      await wrapper.handleChatCompletion(request);

      expect(mockClaudeClient.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }), // Format instruction
            expect.objectContaining({ role: 'user', content: 'Use this tool' })
          ]),
          tools: expect.arrayContaining([
            expect.objectContaining({ type: 'function' })
          ])
        })
      );
    });

    it('should NOT add format instructions for multi-turn conversations without tools', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
          { role: 'user', content: 'How are you?' }
        ]
      };

      ClaudeClientMock.setDefaultResponse('I am well');
      ValidatorMock.setValidationAsValid(false);

      await wrapper.handleChatCompletion(request);

      expect(mockClaudeClient.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: request.messages // No format instruction injected
        })
      );
    });

    it('should NOT add format instructions for long user messages without tools', async () => {
      const longMessage = 'a'.repeat(250); // > 200 characters
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [{ role: 'user', content: longMessage }]
      };

      ClaudeClientMock.setDefaultResponse('Response');
      ValidatorMock.setValidationAsValid(false);

      await wrapper.handleChatCompletion(request);

      expect(mockClaudeClient.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: request.messages // No format instruction injected
        })
      );
    });

    it('should NOT add format instructions when a system prompt is present but there are no tools', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello' }
        ]
      };

      ClaudeClientMock.setDefaultResponse('Hi there');
      ValidatorMock.setValidationAsValid(false);

      await wrapper.handleChatCompletion(request);

      expect(mockClaudeClient.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: request.messages // Only the caller's own system message, nothing injected
        })
      );
    });

    it('should skip format instructions for simple requests', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [{ role: 'user', content: 'Hi' }]
      };

      ClaudeClientMock.setDefaultResponse('Hello');
      ValidatorMock.setValidationAsValid(false);

      await wrapper.handleChatCompletion(request);

      expect(mockClaudeClient.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'Hi' }] // No format instruction
        })
      );
    });
  });

  describe('error handling', () => {
    it('should handle Claude client execution errors', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [{ role: 'user', content: 'Hello' }]
      };

      ClaudeClientMock.setExecutionFailure(true);

      await expect(wrapper.handleChatCompletion(request)).rejects.toThrow('Claude CLI execution failed');
    });
  });

  describe('streaming support', () => {
    it('should delegate streaming requests to regular completion', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true
      };

      ClaudeClientMock.setDefaultResponse('Response');
      ValidatorMock.setValidationAsValid(false);

      const result = await wrapper.handleStreamingChatCompletion(request);

      expect(result).toEqual(expect.objectContaining({
        choices: [expect.objectContaining({
          message: expect.objectContaining({
            content: 'Response'
          })
        })]
      }));
    });
  });

  describe('edge cases', () => {
    it('should handle empty messages array', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: []
      };

      ClaudeClientMock.setDefaultResponse('Response');
      ValidatorMock.setValidationAsValid(false);

      const result = await wrapper.handleChatCompletion(request);

      expect(result).toEqual(expect.objectContaining({
        choices: [expect.objectContaining({
          message: expect.objectContaining({
            content: 'Response'
          })
        })]
      }));
    });

    it('should handle request with only system prompts', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [
          { role: 'system', content: 'You are a helper.' }
        ]
      };

      ClaudeClientMock.setDefaultResponse('Response');
      ValidatorMock.setValidationAsValid(false);

      await wrapper.handleChatCompletion(request);

      expect(mockClaudeClient.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system', content: 'You are a helper.' })
          ])
        })
      );
    });

    it('should handle mixed role messages correctly', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [
          { role: 'system', content: 'You are a helper.' },
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' },
          { role: 'system', content: 'Be brief.' },
          { role: 'user', content: 'How are you?' }
        ]
      };

      ClaudeClientMock.setDefaultResponse('Response');
      ValidatorMock.setValidationAsValid(false);

      await wrapper.handleChatCompletion(request);

      expect(mockClaudeClient.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system', content: 'You are a helper.' }),
            expect.objectContaining({ role: 'user', content: 'Hello' }),
            expect.objectContaining({ role: 'assistant', content: 'Hi there' }),
            expect.objectContaining({ role: 'system', content: 'Be brief.' }),
            expect.objectContaining({ role: 'user', content: 'How are you?' })
          ])
        })
      );
    });

    it('should handle request with different model names', async () => {
      const request: OpenAIRequest = {
        model: 'claude-3-5-sonnet-20241022',
        messages: [
          { role: 'system', content: 'You are a helper.' },
          { role: 'user', content: 'Hello' }
        ]
      };

      ClaudeClientMock.setDefaultResponse('Response');
      ValidatorMock.setValidationAsValid(false);

      const result = await wrapper.handleChatCompletion(request);

      expect(result).toEqual(expect.objectContaining({
        model: 'claude-3-5-sonnet-20241022'
      }));
    });
  });

  describe('MCP tools and function calling', () => {
    it('should handle requests with MCP tools', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [{ role: 'user', content: 'Get the weather for New York' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather information for a location',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string', description: 'The location to get weather for' }
                },
                required: ['location']
              }
            }
          }
        ]
      };

      ClaudeClientMock.setDefaultResponse('{"tool_calls":[{"name":"get_weather","arguments":{"location":"New York"}}]}');
      ValidatorMock.setValidationAsValid(false);

      const result = await wrapper.handleChatCompletion(request);

      expect(mockClaudeClient.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }), // Format instruction
            expect.objectContaining({ role: 'user', content: 'Get the weather for New York' })
          ]),
          tools: expect.arrayContaining([
            expect.objectContaining({
              type: 'function',
              function: expect.objectContaining({
                name: 'get_weather'
              })
            })
          ])
        })
      );

      expect(result).toEqual(expect.objectContaining({
        choices: [expect.objectContaining({
          message: expect.objectContaining({
            tool_calls: expect.arrayContaining([
              expect.objectContaining({
                function: expect.objectContaining({
                  name: 'get_weather'
                })
              })
            ])
          })
        })]
      }));
    });

    it('should handle tool result responses', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [
          { role: 'user', content: 'What is the weather in Boston?' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_789',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"location": "Boston"}'
              }
            }]
          },
          {
            role: 'tool',
            content: 'The weather in Boston is sunny, 72°F',
            tool_call_id: 'call_789'
          }
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather information',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string' }
                }
              }
            }
          }
        ]
      };

      const finalResponse = 'Based on the weather data, Boston is currently sunny with a temperature of 72°F. It\'s a great day to be outside!';

      ClaudeClientMock.setDefaultResponse(finalResponse);
      ValidatorMock.setValidationAsValid(false);

      const result = await wrapper.handleChatCompletion(request);

      expect(mockClaudeClient.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }), // Format instruction
            expect.objectContaining({ role: 'user', content: 'What is the weather in Boston?' }),
            expect.objectContaining({
              role: 'assistant',
              tool_calls: expect.arrayContaining([
                expect.objectContaining({
                  function: expect.objectContaining({
                    name: 'get_weather'
                  })
                })
              ])
            }),
            expect.objectContaining({
              role: 'tool',
              content: 'The weather in Boston is sunny, 72°F',
              tool_call_id: 'call_789'
            })
          ])
        })
      );

      expect(result).toEqual(expect.objectContaining({
        choices: [expect.objectContaining({
          message: expect.objectContaining({
            content: finalResponse
          })
        })]
      }));
    });

    it('should handle multiple tool calls in one response', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [{ role: 'user', content: 'Get weather for New York and London' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather information',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string' }
                }
              }
            }
          }
        ]
      };

      const multiToolResponse = JSON.stringify({
        tool_calls: [
          { name: 'get_weather', arguments: { location: 'New York' } },
          { name: 'get_weather', arguments: { location: 'London' } }
        ]
      });

      ClaudeClientMock.setDefaultResponse(multiToolResponse);
      ValidatorMock.setValidationAsValid(false);

      const result = await wrapper.handleChatCompletion(request);

      expect(result).toEqual(expect.objectContaining({
        choices: [expect.objectContaining({
          message: expect.objectContaining({
            tool_calls: expect.arrayContaining([
              expect.objectContaining({
                function: expect.objectContaining({
                  name: 'get_weather',
                  arguments: '{"location":"New York"}'
                })
              }),
              expect.objectContaining({
                function: expect.objectContaining({
                  name: 'get_weather',
                  arguments: '{"location":"London"}'
                })
              })
            ])
          })
        })]
      }));
    });

    it('should handle tool errors gracefully', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [
          { role: 'user', content: 'Get weather for InvalidCity' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_error',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"location": "InvalidCity"}'
              }
            }]
          },
          {
            role: 'tool',
            content: 'Error: Location not found',
            tool_call_id: 'call_error'
          }
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather information',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string' }
                }
              }
            }
          }
        ]
      };

      const errorResponse = 'I apologize, but I couldn\'t find weather information for "InvalidCity". Please check the location name and try again.';

      ClaudeClientMock.setDefaultResponse(errorResponse);
      ValidatorMock.setValidationAsValid(false);

      const result = await wrapper.handleChatCompletion(request);

      expect(result).toEqual(expect.objectContaining({
        choices: [expect.objectContaining({
          message: expect.objectContaining({
            content: errorResponse
          })
        })]
      }));
    });
  });
});
