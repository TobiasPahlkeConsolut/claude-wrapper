# API Reference - Claude Wrapper

## 📋 Overview

The Claude Wrapper provides an OpenAI-compatible API interface for interacting with Claude Code CLI. This document describes all available endpoints, request/response formats, and authentication methods.

## 🌐 Base URL

```
http://localhost:8000
```

## 🔑 Authentication

### **HTTP API Protection (Optional)**
- **No Authentication Required**: Default mode - direct access to all endpoints
- **Bearer Token Protection**: Optional API key protection with `--api-key` flag
- **Selective Protection**: Health and models endpoints always public
- **Local Development**: Perfect for development and testing without auth overhead

## 📊 Core Endpoints

### **Chat Completions**

#### `POST /v1/chat/completions`

Create a chat completion using Claude Code CLI.

**Request Body:**
```json
{
  "model": "claude-opus-4-8",
  "messages": [
    {
      "role": "user",
      "content": "Hello, how are you?"
    }
  ],
  "max_tokens": 1000,
  "temperature": 0.7,
  "stream": false
}
```

**Response:**
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "claude-opus-4-8",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! I'm doing well, thank you for asking. How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 15,
    "total_tokens": 25
  }
}
```

**Request Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | Yes | Model identifier (e.g., "claude-opus-4-8") |
| `messages` | array | Yes | Array of conversation messages |
| `max_tokens` | integer | No | Maximum tokens in response (default: 1000) |
| `temperature` | number | No | Sampling temperature 0-2 (default: 0.7) |
| `stream` | boolean | No | Enable streaming responses (default: false) |
| `tools` | array | No | Available tools for function calling |
| `tool_choice` | string/object | No | Tool usage preference |

**Message Format:**
```json
{
  "role": "user|assistant|system|tool",
  "content": "Message content",
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "function_name",
        "arguments": "{\"param\":\"value\"}"
      }
    }
  ],
  "tool_call_id": "call_abc123"
}
```

**Tool Calls Example:**
```json
{
  "model": "claude-opus-4-8",
  "messages": [
    {
      "role": "user",
      "content": "What's the weather like today?"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather information",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {
              "type": "string",
              "description": "City name"
            }
          },
          "required": ["location"]
        }
      }
    }
  ]
}
```

**Error Responses:**
```json
{
  "error": {
    "message": "Invalid request format",
    "type": "invalid_request_error",
    "param": "messages",
    "code": "invalid_request"
  }
}
```

### **Streaming Chat Completions**

#### `POST /v1/chat/completions` (with `stream: true`)

Create a streaming chat completion using Server-Sent Events.

**Request Body:**
```json
{
  "model": "sonnet",
  "messages": [...],
  "stream": true
}
```

**Response Headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Response Format:**
```
data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1677652288,"model":"sonnet","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1677652288,"model":"sonnet","choices":[{"index":0,"delta":{"content":" there"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1677652288,"model":"sonnet","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

**Streaming Tool Calls:**

Unlike OpenAI, which fragments `function.arguments` across many deltas, this
wrapper waits for the complete (non-streamed) response and emits the tool
call as a single, complete delta — most OpenAI-compatible clients accumulate
`tool_calls` by `index` regardless of how many chunks the data arrives in, so
this parses identically to a properly fragmented stream:

```
data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1677652288,"model":"claude-opus-4-8","choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_abc123","type":"function","function":{"name":"get_weather","arguments":"{\"location\":\"San Francisco\"}"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1677652288,"model":"claude-opus-4-8","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}

data: [DONE]
```

## 🔍 Information Endpoints

### **Models**

#### `GET /v1/models`

List available models. Returns the four latest-of-tier aliases (which the
`claude` CLI resolves to the newest model in that tier) plus pinned full
model IDs for callers that want an exact version.

**Response:**
```json
{
  "object": "list",
  "data": [
    { "id": "fable", "object": "model", "owned_by": "anthropic", "created": 1709164800 },
    { "id": "opus", "object": "model", "owned_by": "anthropic", "created": 1709164800 },
    { "id": "sonnet", "object": "model", "owned_by": "anthropic", "created": 1709164800 },
    { "id": "haiku", "object": "model", "owned_by": "anthropic", "created": 1709164800 },
    { "id": "claude-fable-5", "object": "model", "owned_by": "anthropic", "created": 1709164800 },
    { "id": "claude-opus-4-8", "object": "model", "owned_by": "anthropic", "created": 1709164800 },
    { "id": "claude-opus-4-7", "object": "model", "owned_by": "anthropic", "created": 1709164800 },
    { "id": "claude-opus-4-6", "object": "model", "owned_by": "anthropic", "created": 1709164800 },
    { "id": "claude-sonnet-5", "object": "model", "owned_by": "anthropic", "created": 1709164800 },
    { "id": "claude-sonnet-4-6", "object": "model", "owned_by": "anthropic", "created": 1709164800 },
    { "id": "claude-haiku-4-5", "object": "model", "owned_by": "anthropic", "created": 1709164800 }
  ]
}
```

Update `app/src/api/routes/models.ts` when new models ship — see
`shared/models.md` in the claude-api skill for current model IDs.

### **Health Check**

#### `GET /health`

Service health status.

**Response:**
```json
{
  "status": "healthy",
  "service": "claude-wrapper",
  "description": "OpenAI-compatible HTTP API wrapper for Claude Code CLI with Session Management",
  "version": "1.1.27",
  "timestamp": "2024-01-01T00:00:00Z"
}
```


## 🗂️ Session Management Endpoints (Planned)

### **List Sessions**

