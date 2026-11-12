import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export const DEFAULT_PORT = 4040;
export const DEFAULT_HOST = '127.0.0.1';

export function getBaseDirectory(): string {
  // If explicitly overridden via env var
  if (process.env.DAEMON_MANAGER_DIR) {
    return process.env.DAEMON_MANAGER_DIR;
  }

  // Windows: LOCALAPPDATA or ProgramData for services
  const localAppData = process.env.LOCALAPPDATA;
  const programData = process.env.ProgramData;

  const base = localAppData || programData || path.join(os.homedir(), '.daemon-manager');
  const dir = path.join(base, 'daemon-manager');

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return dir;
}

export function getLogsDirectory(): string {
  const base = getBaseDirectory();
  const logsDir = path.join(base, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  return logsDir;
}

export function getStateFilePath(): string {
  return path.join(getBaseDirectory(), 'state.json');
}

export function getTokenFilePath(): string {
  return path.join(getBaseDirectory(), 'auth.token');
}

export function getDaemonPidFilePath(): string {
  return path.join(getBaseDirectory(), 'daemon.pid');
}
