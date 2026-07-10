/**
 * Daemon management for background process operations
 * Extracted from server-daemon.ts and cli.ts for separation of concerns
 * 
 * Single Responsibility: Handle daemon process creation and management
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { PROCESS_CONFIG, PROCESS_PERFORMANCE, API_CONSTANTS } from '../config/constants';
import { logger } from '../utils/logger';
import { pidManager } from './pid';

/**
 * Daemon process options
 */
export interface DaemonOptions {
  port?: string;
  apiKey?: string;
  verbose?: boolean;
  debug?: boolean;
  scriptPath?: string;
}

/**
 * Daemon manager interface (ISP compliance)
 */
export interface IDaemonManager {
  startDaemon(options: DaemonOptions): Promise<number>;
  isDaemonRunning(): boolean;
  stopDaemon(): Promise<boolean>;
  getDaemonStatus(): Promise<{ running: boolean; pid: number | null }>;
}

/**
 * Process error for daemon operations
 */
export class DaemonError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly pid?: number
  ) {
    super(message);
    this.name = 'DaemonError';
  }
}

/**
 * Daemon manager implementation following SOLID principles
 */
export class DaemonManager implements IDaemonManager {
  constructor() {
    logger.debug('DaemonManager initialized');
  }

  /**
   * Start daemon process in background
   */
  async startDaemon(options: DaemonOptions): Promise<number> {
    // Check if already running
    if (this.isDaemonRunning()) {
      const pid = pidManager.readPid();
      throw new DaemonError(
        `Daemon already running with PID ${pid}`,
        'start',
        pid || undefined
      );
    }

    const scriptPath = options.scriptPath || this.getDefaultScriptPath();
    const args = this.buildDaemonArgs(options);

    logger.debug('Starting daemon process', { scriptPath, args });

    try {
      const child = spawn(process.execPath, [scriptPath, ...args], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true, // don't flash a console window when detaching the daemon
        env: {
          ...process.env  // Inherit parent environment variables
        }
      });

      if (!child.pid) {
        throw new DaemonError('Failed to spawn daemon process', 'start');
      }
      const pid = child.pid;

      // Save PID for management (non-fatal if this fails)
      try {
        pidManager.savePid(pid);
      } catch (pidError) {
        logger.warn('Failed to save PID file, daemon started but may be harder to manage', { pid, error: pidError instanceof Error ? pidError.message : 'Unknown error' });
      }

      // Allow parent to exit
      child.unref();

      // spawn() only tells us the child process launched, not that the server
      // inside it bound the port. The daemon is detached with stdio:'ignore',
      // so a bind failure (e.g. the port is already in use) is otherwise
      // invisible - we'd return the pid and the CLI would print "started
      // successfully" for a server that immediately died. Wait until it
      // actually answers on /health before declaring success, and clean up the
      // pid/child if it never does.
      const port = options.port ? parseInt(options.port, 10) : API_CONSTANTS.DEFAULT_PORT;
      try {
        await this.waitForServerReady(port, PROCESS_PERFORMANCE.STARTUP_TIMEOUT_MS);
      } catch (readyError) {
        try { process.kill(pid); } catch { /* child likely already exited */ }
        try { pidManager.cleanupPidFile(); } catch { /* best effort */ }
        throw new DaemonError(
          `Daemon (PID ${pid}) did not start listening on port ${port} within ` +
          `${PROCESS_PERFORMANCE.STARTUP_TIMEOUT_MS}ms - the port may already be in use.`,
          'start',
          pid
        );
      }

      logger.info('Daemon process started successfully', { pid });
      return pid;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to start daemon process', error instanceof Error ? error : undefined, { error: errorMessage });
      
      throw new DaemonError(
        `Failed to start daemon: ${errorMessage}`,
        'start'
      );
    }
  }

  /**
   * Check if daemon is currently running
   */
  isDaemonRunning(): boolean {
    return pidManager.validateAndCleanup();
  }

  /**
   * Stop daemon process
   */
  async stopDaemon(): Promise<boolean> {
    const pid = pidManager.readPid();
    
    if (!pid) {
      logger.debug('No daemon PID found');
      return false;
    }

    if (!pidManager.isProcessRunning(pid)) {
      logger.debug('Daemon process not running, cleaning up PID file');
      try {
        pidManager.cleanupPidFile();
      } catch (cleanupError) {
        logger.warn('Failed to cleanup stale PID file', { pid, error: cleanupError instanceof Error ? cleanupError.message : 'Unknown error' });
      }
      return false;
    }

    try {
      logger.debug('Sending SIGTERM to daemon process', { pid });
      process.kill(pid, 'SIGTERM');
      
      // Wait for graceful shutdown
      await this.waitForProcessExit(pid, PROCESS_CONFIG.DEFAULT_SHUTDOWN_TIMEOUT_MS);
      
      // Clean up PID file (non-fatal if this fails)
      try {
        pidManager.cleanupPidFile();
      } catch (cleanupError) {
        logger.warn('Failed to cleanup PID file after stopping daemon', { pid, error: cleanupError instanceof Error ? cleanupError.message : 'Unknown error' });
      }
      
      logger.info('Daemon process stopped successfully', { pid });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to stop daemon process', error instanceof Error ? error : undefined, { pid, error: errorMessage });
      
      throw new DaemonError(
        `Failed to stop daemon: ${errorMessage}`,
        'stop',
        pid
      );
    }
  }

  /**
   * Get daemon status information
   */
  async getDaemonStatus(): Promise<{ running: boolean; pid: number | null }> {
    try {
      const pid = pidManager.readPid();
      
      if (!pid) {
        return { running: false, pid: null };
      }
      
      // Use validateAndCleanup to handle stale PID files
      const running = pidManager.validateAndCleanup();
      
      // Return the original PID even if process is not running (for logging)
      // but validateAndCleanup will have cleaned up the stale file
      return { running, pid: running ? pid : null };
    } catch (error) {
      // Return safe defaults on error
      logger.debug('Error reading daemon status', { error: error instanceof Error ? error.message : 'Unknown error' });
      return { running: false, pid: null };
    }
  }

  /**
   * Get default script path for daemon
   */
  private getDefaultScriptPath(): string {
    return path.join(__dirname, '../server-daemon.js');
  }

  /**
   * Build command line arguments for daemon process
   */
  private buildDaemonArgs(options: DaemonOptions): string[] {
    const args: string[] = [];
    
    if (options.port) {
      args.push('--port', options.port);
    }
    
    if (options.apiKey) {
      args.push('--api-key', options.apiKey);
    }
    
    if (options.verbose) {
      args.push('--verbose');
    }
    
    if (options.debug) {
      args.push('--debug');
    }
    
    return args;
  }

  /**
   * Poll the daemon's /health endpoint until it responds 200, or reject when
   * timeoutMs elapses. Probes 127.0.0.1 regardless of the configured bind host
   * (a server bound to 0.0.0.0 still answers on loopback), and /health needs no
   * auth, so this works even when an API key is configured.
   */
  private async waitForServerReady(port: number, timeoutMs: number): Promise<void> {
    const http = await import('http');
    const startTime = Date.now();
    // Poll faster than the process-exit interval: readiness usually lands well
    // under a second, and we don't want to add a full second of latency to the
    // common (successful) start.
    const checkInterval = 200;

    return new Promise<void>((resolve, reject) => {
      const attempt = (): void => {
        const req = http.get(
          { host: '127.0.0.1', port, path: '/health', timeout: 1000 },
          (res) => {
            res.resume(); // drain the response so the socket can close
            if (res.statusCode === 200) {
              resolve();
            } else {
              retry();
            }
          }
        );
        req.on('error', () => retry());
        req.on('timeout', () => { req.destroy(); retry(); });
      };

      const retry = (): void => {
        if (Date.now() - startTime >= timeoutMs) {
          reject(new DaemonError(`Server did not become ready within ${timeoutMs}ms`, 'start'));
          return;
        }
        setTimeout(attempt, checkInterval);
      };

      attempt();
    });
  }

  /**
   * Wait for process to exit
   */
  private async waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
    const startTime = Date.now();
    const checkInterval = PROCESS_CONFIG.PROCESS_CHECK_INTERVAL_MS;
    
    return new Promise((resolve, reject) => {
      const checkProcess = () => {
        const elapsed = Date.now() - startTime;
        
        if (elapsed >= timeoutMs) {
          reject(new DaemonError(
            `Process ${pid} did not exit within ${timeoutMs}ms`,
            'wait',
            pid
          ));
          return;
        }
        
        if (!pidManager.isProcessRunning(pid)) {
          resolve();
          return;
        }
        
        setTimeout(checkProcess, checkInterval);
      };
      
      checkProcess();
    });
  }
}

/**
 * Global daemon manager instance (Singleton pattern)
 */
export const daemonManager = new DaemonManager();