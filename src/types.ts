export type ProcessStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'restarting'
  | 'crashed'
  | 'stopping';

export interface ProcessConfig {
  id: string;
  name: string;
  script: string;
  cwd: string;
  args?: string[];
  env?: Record<string, string>;
  autoRestart?: boolean;
  maxRestarts?: number;
  restartDelayMs?: number;
  nodePath?: string;
  createdAt: string;
}

export interface ProcessMetrics {
  cpuPercent: number;
  memoryRssBytes: number;
}

export interface ProcessRuntime {
  id: string;
  name: string;
  script: string;
  cwd: string;
  args: string[];
  status: ProcessStatus;
  pid: number | null;
  uptimeSeconds: number;
  restarts: number;
  lastExitCode: number | null;
  lastExitTime: string | null;
  metrics: ProcessMetrics;
  logPathOut: string;
  logPathErr: string;
}

export interface DaemonState {
  version: string;
  startedAt: string;
  processes: Record<string, ProcessConfig>;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
