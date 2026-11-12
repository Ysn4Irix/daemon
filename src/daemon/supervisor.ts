import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  ProcessConfig,
  ProcessRuntime,
  ProcessStatus,
  ProcessMetrics,
} from '../types.js';
import { getLogsDirectory } from '../config.js';
import {
  terminateProcessTree,
  isProcessAlive,
  getProcessMetrics,
  resolveNodeBinary,
  captureEnvironment,
} from './win32.js';
import { StorageManager } from './storage.js';

interface ManagedProcess {
  config: ProcessConfig;
  child: ChildProcess | null;
  pid: number | null;
  status: ProcessStatus;
  startTime: number | null;
  restarts: number;
  lastExitCode: number | null;
  lastExitTime: string | null;
  restartTimer: NodeJS.Timeout | null;
  logStreamOut: fs.WriteStream | null;
  logStreamErr: fs.WriteStream | null;
  recentLogsOut: string[];
  recentLogsErr: string[];
  metrics: ProcessMetrics;
}

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB

export class ProcessSupervisor extends EventEmitter {
  private processes = new Map<string, ManagedProcess>();
  private storage: StorageManager;
  private metricsInterval: NodeJS.Timeout | null = null;

  constructor(storage: StorageManager) {
    super();
    this.storage = storage;
  }

  /**
   * Initializes the supervisor and restores configured processes.
   */
  async init(): Promise<void> {
    const state = this.storage.loadState();
    const configs = Object.values(state.processes || {});

    for (const config of configs) {
      this.processes.set(config.id, {
        config,
        child: null,
        pid: null,
        status: 'stopped',
        startTime: null,
        restarts: 0,
        lastExitCode: null,
        lastExitTime: null,
        restartTimer: null,
        logStreamOut: null,
        logStreamErr: null,
        recentLogsOut: [],
        recentLogsErr: [],
        metrics: { cpuPercent: 0, memoryRssBytes: 0 },
      });

      // If auto-restart is enabled, start it on boot
      if (config.autoRestart !== false) {
        this.startProcess(config.id).catch((err) => {
          console.error(`[supervisor] Failed to auto-start ${config.name}:`, err);
        });
      }
    }

    // Start periodic background metrics polling (every 5 seconds)
    this.metricsInterval = setInterval(() => this.updateMetrics(), 5000);
    this.metricsInterval.unref();
  }

  /**
   * Registers a new process configuration.
   */
  async registerProcess(
    params: Omit<ProcessConfig, 'id' | 'createdAt'> & { id?: string }
  ): Promise<ProcessRuntime> {
    const id = params.id || `app-${Date.now().toString(36)}`;
    const fullConfig: ProcessConfig = {
      id,
      name: params.name || id,
      script: params.script,
      cwd: params.cwd || process.cwd(),
      args: params.args || [],
      isCommand: Boolean(params.isCommand),
      env: params.env || captureEnvironment(),
      autoRestart: params.autoRestart !== false,
      maxRestarts: params.maxRestarts ?? 10,
      restartDelayMs: params.restartDelayMs ?? 1000,
      nodePath: params.nodePath || resolveNodeBinary(),
      createdAt: new Date().toISOString(),
    };

    const managed: ManagedProcess = {
      config: fullConfig,
      child: null,
      pid: null,
      status: 'stopped',
      startTime: null,
      restarts: 0,
      lastExitCode: null,
      lastExitTime: null,
      restartTimer: null,
      logStreamOut: null,
      logStreamErr: null,
      recentLogsOut: [],
      recentLogsErr: [],
      metrics: { cpuPercent: 0, memoryRssBytes: 0 },
    };

    this.processes.set(id, managed);
    this.persistState();

    return this.getRuntime(id)!;
  }

