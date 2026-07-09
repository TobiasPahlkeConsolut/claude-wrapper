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
      );      expect(result).toEqual(expect.objectContaining({
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

    it('should parse a bare {name, arguments} object (no tool_calls wrapper) as a tool call', async () => {
      // Regression: the model sometimes emits just the inner call object rather
      // than the {"tool_calls":[...]} envelope it's asked for. This must still
      // be recognized as a tool call, not leaked to the client as text.
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [{ role: 'user', content: 'Edit the file' }],
        tools: [
          { type: 'function', function: { name: 'replace_string_in_file', description: 'Edit a file' } }
        ]
      };

      ClaudeClientMock.setDefaultResponse(
        '{"name":"replace_string_in_file","arguments":{"filePath":"a.txt","oldString":"x","newString":"y"}}'
      );
      ValidatorMock.setValidationAsValid(false);

      const result = await wrapper.handleChatCompletion(request);

      expect(result).toEqual(expect.objectContaining({
        choices: [expect.objectContaining({
          message: expect.objectContaining({
            content: null,
            tool_calls: [expect.objectContaining({
              function: expect.objectContaining({
                name: 'replace_string_in_file',
                arguments: '{"filePath":"a.txt","oldString":"x","newString":"y"}'
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
    it('should stream text events from the claude client', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true
      };

      ClaudeClientMock.setDefaultResponse('Response');

      const events = [];
      for await (const event of wrapper.streamChatCompletion(request)) {
        events.push(event);
      }

      expect(events).toContainEqual({ type: 'text', text: 'Response' });
      expect(events[events.length - 1]).toEqual(
        expect.objectContaining({ type: 'done', finishReason: 'stop' })
      );
    });

    it('should stream a tool-carrying request as text when the answer is plain text (first char not "{")', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
        tools: [{ type: 'function', function: { name: 'noop', parameters: {} } }]
      };

      ClaudeClientMock.setDefaultResponse('Hello there');

      const events = [];
      for await (const event of wrapper.streamChatCompletion(request)) {
        events.push(event);
      }

      expect(events).toContainEqual({ type: 'text', text: 'Hello there' });
      expect(events.some(e => e.type === 'tool_calls')).toBe(false);
    });

    it('should emit a tool_calls event when a tool-carrying request returns a tool_calls JSON object (first char "{")', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [{ role: 'user', content: 'Weather in Paris?' }],
        stream: true,
        tools: [{ type: 'function', function: { name: 'get_weather', parameters: {} } }]
      };

      ClaudeClientMock.setDefaultResponse('{"tool_calls":[{"name":"get_weather","arguments":{"location":"Paris"}}]}');

      const events = [];
      for await (const event of wrapper.streamChatCompletion(request)) {
        events.push(event);
      }

      const toolEvent = events.find(e => e.type === 'tool_calls') as { type: 'tool_calls'; toolCalls: any[] } | undefined;
      expect(toolEvent).toBeDefined();
      expect(toolEvent?.toolCalls[0]?.function?.name).toBe('get_weather');
      // The raw JSON must NOT have been streamed as visible text
      expect(events.some(e => e.type === 'text')).toBe(false);
      expect(events[events.length - 1]).toEqual(
        expect.objectContaining({ type: 'done', finishReason: 'tool_calls' })
      );
    });

    it('should emit a tool_calls event for a bare {name, arguments} object, not leak it as text', async () => {
      // Regression for the VS Code case: a real tool call arrived as a bare
      // object and was being streamed to the client as visible JSON text
      // instead of being executed. It must surface as a tool_calls event.
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [{ role: 'user', content: 'Edit the file' }],
        stream: true,
        tools: [{ type: 'function', function: { name: 'replace_string_in_file', parameters: {} } }]
      };

      ClaudeClientMock.setDefaultResponse(
        '{"name":"replace_string_in_file","arguments":{"filePath":"a.txt","oldString":"x","newString":"y"}}'
      );

      const events = [];
      for await (const event of wrapper.streamChatCompletion(request)) {
        events.push(event);
      }

      const toolEvent = events.find(e => e.type === 'tool_calls') as { type: 'tool_calls'; toolCalls: any[] } | undefined;
      expect(toolEvent).toBeDefined();
      expect(toolEvent?.toolCalls[0]?.function?.name).toBe('replace_string_in_file');
      // The raw JSON must NOT have been streamed as visible text
      expect(events.some(e => e.type === 'text')).toBe(false);
      expect(events[events.length - 1]).toEqual(
        expect.objectContaining({ type: 'done', finishReason: 'tool_calls' })
      );
    });

    it('should emit a tool_calls event when the JSON is wrapped in a ```json markdown fence', async () => {
      // Regression: the model prefaced the tool_calls JSON with a code fence, so
      // the response did not start with '{'. The old first-char sniff streamed
      // the whole thing (fence + JSON) as visible text instead of executing it.
      const request: OpenAIRequest = {
        model: 'opus',
        messages: [{ role: 'user', content: 'Edit the file' }],
        stream: true,
        tools: [{ type: 'function', function: { name: 'replace_string_in_file', parameters: {} } }]
      };

      ClaudeClientMock.setDefaultResponse(
        '```json\n{"tool_calls":[{"name":"replace_string_in_file","arguments":{"filePath":"a.txt"}}]}\n```'
      );

      const events = [];
      for await (const event of wrapper.streamChatCompletion(request)) {
        events.push(event);
      }

      const toolEvent = events.find(e => e.type === 'tool_calls') as { type: 'tool_calls'; toolCalls: any[] } | undefined;
      expect(toolEvent).toBeDefined();
      expect(toolEvent?.toolCalls[0]?.function?.name).toBe('replace_string_in_file');
      expect(events.some(e => e.type === 'text')).toBe(false);
      expect(events[events.length - 1]).toEqual(
        expect.objectContaining({ type: 'done', finishReason: 'tool_calls' })
      );
    });

    it('should emit a tool_calls event when the model prefaces the JSON with prose', async () => {
      // Regression: a short sentence before the JSON meant the response did not
      // start with '{', so the old sniff misclassified the tool call as text.
      const request: OpenAIRequest = {
        model: 'opus',
        messages: [{ role: 'user', content: 'Edit the file' }],
        stream: true,
        tools: [{ type: 'function', function: { name: 'replace_string_in_file', parameters: {} } }]
      };

      ClaudeClientMock.setDefaultResponse(
        'I\'ll apply that edit now.\n\n{"tool_calls":[{"name":"replace_string_in_file","arguments":{"filePath":"a.txt"}}]}'
      );

      const events = [];
      for await (const event of wrapper.streamChatCompletion(request)) {
        events.push(event);
      }

      const toolEvent = events.find(e => e.type === 'tool_calls') as { type: 'tool_calls'; toolCalls: any[] } | undefined;
      expect(toolEvent).toBeDefined();
      expect(toolEvent?.toolCalls[0]?.function?.name).toBe('replace_string_in_file');
      expect(events.some(e => e.type === 'text')).toBe(false);
    });

    it('should still stream a genuine plain-text answer as text when tools are present', async () => {
      // Guard against over-eager tool detection: a plain answer with no tool-call
      // signal must be delivered as text, never as a tool_calls event.
      const request: OpenAIRequest = {
        model: 'opus',
        messages: [{ role: 'user', content: 'What does this view do?' }],
        stream: true,
        tools: [{ type: 'function', function: { name: 'replace_string_in_file', parameters: {} } }]
      };

      ClaudeClientMock.setDefaultResponse(
        'This CDS view selects production version data from table mkal and exposes it with SAP standard field names. It does not modify anything.'
      );

      const events = [];
      for await (const event of wrapper.streamChatCompletion(request)) {
        events.push(event);
      }

      expect(events.some(e => e.type === 'tool_calls')).toBe(false);
      const text = events.filter(e => e.type === 'text').map((e: any) => e.text).join('');
      expect(text).toContain('CDS view');
      expect(events[events.length - 1]).toEqual(
        expect.objectContaining({ type: 'done', finishReason: 'stop' })
      );
    });

    it('should emit a tool_calls event even after a long multi-line narration precedes the JSON', async () => {
      // Regression for the VS Code multi-step agent case: the model narrated at
      // length about what it had done, THEN emitted the tool call. A length-based
      // sniff committed to "text" during the narration and leaked the tool call.
      // Full buffering must find the tool_calls object no matter how long the
      // preamble runs. Mirrors the exact call the user saw leak (activate object).
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [{ role: 'user', content: 'Now activate it' }],
        stream: true,
        tools: [{ type: 'function', function: { name: 'mcp_adt_mcp_serve_abap_activate_objects', parameters: {} } }]
      };

      const longNarration = 'I have applied all of the requested field renames to the CDS view. '.repeat(12);
      ClaudeClientMock.setDefaultResponse(
        `${longNarration}\n\nNow let me activate the object.\n\n` +
        '{"tool_calls":[{"name":"mcp_adt_mcp_serve_abap_activate_objects","arguments":{"uris":["/sap/bc/adt/ddic/ddl/sources/z_i_tp_test"]}}]}'
      );

      const events = [];
      for await (const event of wrapper.streamChatCompletion(request)) {
        events.push(event);
      }

      expect(longNarration.length).toBeGreaterThan(400); // preamble exceeds the old threshold
      const toolEvent = events.find(e => e.type === 'tool_calls') as { type: 'tool_calls'; toolCalls: any[] } | undefined;
      expect(toolEvent).toBeDefined();
      expect(toolEvent?.toolCalls[0]?.function?.name).toBe('mcp_adt_mcp_serve_abap_activate_objects');
      expect(events.some(e => e.type === 'text')).toBe(false);
      expect(events[events.length - 1]).toEqual(
        expect.objectContaining({ type: 'done', finishReason: 'tool_calls' })
      );
    });
  });

  describe('tool_calls structural repair (trailing bracket)', () => {
    // The model occasionally ends a large tool_calls object one or more closing
    // brackets short but otherwise complete — confirmed from a live capture:
    // the delta-reconstructed text was byte-identical to the CLI's own final
    // text and equally unbalanced, with stop_reason "stop" (a clean finish, not
    // a token-limit cutoff). On a clean stop the wrapper re-balances and
    // recovers the call; on a length-truncated turn, or when a value itself was
    // cut off mid-string, it must NOT repair (that would ship a half-finished
    // edit) and instead leaves the text to be delivered as-is.
    const completeToolCall = JSON.stringify({
      tool_calls: [{
        name: 'multi_replace_string_in_file',
        arguments: {
          explanation: 'Rename fields',
          filePath: 'zcl_x.abap',
          replacements: [
            { oldString: 'DATA: lv_a TYPE i.', newString: 'DATA: lv_a TYPE i.\n    DATA: lv_b TYPE i.' }
          ]
        }
      }]
    });
    const missingOuterBrace = completeToolCall.slice(0, -1); // one closer short
    const missingTwoClosers = completeToolCall.slice(0, -2); // two closers short

    const toolReq = (): OpenAIRequest => ({
      model: 'sonnet',
      messages: [{ role: 'user', content: 'Edit the class' }],
      stream: true,
      tools: [{ type: 'function', function: { name: 'multi_replace_string_in_file', parameters: {} } }]
    });

    async function collect(req: OpenAIRequest): Promise<any[]> {
      const events: any[] = [];
      for await (const event of wrapper.streamChatCompletion(req)) events.push(event);
      return events;
    }

    it('recovers a tool call missing only its trailing "}" on a clean stop', async () => {
      ClaudeClientMock.setDefaultResponse(missingOuterBrace); // mock reports finishReason 'stop'

      const events = await collect(toolReq());

      const toolEvent = events.find(e => e.type === 'tool_calls');
      expect(toolEvent).toBeDefined();
      expect(toolEvent.toolCalls[0].function.name).toBe('multi_replace_string_in_file');
      // arguments recovered as valid JSON with the multi-line content intact
      const args = JSON.parse(toolEvent.toolCalls[0].function.arguments);
      expect(args.replacements[0].newString).toContain('\n');
      // nothing leaked as visible text
      expect(events.some(e => e.type === 'text')).toBe(false);
      expect(events[events.length - 1]).toEqual(
        expect.objectContaining({ type: 'done', finishReason: 'tool_calls' })
      );
    });

    it('recovers a tool call missing several trailing brackets on a clean stop', async () => {
      ClaudeClientMock.setDefaultResponse(missingTwoClosers);

      const events = await collect(toolReq());

      const toolEvent = events.find(e => e.type === 'tool_calls');
      expect(toolEvent).toBeDefined();
      expect(toolEvent.toolCalls[0].function.name).toBe('multi_replace_string_in_file');
      expect(events.some(e => e.type === 'text')).toBe(false);
    });

    it('does NOT repair when the turn was length-truncated (leaks as text instead)', async () => {
      ClaudeClientMock.setDefaultResponse(missingOuterBrace);
      ClaudeClientMock.setStreamFinishReason('length'); // token-limit cutoff -> content genuinely incomplete

      const events = await collect(toolReq());

      expect(events.some(e => e.type === 'tool_calls')).toBe(false);
      const text = events.filter(e => e.type === 'text').map(e => e.text).join('');
      expect(text).toBe(missingOuterBrace);
    });

    it('does NOT repair when a value was cut off mid-string (leaks as text instead)', async () => {
      const midString =
        '{"tool_calls":[{"name":"replace_string_in_file","arguments":' +
        '{"filePath":"a.abap","newString":"line1\\nline2 and then it just stops';
      ClaudeClientMock.setDefaultResponse(midString);

      const events = await collect(toolReq());

      expect(events.some(e => e.type === 'tool_calls')).toBe(false);
      const text = events.filter(e => e.type === 'text').map(e => e.text).join('');
      expect(text).toBe(midString);
    });

    it('does NOT repair on the buffered (non-streaming) path, where the stop reason is unknown', async () => {
      const request: OpenAIRequest = {
        model: 'sonnet',
        messages: [{ role: 'user', content: 'Edit the class' }],
        tools: [{ type: 'function', function: { name: 'multi_replace_string_in_file' } }]
      };
      ClaudeClientMock.setDefaultResponse(missingOuterBrace);
      ValidatorMock.setValidationAsValid(false);

      const result = await wrapper.handleChatCompletion(request);

      expect(result.choices[0]!.message.tool_calls).toBeUndefined();
      expect(result.choices[0]!.message.content).toBe(missingOuterBrace);
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
