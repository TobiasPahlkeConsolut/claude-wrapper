import swaggerJSDoc from 'swagger-jsdoc';
import { OpenAPIV3 } from 'openapi-types';

const swaggerDefinition: OpenAPIV3.Document = {
  openapi: '3.0.0',
  info: {
    title: 'Claude Wrapper API',
    version: '1.0.0',
    description: 'OpenAI-compatible HTTP API wrapper for Claude Code CLI with session management',
    contact: {
      name: 'Claude Wrapper',
      url: 'https://github.com/your-org/claude-wrapper-poc'
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT'
    }
  },
  servers: [
    {
      url: 'http://localhost:8000',
      description: 'Development server'
    }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'string',
        description: 'Optional bearer token authentication for protected endpoints'
      }
    },
    schemas: {
      ChatCompletionRequest: {
        type: 'object',
        required: ['model', 'messages'],
        properties: {
          model: {
            type: 'string',
            description: 'Model identifier from GET /v1/models, optionally with an effort suffix ":<low|medium|high|xhigh|max>" (e.g. "opus:high") to set the CLI\'s reasoning --effort. Omit the suffix to use the CLI default.',
            example: 'opus:high'
          },
          messages: {
            type: 'array',
            description: 'Array of conversation messages',
            items: {
              $ref: '#/components/schemas/ChatMessage'
            }
          },
          max_tokens: {
            type: 'integer',
            description: 'Maximum tokens in response',
            default: 1000,
            minimum: 1
          },
          temperature: {
            type: 'number',
            description: 'Sampling temperature 0-2',
            default: 0.7,
            minimum: 0,
            maximum: 2
          },
          stream: {
            type: 'boolean',
            description: 'Enable streaming responses',
            default: false
          },
          tools: {
            type: 'array',
            description: 'Available tools for function calling',
            items: {
              $ref: '#/components/schemas/Tool'
            }
          },
          tool_choice: {
            oneOf: [
              { type: 'string', enum: ['auto', 'none'] },
              { $ref: '#/components/schemas/ToolChoice' }
            ],
            description: 'Tool usage preference'
          }
        }
      },
      ChatMessage: {
        type: 'object',
        required: ['role', 'content'],
        properties: {
          role: {
            type: 'string',
            enum: ['user', 'assistant', 'system', 'tool'],
            description: 'Message role'
          },
          content: {
            type: 'string',
            description: 'Message content'
          },
          tool_calls: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/ToolCall'
            }
          },
          tool_call_id: {
            type: 'string',
            description: 'Tool call ID for tool responses'
          }
        }
      },
      ChatCompletionResponse: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Completion ID',
            example: 'chatcmpl-abc123'
          },
          object: {
            type: 'string',
            enum: ['chat.completion'],
            description: 'Response object type'
          },
          created: {
            type: 'integer',
            description: 'Unix timestamp of creation',
            example: 1677652288
          },
          model: {
            type: 'string',
            description: 'Model used for completion',
            example: 'claude-3-5-sonnet-20241022'
          },
          choices: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/ChatCompletionChoice'
            }
          },
          usage: {
            $ref: '#/components/schemas/Usage'
          }
        }
      },
      ChatCompletionChoice: {
        type: 'object',
        properties: {
          index: {
            type: 'integer',
            description: 'Choice index'
          },
          message: {
            $ref: '#/components/schemas/ChatMessage'
          },
          finish_reason: {
            type: 'string',
            enum: ['stop', 'length', 'tool_calls'],
            description: 'Reason for completion finish'
          }
        }
      },
      Tool: {
        type: 'object',
        required: ['type', 'function'],
        properties: {
          type: {
            type: 'string',
            enum: ['function']
          },
          function: {
            $ref: '#/components/schemas/FunctionDefinition'
          }
        }
      },
      FunctionDefinition: {
        type: 'object',
        required: ['name', 'description'],
        properties: {
          name: {
            type: 'string',
            description: 'Function name'
          },
          description: {
            type: 'string',
            description: 'Function description'
          },
          parameters: {
            type: 'object',
            description: 'Function parameters schema'
          }
        }
      },
      ToolCall: {
        type: 'object',
        required: ['id', 'type', 'function'],
        properties: {
          id: {
            type: 'string',
            description: 'Tool call ID'
          },
          type: {
            type: 'string',
            enum: ['function']
          },
          function: {
            type: 'object',
            required: ['name', 'arguments'],
            properties: {
              name: {
                type: 'string',
                description: 'Function name'
              },
              arguments: {
                type: 'string',
                description: 'Function arguments as JSON string'
              }
            }
          }
        }
      },
      ToolChoice: {
        type: 'object',
        required: ['type', 'function'],
        properties: {
          type: {
            type: 'string',
            enum: ['function']
          },
          function: {
            type: 'object',
            required: ['name'],
            properties: {
              name: {
                type: 'string',
                description: 'Function name to call'
              }
            }
          }
        }
      },
      Usage: {
        type: 'object',
        properties: {
          prompt_tokens: {
            type: 'integer',
            description: 'Number of tokens in prompt'
          },
          completion_tokens: {
            type: 'integer',
            description: 'Number of tokens in completion'
          },
          total_tokens: {
            type: 'integer',
            description: 'Total number of tokens'
          }
        }
      },
      ModelsResponse: {
        type: 'object',
        properties: {
          object: {
            type: 'string',
            enum: ['list']
          },
          data: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/Model'
            }
          }
        }
      },
      Model: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Model identifier'
          },
          object: {
            type: 'string',
            enum: ['model']
          },
          owned_by: {
            type: 'string',
            description: 'Model owner'
          },
          created: {
            type: 'integer',
            description: 'Creation timestamp'
          }
        }
      },
      HealthResponse: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['healthy'],
            description: 'Service health status'
          },
          service: {
            type: 'string',
            description: 'Service name'
          },
          version: {
            type: 'string',
            description: 'Service version'
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            description: 'Health check timestamp'
          }
        }
      },
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'Error message'
              },
              type: {
                type: 'string',
                description: 'Error type'
              },
              code: {
                type: 'string',
                description: 'Error code'
              },
              param: {
                type: 'string',
                description: 'Parameter causing error'
              }
            }
          }
        }
      }
    }
  },
  paths: {
    '/v1/chat/completions': {
      post: {
        tags: ['Chat Completions'],
        summary: 'Create chat completion',
        description: 'Create a chat completion using Claude Code CLI with optional session management',
        security: [
          { bearerAuth: [] },
          {}
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ChatCompletionRequest'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Chat completion response',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ChatCompletionResponse'
                }
              },
              'text/event-stream': {
                schema: {
                  type: 'string',
                  example: 'data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1677652288,"model":"claude-3-5-sonnet-20241022","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}\n\ndata: [DONE]'
                }
              }
            }
          },
          '400': {
            description: 'Invalid request',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error'
                }
              }
            }
          },
          '401': {
            description: 'Authentication required',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error'
                }
              }
            }
          },
          '500': {
            description: 'Internal server error',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error'
                }
              }
            }
          }
        }
      }
    },
    '/v1/models': {
      get: {
        tags: ['Models'],
        summary: 'List available models',
        description: 'Get a list of available Claude models',
        responses: {
          '200': {
            description: 'List of available models',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ModelsResponse'
                }
              }
            }
          }
        }
      }
    },
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        description: 'Get service health status',
        responses: {
          '200': {
            description: 'Service health status',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/HealthResponse'
                }
              }
            }
          }
        }
      }
    }
  }
};

const options = {
  definition: swaggerDefinition,
  apis: ['./src/api/routes/*.ts'], // Path to API docs
};

export const swaggerSpec = swaggerJSDoc(options);