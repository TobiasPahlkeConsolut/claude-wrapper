# Claude Wrapper - Complete Documentation

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![GitHub Issues](https://img.shields.io/github/issues/TobiasPahlkeConsolut/claude-wrapper.svg)](https://github.com/TobiasPahlkeConsolut/claude-wrapper/issues)

**OpenAI-compatible HTTP API wrapper for Claude Code CLI**

Transform your Claude Code CLI into a powerful HTTP API server that accepts OpenAI Chat Completions requests. Every request is a single, stateless call to the `claude` CLI — full conversation history and system prompt in, one answer out — with real token-by-token streaming (including tool calls), an OpenAI-compatible tools workflow, and comprehensive CLI tooling.

## Table of Contents

- [Tools-First Philosophy](#tools-first-philosophy)
- [Key Features](#key-features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [CLI Options](#cli-options)
- [API Endpoints](#api-endpoints)
- [API Documentation](#api-documentation)
- [Quick Start](#quick-start)
- [CLI Usage](#cli-usage)
- [Authentication](#authentication)
- [Networking & Remote Access](#networking--remote-access)
- [Request Handling](#request-handling)
- [Tool Integration](#tool-integration)
- [Streaming](#streaming)
- [Configuration](#configuration)
- [Process Management](#process-management)
- [Development](#development)
- [Configuring VS Code (GitHub Copilot)](#configuring-vs-code-github-copilot)
- [Production Features](#production-features)

## Tools-First Philosophy

Claude Wrapper provides OpenAI Tools API compatibility:

- **Client-Side Execution**: Tools run in your local environment
- **OpenAI Standard**: Uses standard `tools` array format from OpenAI specification
- **MCP Compatible**: Works with your local MCP tool installations

This approach gives you maximum flexibility with Claude's tool capabilities.

## Key Features

- **🔌 OpenAI Compatible**: Drop-in replacement for OpenAI Chat Completions API
- **⚡ Stateless & Fast**: One `claude` CLI call per request — no server-side session state, no double round-trips for system prompts
- **🌊 Real Token-by-Token Streaming**: Server-Sent Events stream the model's output as it is produced (via the CLI's `stream-json` mode), including tool calls, with accurate token-usage reporting
- **🛡️ Secure by Default**: Binds to `127.0.0.1` (loopback) only, validates the requested model against an allowlist, and keeps `/logs` behind authentication
- **🔍 Auto-Detection**: Automatically finds the Claude CLI across common installation methods (npm global install, `where`/`which`, shell aliases, or the `CLAUDE_COMMAND` environment variable)
- **🔑 API Protection**: Optional bearer token authentication for endpoint security
- **🛠️ Client-Owned Tool Calls**: The server never executes tools itself (`--tools ""` / `--safe-mode`) — Claude answers or emits a `tool_calls` response, and your client executes it
- **🔄 Multi-Tool Support**: Multiple tools in single response with intelligent orchestration
- **📡 Cross-Platform**: Works across different Claude Code CLI installations
- **🏗️ Production Ready**: Comprehensive CLI, background services, and monitoring

## Prerequisites

Claude Wrapper is a thin layer over the **Claude Code CLI** — it shells out to the `claude` binary for every request rather than calling the Anthropic API directly. You must install and authenticate the CLI first.

1. **Install the Claude Code CLI.** Choose one:

   **a) npm (cross-platform, requires Node.js 22+):**

   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

   **b) Native install on Windows (PowerShell):** installs a standalone `claude.exe` — no Node.js required for the CLI itself:

   ```powershell
   irm https://claude.ai/install.ps1 | iex
   ```

   The native installer places the binary in `%USERPROFILE%\.local\bin` (e.g. `C:\Users\<you>\.local\bin\claude.exe`) and normally adds that folder to your PATH.

2. **Authenticate it** by running `claude` once and completing login (this uses your Claude subscription), or by exporting an `ANTHROPIC_API_KEY`.

3. **Verify** the CLI is available on your `PATH`:

   ```powershell
   claude --version
   ```

📖 Official Claude Code CLI documentation: <https://docs.claude.com/en/docs/claude-code>

The wrapper resolves the CLI automatically via your `PATH` (npm global install, `where`/`which`, or a shell alias). If `claude` lives somewhere non-standard, set the `CLAUDE_COMMAND` environment variable to its full path. (Docker-based auto-detection was removed to keep startup fast; use `CLAUDE_COMMAND` if you run the CLI through a wrapper script.)

### Adding the CLI to your PATH (Windows PowerShell)

If `claude --version` fails in a fresh terminal with *"command not found"*, the folder containing `claude` isn't on your PATH. This most often happens after an `npm install -g`, because npm's global bin folder isn't always on the PATH by default.

1. **Find the folder** that holds the binary:

   ```powershell
   # npm global installs land here:
   npm config get prefix        # e.g. C:\Users\<you>\AppData\Roaming\npm
   # Native installer instead uses:  %USERPROFILE%\.local\bin
   ```

2. **Add it to your PowerShell profile** so it's set for every session. `$PROFILE` is the path to your per-user profile script:

   ```powershell
   # Create the profile file the first time if it doesn't exist yet
   if (-not (Test-Path $PROFILE)) { New-Item -ItemType File -Path $PROFILE -Force }

   # Open it in Notepad to edit
   notepad $PROFILE
   ```

3. **Add these lines** to the profile, then save. This appends the npm global bin folder (and the native-installer folder) to PATH only if they aren't already present:

   ```powershell
   # Claude CLI locations
   $claudePaths = @("$env:APPDATA\npm", "$env:USERPROFILE\.local\bin")
   foreach ($p in $claudePaths) {
       if ((Test-Path $p) -and ($env:PATH -notlike "*$p*")) {
           $env:PATH = "$env:PATH;$p"
       }
   }
   ```

4. **Reload the profile** (or open a new terminal) and verify:

   ```powershell
   . $PROFILE
   claude --version
   ```

> **Scope:** editing `$PROFILE` sets PATH for your PowerShell sessions (including VS Code's integrated PowerShell terminal), which is where you'll run `wrapper`. To make the change apply system-wide (cmd.exe, GUI apps), set it as a persistent user environment variable instead — e.g. `[Environment]::SetEnvironmentVariable('Path', "$([Environment]::GetEnvironmentVariable('Path','User'));$env:APPDATA\npm", 'User')` — then restart your terminal.

## Installation

### Global Installation (Recommended)

```bash
# Clone, build, and link the CLI globally
git clone https://github.com/TobiasPahlkeConsolut/claude-wrapper.git
cd claude-wrapper
npm install
npm run build
cd app && npm link
```

### Local Development

```bash
# Clone and setup for development
git clone https://github.com/TobiasPahlkeConsolut/claude-wrapper.git
cd claude-wrapper
npm install
npm run build

# Development commands
npm run dev          # Development mode with ts-node
npm run build        # Build TypeScript to JavaScript
npm test            # Run tests
npm run test:unit    # Run unit tests only
npm run test:integration  # Run integration tests only

# Install CLI globally for testing
npm install -g .
```

## CLI Options

```bash
Usage: claude-wrapper [options] [port]

Claude API wrapper with OpenAI compatibility

Arguments:
  port                 port to run server on (default: 8000) - alternative to
                       --port option

Options:
  -V, --version        output the version number
  -p, --port <port>    port to run server on (default: 8000)
  -v, --verbose        enable verbose logging
  -d, --debug          enable debug mode (runs in foreground)
  --api-key <key>      set API key for endpoint protection
  --no-interactive     disable interactive API key setup
  --production         enable production server management features
  --health-monitoring  enable health monitoring system
  --stop               stop background server
  --status             check background server status
  -h, --help           display help for command
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/chat/completions` | Main chat completions with session support |
| `GET` | `/v1/models` | List available Claude models (Fable 5, Opus, Sonnet, Haiku — aliases and pinned versions) |
| `GET` | `/v1/sessions` | List all active sessions |
| `GET` | `/v1/sessions/stats` | Get session statistics |
| `GET` | `/v1/sessions/:id` | Get specific session details |
| `DELETE` | `/v1/sessions/:id` | Delete a specific session |
| `POST` | `/v1/sessions/:id/messages` | Add messages to a session |
| `GET` | `/v1/auth/status` | Check authentication configuration and status |
| `GET` | `/health` | Service health check |
| `GET` | `/docs` | Swagger UI |
| `GET` | `/swagger.json` | OpenAPI 3.0 specification JSON schema |

## API Documentation

Claude Wrapper includes comprehensive Swagger UI for interactive API exploration.

### Accessing Swagger UI

**Swagger UI:**
- Visit `http://localhost:8000/docs` in your browser
- Full OpenAPI 3.0 specification with interactive testing
- Try out API endpoints directly from the documentation
- Complete schema definitions for all request/response types

**OpenAPI Specification:**
- Download the spec at `http://localhost:8000/swagger.json`
- Use with API clients, code generators, or other tools
- Fully compliant OpenAPI 3.0 specification

### Swagger UI Features

- **Complete API Reference**: All endpoints, parameters, and responses documented
- **Interactive Testing**: Test API calls directly from Swagger UI
- **Schema Validation**: Full request/response schema definitions
- **Authentication Examples**: Shows both authenticated and unauthenticated usage
- **Tool Calling Documentation**: Complete OpenAI-compatible tool calling examples

## Quick Start

```bash
claude-wrapper
```

You'll see an interactive prompt asking if you want API key protection:

```
🚀 Starting Claude Wrapper...
🔐 API Key Protection Setup
Would you like to enable API key protection? (y/n): 
```

- **Choose 'y'** to generate a secure API key for protection
- **Choose 'n' or press Enter** to run without authentication

Server starts at `http://localhost:8000` - you're ready to make API calls!

**🚀 Quick Links:**
- Swagger UI: `http://localhost:8000/docs`
- Health Check: `http://localhost:8000/health`
- OpenAPI Spec: `http://localhost:8000/swagger.json`

**🔒 Networking:** the server binds to `127.0.0.1` (this machine only) by default. To reach it from another host — e.g. Windows reaching a server running inside WSL — start it with `HOST=0.0.0.0` and enable API-key protection (see [Networking & Remote Access](#networking--remote-access)).

### Alternative Authentication Options

```bash
# Skip interactive setup (no authentication)
claude-wrapper --no-interactive

# Or provide API key directly
claude-wrapper --api-key my-secure-key
```

## Authentication

### Authentication Methods

**Interactive Setup (Default)**
```bash
claude-wrapper
# Prompts for API key protection choice
```

**Direct API Key**
```bash
claude-wrapper --api-key my-secure-key
```

**Skip Interactive**
```bash
claude-wrapper --no-interactive
# Runs without authentication
```

**Environment Variable**
```bash
export API_KEY=my-secure-key
claude-wrapper
```

### API Usage Examples

**Without Authentication:**
```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "sonnet", "messages": [{"role": "user", "content": "Hello"}]}'
```

**With API Key:**
```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{"model": "sonnet", "messages": [{"role": "user", "content": "Hello"}]}'
```


## CLI Usage

### Starting the Server

```bash
# Start server on default port (8000)
claude-wrapper

# Start server on specific port
claude-wrapper 9999
claude-wrapper --port 8080

# Start with verbose logging
claude-wrapper --verbose

# Start with debug information (runs in foreground)
claude-wrapper --debug --verbose
```

### Managing the Background Service

```bash
# Check if server is running
claude-wrapper --status

# Stop the background server
claude-wrapper --stop

# View version
claude-wrapper --version

# Show help
claude-wrapper --help
```

## Networking & Remote Access

By default the server binds to `127.0.0.1`, so it is reachable only from the machine it runs on. This is deliberate: each request executes the `claude` CLI, so the endpoint should not be exposed to the network unless you intend it.

### Exposing the server

To listen on all interfaces (LAN / other hosts), set the `HOST` environment variable:

```bash
HOST=0.0.0.0 wrapper -p 8000
```

⚠️ When you do this, **enable API-key protection** (`--api-key` or the interactive prompt) — otherwise anyone who can reach the port can run the `claude` CLI through it.

### WSL (Windows Subsystem for Linux)

Automatic WSL port-forwarding script generation has been removed. If you run the wrapper inside WSL and want to reach it from Windows, do it manually:

1. Start the wrapper bound to all interfaces inside WSL:

   ```bash
   HOST=0.0.0.0 wrapper -p 8000 --api-key <your-key>
   ```

2. Find the WSL IP address:

   ```bash
   hostname -I
   ```

3. In an **Administrator** Windows terminal, add a port proxy from Windows to the WSL VM:

   ```cmd
   netsh interface portproxy add v4tov4 listenport=8000 listenaddress=0.0.0.0 connectport=8000 connectaddress=<WSL_IP>
   ```

   The server is then reachable from Windows at `http://localhost:8000`. Remove the proxy later with:

   ```cmd
   netsh interface portproxy delete v4tov4 listenport=8000
   ```

## Request Handling

Every chat completion is a single, stateless call to the `claude` CLI. There is no server-side Claude session and no `--resume` — the full message history the client sends is exactly what gets used to build that one call.

### How It Works

```bash
# Each request is independent - the client's own message history IS the state
Request 1: [System: "You are a helpful assistant"] + [User: "Hello"]   → one claude CLI call
Request 2: [System: "You are a helpful assistant"] + [User: "Hello"] + [Assistant: "Hi!"] + [User: "Goodbye"] → one claude CLI call
```

- **System prompt** → passed via the CLI's `--system-prompt-file` flag (replaces Claude Code's own default identity outright, rather than fighting it as embedded text)
- **Conversation history** (user/assistant/tool messages) → flattened and piped via stdin, redirected from a temp file so long IDE-supplied context never hits the OS command-line length limit
- **Tool execution** → disabled on the Claude Code side (`--tools "" --safe-mode`) so tool calls always come back to the client as a `tool_calls` response instead of Claude attempting to invoke them itself

This design was chosen after an earlier two-stage "session" implementation (system prompt registered once via `--resume`, then reused across requests) turned out to be pure overhead: IDE clients already resend the full history on every request, so there was nothing to cache. It also had a real bug — sessions were keyed only by a hash of the system prompt text, so unrelated conversations sharing a system prompt would bleed context into each other. The current one-call design is both simpler and roughly twice as fast for the common case of a new or changing system prompt.

Switching models mid-conversation (e.g. in an IDE's model picker) works cleanly for the same reason — nothing server-side is pinned to a particular model, so the next request just uses whichever `model` value it's given with the same accumulated history.

## Tool Integration

### OpenAI-Compatible Tool Calling

Claude Wrapper provides seamless integration with OpenAI's tool calling format:

```bash
# Tool call example
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sonnet",
    "messages": [{"role": "user", "content": "What files are in the current directory?"}],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "list_files",
          "description": "List files in a directory",
          "parameters": {
            "type": "object",
            "properties": {
              "path": {"type": "string", "description": "Directory path"}
            },
            "required": ["path"]
          }
        }
      }
    ],
    "tool_choice": "auto"
  }'
```

### Tool Features

- **Client-Side Execution**: Tools execute in your local environment
- **OpenAI Standard**: Uses OpenAI `tools` array specification
- **Multi-Tool Support**: Multiple tools in single response with orchestration
- **Streaming Tool Calls**: Real-time tool call streaming support

## Streaming

### Server-Sent Events (SSE) Implementation

```bash
# Streaming request example
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sonnet",
    "messages": [{"role": "user", "content": "Write a short story"}],
    "stream": true
  }'
```

### Streaming Features

- **Real Token-by-Token Streaming**: The wrapper spawns the CLI with `--output-format stream-json --include-partial-messages` and forwards each text delta as it is produced — output appears incrementally rather than all at once. (First-token latency is still bounded by the CLI's own cold start plus the model's time-to-first-token, typically a few seconds.)
- **Accurate Usage**: The final streamed chunk carries the real `usage` token counts reported by the CLI.
- **Tool Calls While Streaming**: Requests that include a `tools` array stream too. The wrapper watches the first non-whitespace character — a `{` means the model is emitting the `tool_calls` JSON convention (buffered and sent as one `tool_calls` chunk), anything else streams as plain text.
- **Connection Management**: Active connection tracking and cleanup
- **Error Streaming**: Error responses through streaming connections

## Configuration

### Environment Variables

#### Core Configuration
```bash
PORT=8000                    # Server port (default: 8000)
TIMEOUT=300000               # claude CLI execution timeout in ms (default: 300000 / 5 min)
NODE_ENV=production          # Environment mode (development/production)
LOG_LEVEL=info              # Logging level (debug/info/warn/error)
```

#### Authentication
```bash
API_KEY=your-api-key-here   # API key for endpoint protection
REQUIRE_API_KEY=true        # Force API key requirement
```

#### Session Management
```bash
SESSION_TTL=3600000         # Session TTL in milliseconds (1 hour)
SESSION_CLEANUP_INTERVAL=300000  # Cleanup interval in milliseconds (5 minutes)
SESSION_MESSAGE_LIMIT=100   # Maximum messages per session
```

#### Networking
```bash
HOST=127.0.0.1              # Interface to bind (default: 127.0.0.1 / loopback only)
                            # Set HOST=0.0.0.0 to expose on the LAN (enable auth if you do)
```

#### Streaming
Streaming behavior (connection ceiling, heartbeat interval) is configured via
constants in `app/src/config/constants.ts` (`STREAMING_CONFIG`), not environment
variables. The connection ceiling is 10 minutes and must stay above `TIMEOUT`,
since a streaming connection has to outlive the whole underlying `claude` CLI
call (plain-text answers stream incrementally; a tool-call response buffers the
CLI's full output before emitting the `tool_calls` chunk).

## Process Management

Claude Wrapper includes comprehensive process management capabilities for robust background service operation.

### Process Features

- **Daemon Process Management**: Spawns detached background processes
- **PID File Management**: Safe creation, validation, and cleanup of process files
- **Graceful Shutdown**: SIGTERM/SIGINT signal handling
- **Process Health Monitoring**: Real-time status checking and health validation
- **Performance Optimized**: <200ms operation targets

### Process Management Commands

```bash
# Start background service (daemon mode)
claude-wrapper
# Output: 🚀 Claude Wrapper server started in background (PID: 12345)

# Check detailed service status
claude-wrapper --status
# Output: 📊 Server Status: RUNNING
#         PID: 12345
#         Health: ✅ HEALTHY

# Stop background service gracefully
claude-wrapper --stop
# Output: ✅ Server stopped successfully
```

## Development

### Multi-Tier Testing Architecture

```bash
# Test commands
npm test                    # Run all tests
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests only
npm run test:e2e          # End-to-end tests only
npm run test:coverage     # Coverage analysis
npm run test:watch        # Watch mode
npm run test:debug        # Debug mode with open handles
```

### Development Tools

```bash
# Development commands
npm run dev               # Development mode with hot reload
npm run build            # Build TypeScript to JavaScript
npm run typecheck        # TypeScript type checking
npm run lint             # ESLint code quality
npm run lint:fix         # Auto-fix linting issues
npm run clean            # Clean build artifacts
```

### Code Quality Features

- **TypeScript 5.0+**: Full type safety and modern language features
- **ESLint**: Comprehensive code quality and style enforcement
- **Jest**: Advanced testing framework with custom configurations
- **SOLID Architecture**: Clean code principles with dependency injection
- **Performance Targets**: <200ms operation targets with monitoring

## Configuring VS Code (GitHub Copilot)

You can register Claude Wrapper as a custom, OpenAI-compatible model provider in VS Code and drive it from GitHub Copilot Chat. Point the provider at `http://localhost:8000/v1/` — the wrapper serves `/v1/models` for discovery and `/v1/chat/completions` with real streaming.

### Available models

`GET /v1/models` returns two kinds of identifiers:

- **Generic aliases** — `fable`, `opus`, `sonnet`, `haiku`. Each resolves to the latest model in that tier, so you get upgrades automatically.
- **Pinned versions** — e.g. `claude-fable-5`, `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`. These stay fixed to an exact model.

Use whichever you prefer in the `id` field; both are accepted. (Since model validation is enforced, the `id` must be one of the values returned by `/v1/models`.)

### Example configuration (generic aliases)

This uses the generic aliases so you always follow the latest model per tier:

```json
[
  {
    "name": "claude-wrapper",
    "vendor": "customendpoint",
    "models": [
      {
        "id": "fable",
        "name": "Fable",
        "url": "http://localhost:8000/v1/",
        "toolCalling": true,
        "vision": false,
        "maxInputTokens": 1000000,
        "maxOutputTokens": 128000
      },
      {
        "id": "opus",
        "name": "Opus",
        "url": "http://localhost:8000/v1/",
        "toolCalling": true,
        "vision": false,
        "maxInputTokens": 1000000,
        "maxOutputTokens": 128000
      },
      {
        "id": "sonnet",
        "name": "Sonnet",
        "url": "http://localhost:8000/v1/",
        "toolCalling": true,
        "vision": false,
        "maxInputTokens": 1000000,
        "maxOutputTokens": 128000
      },
      {
        "id": "haiku",
        "name": "Haiku",
        "url": "http://localhost:8000/v1/",
        "toolCalling": true,
        "vision": false,
        "maxInputTokens": 200000,
        "maxOutputTokens": 64000
      }
    ]
  }
]
```

### Notes

- `id` is sent to the wrapper (and on to the CLI's `--model`); `name` is only the label in the VS Code model picker.
- To pin an exact version, use a pinned id (e.g. `"id": "claude-sonnet-5"`). Aliases and pinned ids can be mixed in the same list.
- If you enabled API-key protection, supply the key in your Copilot provider configuration so requests carry `Authorization: Bearer <key>`.
- `vision` is `false`: the wrapper sends the conversation to the CLI as text, so image inputs are not supported.
- Copilot always sends a `tools` array; thanks to the first-token sniff (see [Streaming](#streaming)), those requests still stream token-by-token unless the model actually returns a tool call.

## Production Features

### Validated Concepts
- **Server builds the response envelope** - the model is never asked to fabricate ids/timestamps/usage or "become" a different API's schema (Claude Code correctly refuses that as an impersonation attempt); it only answers or emits a minimal `tool_calls` JSON snippet
- **Stateless request handling** - one `claude` CLI call per request, full history via stdin, system prompt via `--system-prompt-file`; no server-side session to drift out of sync
- **Client-owned tool execution** - Claude Code's own tool/MCP execution is disabled (`--tools "" --safe-mode`), so tool calls always round-trip back to the client instead of Claude trying (and failing) to invoke them itself
- **Cross-platform compatibility** - works across Claude installations
- **Streaming responses** - real-time Server-Sent Events, including tool calls

### Key Discoveries
- **Minimal, purpose-specific instructions beat full-envelope templates** - asking Claude to fabricate a complete fake API response reads as prompt injection and gets refused
- **Stdin + temp files** handle unlimited prompt and system-prompt lengths without hitting the OS command-line length limit
- **Client-side tool execution** provides security and flexibility, and matches how IDE tool integrations (e.g. MCP servers) actually work - they run in the client's process, not the wrapper's
- **Simple, stateless architecture** achieves enterprise-grade compatibility without the coordination bugs a server-side session cache introduces
- **Background services** provide production-ready reliability

### Performance
- **No parsing bottlenecks**
- **Direct JSON passthrough**
- **Horizontally scalable** architecture (no shared session state between instances)
- **Efficient session storage** with automatic cleanup (the separate `/v1/sessions` API, not the request-handling path)
- **Incremental streaming** — text deltas are forwarded as the CLI produces them (first-token latency is bounded by the CLI's startup and the model's time-to-first-token)

## Current Status

**Production-Ready Implementation:**
- **✅ Stateless request handling** - single `claude` CLI call per request, no server-side session drift
- **✅ Zero-conversion architecture** (direct JSON passthrough)
- **✅ Client-side tool execution** (Claude Code's own tools disabled; MCP integration stays client-side)
- **✅ Production CLI interface** with global installation
- **✅ Background service architecture** with proper daemon management
- **✅ Loopback-only binding by default** (`HOST=0.0.0.0` to opt into LAN exposure) with model-allowlist validation and authenticated `/logs`
- **✅ Real token-by-token streaming** with Server-Sent Events, including tool calls and accurate usage reporting
- **✅ Comprehensive test suite**

## License

MIT License - see [LICENSE](LICENSE) file for details.