#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StorageManager } from '../daemon/storage.js';
import { ServiceManager } from '../service/manager.js';
import { DEFAULT_PORT, DEFAULT_HOST } from '../config.js';
import { ProcessRuntime } from '../types.js';

const storage = new StorageManager();
const serviceManager = new ServiceManager();

const API_BASE = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;

async function getAuthToken(): Promise<string> {
  return storage.getOrCreateAuthToken();
}

/**
 * Executes an HTTP request to the local daemon control plane.
 */
async function callApi(endpoint: string, method = 'GET', body: any = null): Promise<any> {
  const token = await getAuthToken();
  const url = `${API_BASE}${endpoint}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json();
  return json;
}

/**
 * Checks if the daemon is currently reachable.
 */
async function isDaemonOnline(): Promise<boolean> {
  try {
    const res = await callApi('/api/status');
    return res && res.success === true;
  } catch {
    return false;
  }
}

/**
 * Ensures the daemon process is running. Spawns it detached if necessary.
 */
async function ensureDaemonRunning(): Promise<void> {
  if (await isDaemonOnline()) {
    return;
  }

  process.stdout.write('Starting background daemon supervisor... ');

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const daemonPath = path.resolve(currentDir, '..', 'daemon', 'index.js');

  const child = spawn(process.execPath, [daemonPath], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.unref();

  // Wait up to 5 seconds for daemon to respond
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await isDaemonOnline()) {
      console.log('online.');
      return;
    }
  }

  throw new Error('Failed to start local daemon supervisor');
}

/**
 * CLI Commands Handlers
 */

async function handleStart(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Error: Please provide a script to run. Example: daemon start app.js --name my-api');
    process.exit(1);
  }

  let script = '';
  let name = '';
  const scriptArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) {
      name = args[i + 1];
      i++;
    } else if (!script) {
      script = args[i];
    } else {
      scriptArgs.push(args[i]);
    }
  }

  const absScript = path.resolve(process.cwd(), script);
  if (!fs.existsSync(absScript)) {
    console.error(`Error: Target script not found: ${absScript}`);
    process.exit(1);
  }

  if (!name) {
    name = path.basename(script, path.extname(script));
  }

  await ensureDaemonRunning();

  const payload = {
    name,
    script: absScript,
    cwd: process.cwd(),
    args: scriptArgs,
  };

  const res = await callApi('/api/processes', 'POST', payload);
  if (res.success) {
    const p: ProcessRuntime = res.data;
    console.log(`[+] Background process '${p.name}' started successfully.`);
    console.log(`    ID:     ${p.id}`);
    console.log(`    PID:    ${p.pid}`);
    console.log(`    Status: ${p.status}`);
    console.log(`    Logs:   ${p.logPathOut}`);
  } else {
    console.error(`[-] Failed to start process: ${res.error}`);
    process.exit(1);
  }
}

async function handleList(): Promise<void> {
  await ensureDaemonRunning();
  const res = await callApi('/api/processes');

  if (!res.success) {
    console.error(`[-] Failed to fetch processes: ${res.error}`);
    process.exit(1);
  }

  const list: ProcessRuntime[] = res.data || [];
  if (list.length === 0) {
    console.log('No background processes currently registered.');
    console.log('Start one using: daemon start <script.js> --name <name>');
    return;
  }

  console.log('\n--- Managed Background Processes ---');
  console.log(
    'ID'.padEnd(16) +
    'NAME'.padEnd(20) +
    'STATUS'.padEnd(12) +
    'PID'.padEnd(10) +
    'MEMORY'.padEnd(14) +
    'UPTIME'
  );
  console.log('-'.repeat(80));

  for (const p of list) {
    const memMb = p.metrics?.memoryRssBytes
      ? (p.metrics.memoryRssBytes / (1024 * 1024)).toFixed(1) + ' MB'
      : '-';

    const uptime = p.uptimeSeconds > 0 ? `${p.uptimeSeconds}s` : '-';

    console.log(
      p.id.padEnd(16) +
      p.name.slice(0, 18).padEnd(20) +
      p.status.padEnd(12) +
      String(p.pid || '-').padEnd(10) +
      memMb.padEnd(14) +
      uptime
    );
  }
  console.log('');
}

async function resolveProcessId(identifier: string): Promise<string> {
  const res = await callApi('/api/processes');
  if (res.success && Array.isArray(res.data)) {
    const found = res.data.find(
      (p: ProcessRuntime) => p.id === identifier || p.name === identifier
    );
    if (found) return found.id;
  }
  return identifier;
}

async function handleStop(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Error: Please provide process name or ID to stop.');
    process.exit(1);
  }

  await ensureDaemonRunning();
  const targetId = await resolveProcessId(args[0]);
  const res = await callApi(`/api/processes/${targetId}/stop`, 'POST');

  if (res.success) {
    console.log(`[+] Process '${args[0]}' stopped.`);
  } else {
    console.error(`[-] Failed to stop process: ${res.error}`);
  }
}

async function handleRestart(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Error: Please provide process name or ID to restart.');
    process.exit(1);
  }

  await ensureDaemonRunning();
  const targetId = await resolveProcessId(args[0]);
  const res = await callApi(`/api/processes/${targetId}/restart`, 'POST');

  if (res.success) {
    console.log(`[+] Process '${args[0]}' restarted (PID: ${res.data?.pid}).`);
  } else {
    console.error(`[-] Failed to restart process: ${res.error}`);
  }
}

async function handleDelete(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Error: Please provide process name or ID to delete.');
    process.exit(1);
  }

  await ensureDaemonRunning();
  const targetId = await resolveProcessId(args[0]);
  const res = await callApi(`/api/processes/${targetId}`, 'DELETE');

  if (res.success) {
    console.log(`[+] Process '${args[0]}' deleted.`);
  } else {
    console.error(`[-] Failed to delete process: ${res.error}`);
  }
}

async function handleLogs(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Error: Please provide process name or ID to inspect logs.');
    process.exit(1);
  }

  await ensureDaemonRunning();
  const targetId = await resolveProcessId(args[0]);
  const res = await callApi(`/api/processes/${targetId}/logs`);

  if (res.success && res.data) {
    const { out, err } = res.data;
    console.log(`\n=== STDOUT [${args[0]}] ===`);
    console.log(out || '(empty)');
    if (err) {
      console.log(`\n=== STDERR [${args[0]}] ===`);
      console.log(err);
    }
    console.log('');
  } else {
    console.error(`[-] Failed to fetch logs: ${res.error}`);
  }
}

async function handleUi(): Promise<void> {
  await ensureDaemonRunning();
  const token = await getAuthToken();
  const dashboardUrl = `${API_BASE}/dashboard?token=${encodeURIComponent(token)}`;

  console.log(`Opening Web Dashboard at: ${dashboardUrl}`);

  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', dashboardUrl], { detached: true, stdio: 'ignore' });
  } else {
    spawn('xdg-open', [dashboardUrl], { detached: true, stdio: 'ignore' });
  }
}

async function handleService(subArgs: string[]): Promise<void> {
  const action = subArgs[0];

  switch (action) {
    case 'install': {
      const result = await serviceManager.install();
      console.log(result.message);
      break;
    }
    case 'uninstall': {
      const result = await serviceManager.uninstall();
      console.log(result.message);
      break;
    }
    case 'start': {
      const result = await serviceManager.start();
      console.log(result.message);
      break;
    }
    case 'stop': {
      const result = await serviceManager.stop();
      console.log(result.message);
      break;
    }
    case 'status': {
      const status = await serviceManager.status();
      console.log(`Service Installed: ${status.installed ? 'Yes' : 'No'}`);
      console.log(`Service Running:   ${status.running ? 'Yes' : 'No'}`);
      break;
    }
    default:
      console.log('Usage: daemon service <install|uninstall|start|stop|status>');
      break;
  }
}

function printHelp(): void {
  console.log(`
Windows Daemon Manager - Process Management CLI

Usage:
  daemon start <script> [--name <name>]   Start a process in the background
  daemon list (or ls, status)             List all managed processes
  daemon stop <id|name>                   Stop a running process
  daemon restart <id|name>                Restart a process
  daemon delete <id|name>                 Delete a process definition
  daemon logs <id|name>                   View process stdout & stderr logs
  daemon ui                               Launch the Web Dashboard in browser
  daemon service <cmd>                    Manage Windows boot service (install/uninstall/status)
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'list';
  const rest = args.slice(1);

  try {
    switch (command) {
      case 'start':
        await handleStart(rest);
        break;
      case 'list':
      case 'ls':
      case 'status':
        await handleList();
        break;
      case 'stop':
        await handleStop(rest);
        break;
      case 'restart':
        await handleRestart(rest);
        break;
      case 'delete':
      case 'rm':
        await handleDelete(rest);
        break;
      case 'logs':
      case 'log':
        await handleLogs(rest);
        break;
      case 'ui':
      case 'dashboard':
        await handleUi();
        break;
      case 'service':
        await handleService(rest);
        break;
      case '--help':
      case '-h':
      case 'help':
        printHelp();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (error: any) {
    console.error('Fatal CLI Error:', error.message);
    process.exit(1);
  }
}

main();
