import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Forcefully terminates a process and all its child processes (process tree) on Windows.
 * Uses native taskkill /PID <pid> /T /F
 */
export async function terminateProcessTree(pid: number): Promise<boolean> {
  if (!pid || pid <= 0) return true;

  try {
    // Check if running on Windows
    if (process.platform === 'win32') {
      await execAsync(`taskkill /PID ${pid} /T /F`);
    } else {
      process.kill(pid, 'SIGKILL');
    }
    return true;
  } catch (error: any) {
    // If the process was already dead, taskkill returns exit code 128 / "process not found"
    const message = error?.message || '';
    if (
      message.includes('not found') ||
      message.includes('no running instance') ||
      error.code === 128 ||
      error.code === 1
    ) {
      return true;
    }
    return false;
  }
}

/**
 * Checks if a given PID is still running on the system.
 */
export function isProcessAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // EPERM means process exists but we don't have permission to signal it
    return err.code === 'EPERM';
  }
}

/**
 * Fetches approximate resource metrics for a process.
 */
export async function getProcessMetrics(
  pid: number
): Promise<{ cpuPercent: number; memoryRssBytes: number }> {
  if (!pid || pid <= 0) {
    return { cpuPercent: 0, memoryRssBytes: 0 };
  }

  try {
    if (process.platform === 'win32') {
      // tasklist returns CSV: "Image Name","PID","Session Name","Session#","Mem Usage"
      // e.g. "node.exe","12345","Console","1","45,232 K"
      const { stdout } = await execAsync(
        `tasklist /FI "PID eq ${pid}" /FO CSV /NH`
      );
      if (!stdout || !stdout.includes(`"${pid}"`)) {
        return { cpuPercent: 0, memoryRssBytes: 0 };
      }

      const parts = stdout.trim().split(',');
      if (parts.length >= 5) {
        const memStr = parts[4].replace(/[^0-9]/g, '');
        const memoryKb = parseInt(memStr, 10);
        const memoryRssBytes = isNaN(memoryKb) ? 0 : memoryKb * 1024;
        return { cpuPercent: 0, memoryRssBytes };
      }
    }
  } catch {
    // Ignore metrics failure on transient processes
  }

  return { cpuPercent: 0, memoryRssBytes: 0 };
}

/**
 * Resolves the Node.js executable path.
 */
export function resolveNodeBinary(customPath?: string): string {
  if (customPath && fs.existsSync(customPath)) {
    return customPath;
  }
  return process.execPath;
}

/**
 * Captures the current user environment variables for child process inheritance.
 */
export function captureEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}
