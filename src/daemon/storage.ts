import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  getStateFilePath,
  getTokenFilePath,
  getDaemonPidFilePath,
} from '../config.js';
import { DaemonState, ProcessConfig } from '../types.js';

export class StorageManager {
  private stateFilePath: string;
  private tokenFilePath: string;
  private pidFilePath: string;

  constructor() {
    this.stateFilePath = getStateFilePath();
    this.tokenFilePath = getTokenFilePath();
    this.pidFilePath = getDaemonPidFilePath();
  }

  /**
   * Loads the current daemon state from disk.
   */
  loadState(): DaemonState {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const raw = fs.readFileSync(this.stateFilePath, 'utf8');
        return JSON.parse(raw);
      }
    } catch (error) {
      console.error('[storage] Failed to load state file:', error);
    }

    return {
      version: '1.0.0',
      startedAt: new Date().toISOString(),
      processes: {},
    };
  }

  /**
   * Saves the daemon state to disk atomically.
   */
  saveState(state: DaemonState): void {
    const tempFile = `${this.stateFilePath}.${Date.now()}.tmp`;
    const data = JSON.stringify(state, null, 2);
    try {
      fs.writeFileSync(tempFile, data, 'utf8');
      fs.renameSync(tempFile, this.stateFilePath);
    } catch (error) {
      console.error('[storage] Failed to save state file:', error);
      if (fs.existsSync(tempFile)) {
        try {
          fs.unlinkSync(tempFile);
        } catch {}
      }
    }
  }

  /**
   * Retrieves or creates the secret bearer authentication token.
   */
  getOrCreateAuthToken(): string {
    try {
      if (fs.existsSync(this.tokenFilePath)) {
        const token = fs.readFileSync(this.tokenFilePath, 'utf8').trim();
        if (token.length >= 32) {
          return token;
        }
      }

      // Generate a new 32-byte hex token
      const newToken = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(this.tokenFilePath, newToken, {
        encoding: 'utf8',
        mode: 0o600, // Restrict file permissions
      });
      return newToken;
    } catch (error) {
      console.error('[storage] Failed to read/write token file:', error);
      // Fallback in-memory token
      return 'fallback_daemon_token_' + crypto.randomBytes(16).toString('hex');
    }
  }

  /**
   * Records daemon PID.
   */
  writeDaemonPid(pid: number): void {
    try {
      fs.writeFileSync(this.pidFilePath, String(pid), 'utf8');
    } catch (error) {
      console.error('[storage] Failed to write daemon PID file:', error);
    }
  }

  /**
   * Reads the active daemon PID.
   */
  readDaemonPid(): number | null {
    try {
      if (fs.existsSync(this.pidFilePath)) {
        const content = fs.readFileSync(this.pidFilePath, 'utf8').trim();
        const pid = parseInt(content, 10);
        return isNaN(pid) ? null : pid;
      }
    } catch {}
    return null;
  }

  /**
   * Cleans up the daemon PID file.
   */
  clearDaemonPid(): void {
    try {
      if (fs.existsSync(this.pidFilePath)) {
        fs.unlinkSync(this.pidFilePath);
      }
    } catch {}
  }
}
