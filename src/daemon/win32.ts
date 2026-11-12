import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';

const execFileAsync = promisify(execFile);

/**
 * Forcefully terminates a process and all its child processes (process tree) on Windows.
 * Uses native taskkill.exe /PID <pid> /T /F with windowsHide: true to prevent console flashing.
 */
export async function terminateProcessTree(pid: number): Promise<boolean> {
  if (!pid || pid <= 0) return true;

  try {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill.exe', ['/PID', pid.toString(), '/T', '/F'], {
        windowsHide: true,
      });
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
 * Uses direct execFile with windowsHide: true to ensure zero console window popup.
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
      const { stdout } = await execFileAsync(
        'tasklist.exe',
        ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
        { windowsHide: true }
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
