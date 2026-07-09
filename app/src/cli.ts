#!/usr/bin/env node
/**
 * Claude Wrapper CLI Entry Point
 * Matches original claude-wrapper CLI pattern with options/flags
 * Single Responsibility: CLI argument parsing and application startup
 */

import { Command } from 'commander';
import { EnvironmentManager } from './config/env';
import { logger, LogLevel } from './utils/logger';
import { interactiveSetup } from './cli/interactive';
import * as packageJson from '../package.json';
import { processManager } from './process/manager';


/**
 * CLI options interface
 */
export interface CliOptions {
  port?: string;
  debug?: boolean;
  interactive?: boolean;
  apiKey?: string;
  stop?: boolean;
  status?: boolean;
}

/**
 * CLI argument parser following original pattern
 */
class CliParser {
  private program: Command;

  constructor() {
    this.program = new Command();
    this.setupProgram();
  }

  /**
   * Setup CLI program with options (not subcommands) like original
   */
  private setupProgram(): void {
    this.program
      .name('wrapper')
      .description(`${packageJson.description}\n\nAvailable commands: 'wrapper' (recommended) or 'claude-wrapper'`)
      .version(packageJson.version, '-v, --version', 'output the version number')
      .option('-p, --port <port>', 'port to run server on (default: 8000)')
      .option('-d, --debug', 'enable debug mode (runs in foreground with debug logging)')
      .option('-k, --api-key <key>', 'set API key for endpoint protection')
      .option('-n, --no-interactive', 'disable interactive API key setup')
      .option('-s, --stop', 'stop background server')
      .option('-t, --status', 'check background server status')
      .helpOption('-h, --help', 'display help for command')
      .argument('[port]', 'port to run server on (default: 8000) - alternative to --port option')
      .addHelpText('after', `
Examples:
  wrapper                    Start server on default port (8000)
  wrapper 9999              Start server on port 9999
  wrapper -p 8080           Start server on port 8080
  wrapper -v                Show version number
  wrapper -d                Start in debug mode
  wrapper -k my-key         Start with API key protection
  wrapper -n                Skip interactive API key setup
  wrapper -s                Stop background server
  wrapper -t                Check server status
  
Alternative command: You can also use 'claude-wrapper' instead of 'wrapper'`);
  }

  /**
   * Parse command line arguments
   */
  parseArguments(argv: string[]): CliOptions {
    this.program.parse(argv);
    const options = this.program.opts() as CliOptions;
    const args = this.program.args;
    
    return this.processOptions(options, args);
  }

  /**
   * Process parsed options and arguments
   */
  private processOptions(options: CliOptions, args: string[]): CliOptions {
    // Handle port from --port option or positional argument
    let portToUse = options.port;
    
    if (!portToUse && args.length > 0) {
      const portArg = args[0]!;
      const portNum = parseInt(portArg, 10);
      
      if (!isNaN(portNum) && portNum >= 1 && portNum <= 65535) {
        portToUse = portArg;
        logger.info(`Using port from command line: ${portNum}`);
      } else {
        logger.warn(`Invalid port number: ${portArg}. Using default.`);
      }
    }
    
    if (portToUse) {
      options.port = portToUse;
    }
    
    return options;
  }
}

/**
 * CLI application runner following original daemon pattern
 */
class CliRunner {
  private parser: CliParser;

  constructor() {
    this.parser = new CliParser();
  }

  /**
   * Run the CLI application
   */
  async run(argv: string[] = process.argv): Promise<void> {
    try {
      const options = this.parser.parseArguments(argv);


      // Handle daemon commands first (like original)
      if (options.stop) {
        await this.stopDaemon();
        process.exit(0);
        return;
      }

      if (options.status) {
        await this.checkDaemonStatus();
        process.exit(0);
        return;
      }

      // Default behavior: start server (like original)
      await this.startServer(options);

    } catch (error) {
      this.handleError(error as Error);
    }
  }

