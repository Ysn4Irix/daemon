import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StorageManager } from './storage.js';
import { ProcessSupervisor } from './supervisor.js';
import { DaemonServer } from './server.js';
import { DEFAULT_PORT } from '../config.js';

export async function runDaemon(port = DEFAULT_PORT): Promise<void> {
  process.on('uncaughtException', (err) => {
    console.error('[daemon] Uncaught exception:', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[daemon] Unhandled rejection:', reason);
  });

  const storage = new StorageManager();
  const supervisor = new ProcessSupervisor(storage);
  const server = new DaemonServer(supervisor, storage);

  storage.writeDaemonPid(process.pid);

  await supervisor.init();
  await server.start(port);

  console.log(`[daemon] Supervisor running under PID ${process.pid}`);

  const shutdown = async () => {
    console.log('[daemon] Shutting down supervisor and processes...');
    await server.stop();
    await supervisor.shutdown();
    storage.clearDaemonPid();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep event loop active permanently
  const keepAlive = setInterval(() => {}, 60000);
}

// If executed directly
const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFilePath)) {
  runDaemon().catch((err) => {
    console.error('[daemon] Fatal error starting daemon:', err);
    process.exit(1);
  });
}
