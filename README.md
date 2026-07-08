# Claude Wrapper

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform Support](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue.svg)](https://github.com/TobiasPahlkeConsolut/claude-wrapper)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**OpenAI-compatible HTTP API wrapper for Claude Code CLI with Session Management**

Transform your Claude Code CLI into a powerful HTTP API server with intelligent session management, streaming responses, and OpenAI-compatible tool calling.

## 🛠️ Tools-First Philosophy

**Claude Wrapper provides OpenAI Tools API compatibility:**

- **Client-Side Execution**: Tools run in your local environment
- **OpenAI Standard**: Uses standard `tools` array format from OpenAI specification
- **MCP Compatible**: Works with your local MCP tool installations

This approach gives you **maximum flexibility** with Claude's tool capabilities.

## Key Features

- **OpenAI Compatible**: Drop-in replacement for OpenAI Chat Completions API
- **Stateless by Design**: Every request is a single, self-contained call to the `claude` CLI — no server-side session state to get out of sync, no double round-trips for system prompts
- **Real Token-by-Token Streaming**: Server-Sent Events stream plain-text answers as they are produced (via the CLI's `stream-json` mode), with accurate token-usage reporting. Tool-calling requests are buffered in full and the tool call is returned as a single `tool_calls` chunk, so it is detected reliably however the model formats it (bare JSON, wrapped in a fence, or after a prose preamble)
- **Secure by Default**: Binds to `127.0.0.1` (loopback) only, validates the requested model against an allowlist, and keeps `/logs` behind authentication
- **MCP Tools Support**: Full compatibility with OpenAI MCP tools and function calling — tool execution stays on the client side, this wrapper never runs tools itself
- **Latest Models**: Exposes the current Claude model lineup both as generic aliases (`fable`, `opus`, `sonnet`, `haiku`) and pinned versions via `/v1/models`

## ✅ Prerequisites

This wrapper drives the **Claude Code CLI** — it does not talk to the Anthropic API directly. You must have the `claude` CLI installed and authenticated before running the wrapper.

1. **Install the Claude Code CLI.** Either:

   ```bash
   # npm (cross-platform, requires Node.js 22+)
   npm install -g @anthropic-ai/claude-code
   ```

   ```powershell
   # Native install on Windows (PowerShell) — standalone claude.exe, no Node.js needed for the CLI
   irm https://claude.ai/install.ps1 | iex
   ```

   The native installer puts `claude.exe` in `%USERPROFILE%\.local\bin` and normally adds it to your PATH.

2. **Authenticate it** by running `claude` once and completing login (this uses your Claude subscription), or by setting an `ANTHROPIC_API_KEY`.

3. **Verify** it is on your `PATH`:

   ```powershell
   claude --version
   ```

📖 Official Claude Code CLI documentation: <https://docs.claude.com/en/docs/claude-code>

The wrapper locates the CLI automatically via your `PATH` (npm global install, `where`/`which`, or shell alias). If it lives somewhere unusual, set `CLAUDE_COMMAND` to its full path.

### Adding the CLI to your PATH (Windows PowerShell)

If `claude --version` reports *"command not found"* in a new terminal, the folder containing the binary isn't on your PATH — common after `npm install -g`, since npm's global bin folder isn't always on PATH by default.

```powershell
# 1. Find the folder that holds claude
npm config get prefix          # npm global bin, e.g. C:\Users\<you>\AppData\Roaming\npm
                               # (native installer uses %USERPROFILE%\.local\bin instead)

# 2. Create your PowerShell profile if needed, then edit it
if (-not (Test-Path $PROFILE)) { New-Item -ItemType File -Path $PROFILE -Force }
notepad $PROFILE
```

Add this to the profile and save — it adds both the npm global bin and the native-installer folder to PATH if they exist:

```powershell
# Claude CLI locations
$claudePaths = @("$env:APPDATA\npm", "$env:USERPROFILE\.local\bin")
foreach ($p in $claudePaths) {
    if ((Test-Path $p) -and ($env:PATH -notlike "*$p*")) {
        $env:PATH = "$env:PATH;$p"
    }
}
```

Then reload and verify:

```powershell
. $PROFILE
claude --version
```

> Editing `$PROFILE` sets PATH for PowerShell sessions (including VS Code's integrated terminal, where you'll run `wrapper`). For a system-wide change, set a persistent user environment variable instead.

## 📦 Installation

```bash
# Clone the repo and build it
git clone https://github.com/TobiasPahlkeConsolut/claude-wrapper.git
cd claude-wrapper
npm install
npm run build

# Link the CLI globally
cd app
npm link
```

After installation, you can use the CLI with either:

- `wrapper` (recommended short command)
- `claude-wrapper` (full package name)

## 🚀 Quick Start

```bash
wrapper
```

You'll see an interactive prompt asking if you want API key protection:

```bash
🚀 Starting Claude Wrapper...
🔐 API Key Protection Setup
Would you like to enable API key protection? (y/n):


- **Choose 'y'** to generate a secure API key for protection
- **Choose 'n' or press Enter** to run without authentication
```

Server starts at `http://localhost:8000` - you're ready to make API calls!

> **Networking:** the server binds to `127.0.0.1` (this machine only) by default. To expose it on your LAN — for example a WSL instance you reach from Windows — start it with `HOST=0.0.0.0`, and pair that with API-key protection since the endpoint executes the `claude` CLI.

## 📋 CLI Options

```bash
Usage: wrapper [options] [port]

Claude API wrapper with OpenAI compatibility

Arguments:
  port                 port to run server on (default: 8000) - alternative to
                       --port option

Options:
  -v, --version        output the version number
  -p, --port <port>    port to run server on (default: 8000)
  -d, --debug          enable debug mode (runs in foreground)
  -k, --api-key <key>  set API key for endpoint protection
  -n, --no-interactive disable interactive API key setup
  -P, --production     enable production server management features
  -H, --health-monitoring enable health monitoring system
  -s, --stop           stop background server
  -t, --status         check background server status
  -h, --help           display help for command
```

### Authentication Options

**Authentication is completely optional!** You can also bypass the interactive setup:

```bash
# Skip interactive setup (no authentication)
wrapper --no-interactive
wrapper -n                         # shorthand

# Or provide API key directly
wrapper --api-key my-secure-key
wrapper -k my-secure-key           # shorthand
```

## 📡 API Endpoints

| Method   | Endpoint                    | Description                                   |
| -------- | --------------------------- | --------------------------------------------- |
| `POST`   | `/v1/chat/completions`      | Main chat completions with session support    |
| `GET`    | `/v1/models`                | List available Claude models (Fable 5, Opus, Sonnet, Haiku — aliases and pinned versions) |
| `GET`    | `/v1/sessions`              | List all active sessions                      |
| `GET`    | `/v1/sessions/stats`        | Get session statistics                        |
| `GET`    | `/v1/sessions/:id`          | Get specific session details                  |
| `DELETE` | `/v1/sessions/:id`          | Delete a specific session                     |
| `POST`   | `/v1/sessions/:id/messages` | Add messages to a session                     |
| `GET`    | `/v1/auth/status`           | Check authentication configuration and status |
| `GET`    | `/health`                   | Service health check                          |
| `GET`    | `/docs`                     | Swagger UI                                    |
| `GET`    | `/swagger.json`             | OpenAPI 3.0 specification JSON schema         |

## 🚀 CLI Usage

### Starting the Server

```bash
# Start server on default port (8000)
wrapper

# Start server on specific port
wrapper 9999
wrapper --port 8080
wrapper -p 8080                    # shorthand

# Show version
wrapper --version
wrapper -v                         # shorthand

# Start with debug information (runs in foreground)
wrapper --debug
wrapper -d                         # shorthand
```

### Managing the Background Service

```bash
# Check if server is running
wrapper --status
wrapper -t                         # shorthand

# Stop the background server
wrapper --stop
wrapper -s                         # shorthand
```

## 🧩 Using with VS Code (GitHub Copilot)

You can use this wrapper as a custom model provider in VS Code by pointing Copilot's OpenAI-compatible endpoint at `http://localhost:8000/v1/`. The wrapper serves both `/v1/models` (for discovery) and `/v1/chat/completions` (with real streaming).

Add the following to your model configuration. This uses the **generic aliases**, so you automatically follow the latest model in each tier:

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

Notes:

- `id` is the value sent to the wrapper (and on to the CLI's `--model`); it must be one of the models listed by `GET /v1/models`. `name` is just the label shown in the VS Code model picker.
- To pin an exact version instead of following the latest, use a pinned id (e.g. `"id": "claude-sonnet-5"`). You can mix aliases and pinned ids in the same list.
- If you enabled API-key protection, add your key to the provider configuration as required by your Copilot setup so requests include `Authorization: Bearer <key>`.
- `vision` is `false` because the wrapper passes the conversation to the CLI as text; image inputs are not supported.

## 📚 Documentation

📖 **[Full Documentation](docs/README.md)** - Comprehensive guide with detailed examples, production deployment, troubleshooting, and advanced configuration.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

🐛 **Report issues** or suggest features at [GitHub Issues](https://github.com/TobiasPahlkeConsolut/claude-wrapper/issues)

**Get started today** - clone the repo, build it, and run `wrapper` to transform your Claude CLI into a powerful HTTP API!