  /**
   * Starts a process in the background with zero UI interruption.
   */
  async startProcess(id: string): Promise<ProcessRuntime> {
    const managed = this.processes.get(id);
    if (!managed) {
      throw new Error(`Process with ID '${id}' not found`);
    }

    // If already running, return current runtime
    if (managed.status === 'running' && managed.pid) {
      const alive = isProcessAlive(managed.pid);
      if (alive) {
        return this.getRuntime(id)!;
      }
    }

    // Clear any pending restart timer
    if (managed.restartTimer) {
      clearTimeout(managed.restartTimer);
      managed.restartTimer = null;
    }

    managed.status = 'starting';
    this.emit('status-change', { id, status: managed.status });

    const config = managed.config;
    const logsDir = getLogsDirectory();
    const outLogPath = path.join(logsDir, `${id}.out.log`);
    const errLogPath = path.join(logsDir, `${id}.err.log`);

    this.rotateLogIfNeeded(outLogPath);
    this.rotateLogIfNeeded(errLogPath);

    const outStream = fs.createWriteStream(outLogPath, { flags: 'a' });
    const errStream = fs.createWriteStream(errLogPath, { flags: 'a' });

    managed.logStreamOut = outStream;
    managed.logStreamErr = errStream;

    let child: ChildProcess;

    if (config.isCommand) {
      const resolved = this.resolveCommand(config);
      child = spawn(resolved.binary, resolved.args, {
        cwd: config.cwd,
        env: {
          ...process.env,
          ...config.env,
          DAEMON_PROCESS_ID: id,
          DAEMON_MANAGED: '1',
        },
        detached: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } else {
      const nodeExec = resolveNodeBinary(config.nodePath);
      const scriptPath = path.isAbsolute(config.script)
        ? config.script
        : path.resolve(config.cwd, config.script);

      const spawnArgs = [scriptPath, ...(config.args || [])];

      child = spawn(nodeExec, spawnArgs, {
        cwd: config.cwd,
        env: {
          ...process.env,
          ...config.env,
          DAEMON_PROCESS_ID: id,
          DAEMON_MANAGED: '1',
        },
        detached: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }

    if (child.stdout) {
      child.stdout.pipe(outStream);
      child.stdout.on('data', (data) => {
        const text = data.toString('utf8');
        managed.recentLogsOut.push(text);
        if (managed.recentLogsOut.length > 200) managed.recentLogsOut.shift();
        this.emit('log', { id, type: 'stdout', text });
      });
    }

    if (child.stderr) {
      child.stderr.pipe(errStream);
      child.stderr.on('data', (data) => {
        const text = data.toString('utf8');
        managed.recentLogsErr.push(text);
        if (managed.recentLogsErr.length > 200) managed.recentLogsErr.shift();
        this.emit('log', { id, type: 'stderr', text });
      });
    }

    managed.child = child;
    managed.pid = child.pid || null;
    managed.startTime = Date.now();
    managed.status = 'running';

    this.emit('status-change', { id, status: managed.status, pid: managed.pid });

    // Handle exit
    child.on('exit', (code, signal) => {
      this.handleProcessExit(id, code, signal);
    });

    child.on('error', (err) => {
      console.error(`[supervisor] Process '${config.name}' error:`, err);
      const timestamp = new Date().toISOString();
      errStream.write(`[${timestamp}] [DAEMON_ERROR] ${err.message}\n`);
    });

    // Unref child so supervisor doesn't block
    child.unref();

    return this.getRuntime(id)!;
  }

  /**
   * Stops a running process and terminates its entire process tree.
   */
  async stopProcess(id: string): Promise<boolean> {
    const managed = this.processes.get(id);
    if (!managed) {
      throw new Error(`Process with ID '${id}' not found`);
    }

    if (managed.restartTimer) {
      clearTimeout(managed.restartTimer);
      managed.restartTimer = null;
    }

    managed.status = 'stopping';
    this.emit('status-change', { id, status: managed.status });

    if (managed.pid) {
      await terminateProcessTree(managed.pid);
    }

    this.cleanupStreams(managed);
    managed.child = null;
    managed.pid = null;
    managed.status = 'stopped';
    managed.startTime = null;

    this.emit('status-change', { id, status: managed.status });
    return true;
  }

  /**
   * Restarts a process.
   */
  async restartProcess(id: string): Promise<ProcessRuntime> {
    await this.stopProcess(id);
    const managed = this.processes.get(id);
    if (managed) {
      managed.restarts = 0; // Reset restart count on explicit restart
    }
    return this.startProcess(id);
  }

  /**
   * Deletes a process definition and stops it if running.
   */
  async deleteProcess(id: string): Promise<boolean> {
    if (!this.processes.has(id)) {
      return false;
    }
    await this.stopProcess(id);
    this.processes.delete(id);
    this.persistState();
    return true;
  }

  /**
   * Lists all managed processes with runtime status.
   */
  async listProcesses(): Promise<ProcessRuntime[]> {
    const list: ProcessRuntime[] = [];
    for (const id of this.processes.keys()) {
      const runtime = this.getRuntime(id);
      if (runtime) {
        list.push(runtime);
      }
    }
    return list;
  }

  /**
   * Retrieves runtime information for a specific process.
   */
  getRuntime(id: string): ProcessRuntime | null {
    const managed = this.processes.get(id);
    if (!managed) return null;

    const logsDir = getLogsDirectory();
    const uptimeSeconds =
      managed.status === 'running' && managed.startTime
        ? Math.floor((Date.now() - managed.startTime) / 1000)
        : 0;

    return {
      id: managed.config.id,
      name: managed.config.name,
      script: managed.config.script,
      cwd: managed.config.cwd,
      args: managed.config.args || [],
      isCommand: managed.config.isCommand,
      status: managed.status,
      pid: managed.pid,
      uptimeSeconds,
      restarts: managed.restarts,
      lastExitCode: managed.lastExitCode,
      lastExitTime: managed.lastExitTime,
      metrics: managed.metrics,
      logPathOut: path.join(logsDir, `${id}.out.log`),
      logPathErr: path.join(logsDir, `${id}.err.log`),
    };
  }

  /**
   * Retrieves the tail of stdout and stderr logs for a process.
   */
  async getLogs(id: string, maxLines = 100): Promise<{ out: string; err: string }> {
    const logsDir = getLogsDirectory();
    const outPath = path.join(logsDir, `${id}.out.log`);
    const errPath = path.join(logsDir, `${id}.err.log`);

    const managed = this.processes.get(id);

    const readTail = (filePath: string, inMemory: string[]): string => {
      try {
        let content = '';
        if (fs.existsSync(filePath)) {
          content = fs.readFileSync(filePath, 'utf8');
        }
        if (!content.trim() && inMemory.length > 0) {
          content = inMemory.join('');
        }
        if (!content) return '';
        const lines = content.split('\n');
        return lines.slice(-maxLines).join('\n');
      } catch {
        return inMemory.join('');
      }
    };

    return {
      out: readTail(outPath, managed?.recentLogsOut || []),
      err: readTail(errPath, managed?.recentLogsErr || []),
    };
  }

  /**
   * Resolves a command configuration to an optimal executable and arguments.
   * On Windows, maps npm, npx, pnpm, and yarn directly to their Node entrypoint scripts
   * to eliminate batch-file console windows completely.
   */
  private resolveCommand(config: ProcessConfig): { binary: string; args: string[] } {
    if (process.platform === 'win32') {
      const nodeExec = resolveNodeBinary(config.nodePath);
      const nodeDir = path.dirname(nodeExec);
      const scriptBase = path.basename(config.script).toLowerCase().replace(/\.(cmd|bat|exe)$/, '');

      // Check for npm
      if (scriptBase === 'npm') {
        const npmCli = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
        if (fs.existsSync(npmCli)) {
          return { binary: nodeExec, args: [npmCli, ...(config.args || [])] };
        }
      }

      // Check for npx
      if (scriptBase === 'npx') {
        const npxCli = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js');
        if (fs.existsSync(npxCli)) {
          return { binary: nodeExec, args: [npxCli, ...(config.args || [])] };
        }
      }

      // Check for pnpm
      if (scriptBase === 'pnpm') {
        const pnpmMjs = path.join(nodeDir, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs');
        if (fs.existsSync(pnpmMjs)) {
          return { binary: nodeExec, args: [pnpmMjs, ...(config.args || [])] };
        }
        const pnpmCjs = path.join(nodeDir, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
        if (fs.existsSync(pnpmCjs)) {
          return { binary: nodeExec, args: [pnpmCjs, ...(config.args || [])] };
        }
      }

      // Check for yarn
      if (scriptBase === 'yarn') {
        const yarnJs = path.join(nodeDir, 'node_modules', 'yarn', 'bin', 'yarn.js');
        if (fs.existsSync(yarnJs)) {
          return { binary: nodeExec, args: [yarnJs, ...(config.args || [])] };
        }
      }

      // For generic commands on Windows: spawn cmd.exe with detached and windowsHide
      const fullCmd = [config.script, ...(config.args || [])].join(' ');
      return { binary: 'cmd.exe', args: ['/c', fullCmd] };
    }

    // Non-Windows: run via standard shell
    const fullCmd = [config.script, ...(config.args || [])].join(' ');
    return { binary: '/bin/sh', args: ['-c', fullCmd] };
  }

  /**
   * Internal exit handler managing crash detection and auto-restarts.
   */
  private handleProcessExit(
    id: string,
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    const managed = this.processes.get(id);
    if (!managed) return;

    this.cleanupStreams(managed);
    managed.child = null;
    managed.pid = null;
    managed.lastExitCode = code;
    managed.lastExitTime = new Date().toISOString();

    const uptimeMs = managed.startTime ? Date.now() - managed.startTime : 0;
    managed.startTime = null;

    // Reset restart counter if process was running stably for >= 15 seconds
    if (uptimeMs >= 15000) {
      managed.restarts = 0;
    }

    // If stopped intentionally, do not auto-restart
    if (managed.status === 'stopping' || managed.status === 'stopped') {
      managed.status = 'stopped';
      this.emit('status-change', { id, status: managed.status, code });
      return;
    }

    // Clean exit with code 0 (e.g. short-lived command or normal completion)
    if (code === 0 && signal === null) {
      managed.status = 'stopped';
      this.emit('status-change', { id, status: managed.status, code });
      return;
    }

    // Unexpected exit or crash
    const config = managed.config;
    if (config.autoRestart !== false) {
      managed.restarts += 1;
      const max = config.maxRestarts ?? 10;

      if (managed.restarts <= max) {
        managed.status = 'restarting';
        const baseDelay = config.restartDelayMs ?? 1000;
        // Exponential backoff capped at 30 seconds
        const delay = Math.min(30000, baseDelay * Math.pow(1.5, managed.restarts - 1));

        this.emit('status-change', {
          id,
          status: managed.status,
          code,
          restarts: managed.restarts,
          retryDelayMs: delay,
        });

        managed.restartTimer = setTimeout(() => {
          managed.restartTimer = null;
          this.startProcess(id).catch((err) => {
            console.error(`[supervisor] Auto-restart failed for ${config.name}:`, err);
          });
        }, delay);
        managed.restartTimer.unref();
        return;
      }
    }

    managed.status = 'crashed';
    this.emit('status-change', { id, status: managed.status, code });
  }

  /**
   * Rotates log files when exceeding MAX_LOG_SIZE.
   */
  private rotateLogIfNeeded(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.size >= MAX_LOG_SIZE) {
          const rotated = `${filePath}.1`;
          if (fs.existsSync(rotated)) {
            fs.unlinkSync(rotated);
          }
          fs.renameSync(filePath, rotated);
        }
      }
    } catch (err) {
      console.error(`[supervisor] Log rotation error for ${filePath}:`, err);
    }
  }

  /**
   * Updates resource metrics for all currently running processes.
   */
  private async updateMetrics(): Promise<void> {
    for (const [id, managed] of this.processes.entries()) {
      if (managed.status === 'running' && managed.pid) {
        const metrics = await getProcessMetrics(managed.pid);
        managed.metrics = metrics;
      } else {
        managed.metrics = { cpuPercent: 0, memoryRssBytes: 0 };
      }
    }
  }

  private cleanupStreams(managed: ManagedProcess): void {
    if (managed.logStreamOut) {
      try {
        managed.logStreamOut.end();
      } catch {}
      managed.logStreamOut = null;
    }
    if (managed.logStreamErr) {
      try {
        managed.logStreamErr.end();
      } catch {}
      managed.logStreamErr = null;
    }
  }

  private persistState(): void {
    const processes: Record<string, ProcessConfig> = {};
    for (const [id, managed] of this.processes.entries()) {
      processes[id] = managed.config;
    }
    this.storage.saveState({
      version: '1.0.0',
      startedAt: new Date().toISOString(),
      processes,
    });
  }

  /**
   * Graceful shutdown of the supervisor and all child processes.
   */
  async shutdown(): Promise<void> {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
    for (const id of this.processes.keys()) {
      try {
        await this.stopProcess(id);
      } catch {}
    }
  }
}