#### `GET /v1/sessions`

List active sessions.

**Response:**
```json
{
  "sessions": [
    {
      "id": "session_abc123",
      "created_at": "2024-01-01T00:00:00Z",
      "last_activity": "2024-01-01T00:10:00Z",
      "message_count": 5,
      "expires_at": "2024-01-01T01:00:00Z"
    }
  ]
}
```

### **Get Session**

#### `GET /v1/sessions/{session_id}`

Get specific session information.

**Response:**
```json
{
  "id": "session_abc123",
  "created_at": "2024-01-01T00:00:00Z",
  "last_activity": "2024-01-01T00:10:00Z",
  "message_count": 5,
  "expires_at": "2024-01-01T01:00:00Z",
  "messages": [
    {
      "role": "user",
      "content": "Hello",
      "timestamp": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### **Delete Session**

#### `DELETE /v1/sessions/{session_id}`

Delete a specific session.

**Response:**
```json
{
  "deleted": true,
  "id": "session_abc123"
}
```

### **Session Statistics**

#### `GET /v1/sessions/stats`

Get session statistics.

**Response:**
```json
{
  "total_sessions": 10,
  "active_sessions": 3,
  "total_messages": 150,
  "average_session_length": 15.5
}
```

## 🛠️ Tool Integration

### **Tool Call Format**

The wrapper supports OpenAI-compatible tool calls:

```json
{
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "get_weather",
        "arguments": "{\"location\":\"San Francisco\"}"
      }
    }
  ]
}
```

### **Tool Result Format**

Tool results are provided back to the model:

```json
{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "content": "{\"temperature\": 72, \"condition\": \"sunny\"}"
}
```

## 📊 Error Handling

### **Error Response Format**

All errors follow OpenAI's error format:

```json
{
  "error": {
    "message": "Error description",
    "type": "error_type",
    "param": "parameter_name",
    "code": "error_code"
  }
}
```

### **Error Types**

| Type | Description | HTTP Status |
|------|-------------|-------------|
| `invalid_request_error` | Invalid request format or parameters | 400 |
| `authentication_error` | Authentication failed | 401 |
| `permission_error` | Insufficient permissions | 403 |
| `not_found_error` | Resource not found | 404 |
| `rate_limit_error` | Rate limit exceeded | 429 |
| `internal_server_error` | Internal server error | 500 |
| `service_unavailable_error` | Service temporarily unavailable | 503 |

### **Common Error Codes**

| Code | Description |
|------|-------------|
| `invalid_request` | Request format is invalid |
| `missing_required_parameter` | Required parameter is missing |
| `invalid_parameter_value` | Parameter value is invalid |
| `authentication_failed` | Authentication credentials are invalid |
| `rate_limit_exceeded` | Rate limit has been exceeded |
| `claude_unavailable` | Claude CLI is not available |
| `timeout` | Request timed out |

## 🔄 Request/Response Examples

### **Simple Chat**

**Request:**
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-8",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

**Response:**
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "claude-opus-4-8",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 8,
    "completion_tokens": 12,
    "total_tokens": 20
  }
}
```

### **Tool Call Example**

**Request:**
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-8",
    "messages": [
      {"role": "user", "content": "What is 2+2?"}
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "calculate",
          "description": "Perform mathematical calculations",
          "parameters": {
            "type": "object",
            "properties": {
              "expression": {"type": "string"}
            },
            "required": ["expression"]
          }
        }
      }
    ]
  }'
```

**Response:**
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "claude-opus-4-8",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_abc123",
            "type": "function",
            "function": {
              "name": "calculate",
              "arguments": "{\"expression\": \"2+2\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ],
  "usage": {
    "prompt_tokens": 85,
    "completion_tokens": 15,
    "total_tokens": 100
  }
}
```

### **Streaming Example**

**Request:**
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-opus-4-8",
    "messages": [
      {"role": "user", "content": "Tell me a short story"}
    ],
    "stream": true
  }'
```

**Response:**
```
data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1677652288,"model":"claude-opus-4-8","choices":[{"index":0,"delta":{"role":"assistant","content":"Once"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1677652288,"model":"claude-opus-4-8","choices":[{"index":0,"delta":{"content":" upon"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1677652288,"model":"claude-opus-4-8","choices":[{"index":0,"delta":{"content":" a"},"finish_reason":null}]}

data: [DONE]
```

## ⏱️ Limits & Timeouts

- **Request body size**: 50MB (IDE clients like VS Code resend full conversation history plus tool schemas on every request, which routinely exceeds Express's 100KB default)
- **`claude` CLI execution timeout**: 5 minutes per call (Claude Code turns involving reasoning or tool use can legitimately take well over 30 seconds)
- **Streaming connection ceiling**: 10 minutes (must exceed the CLI timeout above, since the streaming handler waits for one full non-streamed response before chunking it out)

## 📈 Rate Limiting

### **Development Mode**
- **No Rate Limiting**: Unlimited requests for development

### **Production Mode (Planned)**
- **Per-API Key**: 1000 requests per hour
- **Per-IP**: 100 requests per hour (unauthenticated)
- **Burst Allowance**: 10 requests per minute

## 🏷️ Versioning

### **API Version**
- **Current**: v1
- **Stability**: Stable for core endpoints
- **Deprecation**: 6-month notice for breaking changes

### **Compatibility**
- **OpenAI API**: Compatible with OpenAI Chat Completions API
- **Tool Calls**: Full support for OpenAI tool calling format
- **Streaming**: Compatible with OpenAI streaming format

This API reference provides complete documentation for all current and planned endpoints in the Claude Wrapper system.