  /**
   * Start server with options
   */
  private async startServer(options: CliOptions): Promise<void> {
    const port = options.port || EnvironmentManager.getConfig().port.toString();

    // Interactive setup if enabled (like original)
    if (options.interactive !== false && !options.apiKey) {
      try {
        await interactiveSetup();
      } catch (error) {
        logger.warn('Interactive setup skipped:', error);
      }
    }


    try {
      // Run in foreground if debug mode is enabled
      if (options.debug) {
        await this.startForegroundServer(options, port);
      } else {
        const pid = await processManager.start({
          port,
          ...(options.apiKey && { apiKey: options.apiKey }),
          ...(options.debug !== undefined && { debug: options.debug }),
          ...(options.interactive !== undefined && { interactive: options.interactive })
        });

        console.log(`🚀 Claude Wrapper server started in background (PID: ${pid})`);
        console.log(`\n📡 API Endpoints:`);
        console.log(`   POST   http://localhost:${port}/v1/chat/completions      - Main chat API`);
        console.log(`   GET    http://localhost:${port}/v1/models                - List available models`);
        console.log(`   GET    http://localhost:${port}/v1/auth/status            - Auth status`);
        console.log(`\n🔧 System Endpoints:`);
        console.log(`   GET    http://localhost:${port}/health                   - Health check`);
        console.log(`   GET    http://localhost:${port}/docs                     - Swagger UI`);
        console.log(`   GET    http://localhost:${port}/swagger.json             - OpenAPI spec`);
        console.log(`   GET    http://localhost:${port}/logs                     - Server logs`);
        console.log(`   POST   http://localhost:${port}/logs/clear               - Clear logs`);

        process.exit(0);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('already running')) {
        console.log(`⚠️  ${error.message}`);
        process.exit(0);
      }
      throw error;
    }
  }

  /**
   * Start server in foreground (for debug mode)
   */
  private async startForegroundServer(options: CliOptions, port: string): Promise<void> {
    // Set environment variables
    if (options.apiKey) {
      process.env['API_KEY'] = options.apiKey;
    }
    if (options.debug) {
      process.env['DEBUG_MODE'] = 'true';
      // The logger singleton fixes its level at construction (import time),
      // before DEBUG_MODE is set here, so it would otherwise stay at INFO and
      // --debug would emit no debug output. Raise it explicitly so --debug
      // actually surfaces debug logs (e.g. prompt-cache usage) as documented.
      logger.setLevel(LogLevel.DEBUG);
    }

    // Import and start server directly
    const app = await import('./api/server');
    const { signalHandler } = await import('./process/signals');

    console.log(`🚀 Claude Wrapper server starting in foreground (debug mode)`);
    console.log(`\n📡 API Endpoints:`);
    console.log(`   POST   http://localhost:${port}/v1/chat/completions      - Main chat API`);
    console.log(`   GET    http://localhost:${port}/v1/models                - List available models`);
    console.log(`   GET    http://localhost:${port}/v1/auth/status            - Auth status`);
    console.log(`\n🔧 System Endpoints:`);
    console.log(`   GET    http://localhost:${port}/health                   - Health check`);
    console.log(`   GET    http://localhost:${port}/docs                     - Swagger UI`);
    console.log(`   GET    http://localhost:${port}/swagger.json             - OpenAPI spec`);
    console.log(`   GET    http://localhost:${port}/logs                     - Server logs`);
    console.log(`   POST   http://localhost:${port}/logs/clear               - Clear logs`);

    console.log(`\n🐛 Debug mode enabled - server will run in foreground`);
    console.log(`📝 Press Ctrl+C to stop the server`);

    const host = EnvironmentManager.getConfig().host;
    const server = app.default.listen(parseInt(port), host, () => {
      console.log(`✅ Server listening on ${host}:${port}`);
    });

    // Setup graceful shutdown
    signalHandler.setupGracefulShutdown(server);
    
    // Keep the process alive (don't exit)
    return new Promise(() => {
      // This promise never resolves, keeping the process running
    });
  }

  /**
   * Stop daemon server
   */
  private async stopDaemon(): Promise<void> {
    try {
      const stopped = await processManager.stop();
      if (stopped) {
        console.log(`✅ Server stopped successfully`);
      } else {
        console.log('❌ No background server found');
      }
    } catch (error) {
      console.log(`❌ Failed to stop server: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Check daemon status
   */
  private async checkDaemonStatus(): Promise<void> {
    try {
      const status = await processManager.status();
      
      if (status.running) {
        console.log('📊 Server Status: RUNNING');
        console.log(`   PID: ${status.pid}`);
        
        if (status.health) {
          const healthIcon = status.health === 'healthy' ? '✅' : 
                            status.health === 'unhealthy' ? '❌' : '❓';
          console.log(`   Health: ${healthIcon} ${status.health.toUpperCase()}`);
        }
      } else {
        console.log('📊 Server Status: NOT RUNNING');
      }
    } catch (error) {
      console.log(`❌ Failed to check status: ${error instanceof Error ? error.message : error}`);
    }
  }


  /**
   * Handle CLI errors
   */
  private handleError(error: Error): void {
    console.log('\n💥 Startup Failed!');
    console.log('==================================================');
    console.error(`❌ Failed to start server: ${error.message}`);
    console.error('\n🔧 Troubleshooting:');
    console.error('   1. Check if port is already in use');
    console.error('   2. Verify Claude Code CLI is installed');
    console.error('   3. Try running with --debug for more details');
    console.log('==================================================\n');
    
    process.exit(1);
  }
}

// Main execution
if (require.main === module) {
  const cli = new CliRunner();
  cli.run().catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
}

export { CliParser, CliRunner };