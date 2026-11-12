import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(exec);

const TASK_NAME = 'WindowsDaemonManager';

export class ServiceManager {
  private daemonScriptPath: string;

  constructor() {
    // Resolve absolute path to dist/daemon/index.js
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    this.daemonScriptPath = path.resolve(currentDir, '..', 'daemon', 'index.js');
  }

  /**
   * Installs the background daemon as a Windows Startup Service via Windows Task Scheduler.
   * Runs at system boot in Session 0 with highest privileges, surviving reboots.
   */
  async install(): Promise<{ success: boolean; message: string }> {
    if (process.platform !== 'win32') {
      return { success: false, message: 'Windows Service is only supported on Windows.' };
    }

    const nodePath = process.execPath;
    const command = `"${nodePath}" "${this.daemonScriptPath}"`;

    try {
      // Create scheduled task to run at system startup with highest privileges
      const taskCmd = `schtasks /Create /TN "${TASK_NAME}" /TR "${command}" /SC ONSTART /RU "SYSTEM" /RL HIGHEST /F`;
      await execAsync(taskCmd);

      return {
        success: true,
        message: `Background service successfully registered under '${TASK_NAME}'. It will start automatically on boot.`,
      };
    } catch (error: any) {
      // If permission denied (requires admin)
      if (error?.message?.includes('Access is denied') || error?.code === 1) {
        return {
          success: false,
          message:
            'Administrative privileges required to install system service. Please run command prompt as Administrator.',
        };
      }
      return { success: false, message: error?.message || 'Failed to install service' };
    }
  }

  /**
   * Uninstalls and removes the Windows background service.
   */
  async uninstall(): Promise<{ success: boolean; message: string }> {
    if (process.platform !== 'win32') {
      return { success: false, message: 'Windows Service is only supported on Windows.' };
    }

    try {
      // Stop if currently running
      await this.stop();
      // Delete task
      await execAsync(`schtasks /Delete /TN "${TASK_NAME}" /F`);
      return { success: true, message: `Service '${TASK_NAME}' has been removed.` };
    } catch (error: any) {
      if (error?.message?.includes('not find the file') || error?.code === 1) {
        return { success: true, message: `Service '${TASK_NAME}' is not installed.` };
      }
      return { success: false, message: error?.message || 'Failed to uninstall service' };
    }
  }

  /**
   * Starts the registered Windows service.
   */
  async start(): Promise<{ success: boolean; message: string }> {
    if (process.platform !== 'win32') {
      return { success: false, message: 'Windows Service is only supported on Windows.' };
    }

    try {
      await execAsync(`schtasks /Run /TN "${TASK_NAME}"`);
      return { success: true, message: `Service '${TASK_NAME}' started.` };
    } catch (error: any) {
      return { success: false, message: error?.message || 'Failed to start service' };
    }
  }

  /**
   * Stops the registered Windows service task.
   */
  async stop(): Promise<{ success: boolean; message: string }> {
    if (process.platform !== 'win32') {
      return { success: false, message: 'Windows Service is only supported on Windows.' };
    }

    try {
      await execAsync(`schtasks /End /TN "${TASK_NAME}"`);
      return { success: true, message: `Service '${TASK_NAME}' stopped.` };
    } catch (error: any) {
      return { success: false, message: error?.message || 'Failed to stop service' };
    }
  }

  /**
   * Checks the status of the Windows service.
   */
  async status(): Promise<{ installed: boolean; running: boolean; rawStatus: string }> {
    if (process.platform !== 'win32') {
      return { installed: false, running: false, rawStatus: 'Unsupported platform' };
    }

    try {
      const { stdout } = await execAsync(`schtasks /Query /TN "${TASK_NAME}" /FO CSV /NH`);
      const isRunning = stdout.includes('Running');
      return { installed: true, running: isRunning, rawStatus: stdout.trim() };
    } catch {
      return { installed: false, running: false, rawStatus: 'Not installed' };
    }
  }
}
