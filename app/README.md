# Claude Wrapper

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform Support](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue.svg)](https://github.com/TobiasPahlkeConsolut/claude-wrapper)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**OpenAI-compatible HTTP API wrapper for Claude Code CLI**

Transform your Claude Code CLI into a powerful HTTP API server with real streaming responses and OpenAI-compatible tool calling. Every request is a single, self-contained call to the `claude` CLI — the wrapper holds no conversation state between requests.

## 🛠️ Tools-First Philosophy

**Claude Wrapper provides OpenAI Tools API compatibility:**

- **Client-Side Execution**: Tools run in your local environment
- **OpenAI Standard**: Uses standard `tools` array format from OpenAI specification
- **MCP Compatible**: Works with your local MCP tool installations

This approach gives you **maximum flexibility** with Claude's tool capabilities.

## Key Features

- **OpenAI Compatible**: Drop-in replacement for OpenAI Chat Completions API
- **Stateless by Design**: Every request is a single, self-contained call to the `claude` CLI — no server-side session state to get out of sync
- **Streaming Support**: Real-time response streaming with Server-Sent Events

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

## 📋 CLI Options

```bash
Usage: wrapper [options] [port]

OpenAI-compatible HTTP API wrapper for Claude Code CLI

Arguments:
  port                  port to run server on (default: 8000) - alternative to --port option

Options:
  -v, --version         output the version number
  -p, --port <port>     port to run server on (default: 8000)
  -d, --debug           enable debug mode (runs in foreground with debug logging)
  -k, --api-key <key>   set API key for endpoint protection
  -n, --no-interactive  disable interactive API key setup
  -s, --stop            stop background server
  -t, --status          check background server status
  -h, --help            display help for command
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
| `POST`   | `/v1/chat/completions`      | Main chat completions endpoint (stateless — one CLI call per request) |
| `GET`    | `/v1/models`                | List available Claude models (Fable 5, Opus, Sonnet, Haiku) |
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

## 📚 Documentation

📖 **[Full Documentation](docs/README.md)** - Comprehensive guide with detailed examples, production deployment, troubleshooting, and advanced configuration.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

🐛 **Report issues** or suggest features at [GitHub Issues](https://github.com/TobiasPahlkeConsolut/claude-wrapper/issues)

**Get started today** - clone the repo, build it, and run `wrapper` to transform your Claude CLI into a powerful HTTP API!
