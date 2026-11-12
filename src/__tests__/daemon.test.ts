import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StorageManager } from '../daemon/storage.js';
import { ProcessSupervisor } from '../daemon/supervisor.js';
import { DaemonServer } from '../daemon/server.js';
import { isProcessAlive } from '../daemon/win32.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '..', '..');
const sampleScript = path.resolve(projectRoot, 'src', '__tests__', 'fixtures', 'sample-app.js');

test('StorageManager handles state and auth tokens', () => {
  const storage = new StorageManager();
  const token = storage.getOrCreateAuthToken();
  assert.ok(token && token.length >= 32, 'Token should be a 32+ character hex string');

  const state = storage.loadState();
  assert.ok(state && typeof state.processes === 'object', 'State should contain processes object');
});

test('ProcessSupervisor starts, streams logs, and terminates a background process', async () => {
  const storage = new StorageManager();
  const supervisor = new ProcessSupervisor(storage);

  await supervisor.init();

  // Register the test process
  const registered = await supervisor.registerProcess({
    name: 'test-heartbeat',
    script: sampleScript,
    cwd: currentDir,
    autoRestart: false,
  });

  assert.equal(registered.name, 'test-heartbeat');
  assert.equal(registered.status, 'stopped');

  // Start the process
  const started = await supervisor.startProcess(registered.id);
  assert.equal(started.status, 'running');
  assert.ok(started.pid && started.pid > 0, 'Process should have a valid PID');

  // Verify process is alive
  const alive = isProcessAlive(started.pid!);
  assert.equal(alive, true, 'Process should be alive');

  // Allow heartbeat logs to be written
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // Verify logs
  const logs = await supervisor.getLogs(registered.id);
  assert.ok(logs.out.includes('Sample background app started'), 'Logs should contain startup message');
  assert.ok(logs.out.includes('Heartbeat #'), 'Logs should contain heartbeat output');

  // Stop process
  const stopped = await supervisor.stopProcess(registered.id);
  assert.equal(stopped, true);

  // Allow OS time to reap process
  await new Promise((resolve) => setTimeout(resolve, 500));

  const runtimeAfterStop = supervisor.getRuntime(registered.id);
  assert.equal(runtimeAfterStop?.status, 'stopped');

  // Clean up
  await supervisor.deleteProcess(registered.id);
  await supervisor.shutdown();
});

test('DaemonServer exposes authenticated API and endpoints', async () => {
  const storage = new StorageManager();
  const supervisor = new ProcessSupervisor(storage);
  const server = new DaemonServer(supervisor, storage);

  await supervisor.init();
  const testPort = 4455;
  await server.start(testPort, '127.0.0.1');

  const token = storage.getOrCreateAuthToken();

  // 1. Unauthenticated request should be rejected (401)
  const unauthRes = await fetch(`http://127.0.0.1:${testPort}/api/processes`);
  assert.equal(unauthRes.status, 401);

  // 2. Authenticated status check
  const authRes = await fetch(`http://127.0.0.1:${testPort}/api/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(authRes.status, 200);
  const statusBody = await authRes.json();
  assert.equal(statusBody.success, true);
  assert.equal(statusBody.data.status, 'ok');

  // 3. Static dashboard retrieval
  const dashRes = await fetch(`http://127.0.0.1:${testPort}/dashboard`);
  assert.equal(dashRes.status, 200);
  const dashHtml = await dashRes.text();
  assert.ok(dashHtml.includes('Windows Daemon Manager'), 'Dashboard HTML should be returned');

  // Teardown
  await server.stop();
  await supervisor.shutdown();
});

test('ProcessSupervisor executes background commands (isCommand: true)', async () => {
  const storage = new StorageManager();
  const supervisor = new ProcessSupervisor(storage);

  await supervisor.init();

  const registered = await supervisor.registerProcess({
    name: 'test-command',
    script: 'echo',
    args: ['Hello from command'],
    cwd: currentDir,
    isCommand: true,
    autoRestart: false,
  });

  assert.equal(registered.isCommand, true);

  const started = await supervisor.startProcess(registered.id);
  assert.equal(started.status, 'running');

  // Wait for command output and natural exit
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const logs = await supervisor.getLogs(registered.id);
  assert.ok(logs.out.includes('Hello from command'), 'Command output should be logged');

  // Verify command with code 0 transitions cleanly to stopped instead of looping restarts
  const runtime = supervisor.getRuntime(registered.id);
  assert.equal(runtime?.status, 'stopped');

  await supervisor.deleteProcess(registered.id);
  await supervisor.shutdown();
});

test('ProcessSupervisor resolves npm and command runners directly', async () => {
  const storage = new StorageManager();
  const supervisor = new ProcessSupervisor(storage);
  await supervisor.init();

  const registered = await supervisor.registerProcess({
    name: 'npm-resolver-test',
    script: 'npm',
    args: ['-v'],
    cwd: currentDir,
    isCommand: true,
    autoRestart: true,
  });

  const started = await supervisor.startProcess(registered.id);
  assert.ok(started.pid !== null);

  // Wait for execution
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const runtime = supervisor.getRuntime(registered.id);
  // Because npm -v exits with 0, it should be cleanly stopped, not restarting
  assert.equal(runtime?.status, 'stopped');
  assert.equal(runtime?.restarts, 0);

  const logs = await supervisor.getLogs(registered.id);
  assert.ok(logs.out.trim().length > 0, 'npm -v should produce version output');

  await supervisor.deleteProcess(registered.id);
  await supervisor.shutdown();
});
