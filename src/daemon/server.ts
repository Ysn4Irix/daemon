import http from 'node:http';
import { URL } from 'node:url';
import { ProcessSupervisor } from './supervisor.js';
import { StorageManager } from './storage.js';
import { DEFAULT_HOST, DEFAULT_PORT } from '../config.js';
import { getDashboardHtml } from '../dashboard/assets.js';
import { ApiResponse } from '../types.js';

export class DaemonServer {
  private supervisor: ProcessSupervisor;
  private storage: StorageManager;
  private server: http.Server | null = null;
  private token: string;
  private sseClients = new Set<http.ServerResponse>();

  constructor(supervisor: ProcessSupervisor, storage: StorageManager) {
    this.supervisor = supervisor;
    this.storage = storage;
    this.token = storage.getOrCreateAuthToken();

    // Hook supervisor events for SSE broadcasting
    this.supervisor.on('status-change', (data) => {
      this.broadcastSse('status', data);
    });

    this.supervisor.on('log', (data) => {
      this.broadcastSse('log', data);
    });
  }

  /**
   * Starts the loopback HTTP and SSE server.
   */
  start(port = DEFAULT_PORT, host = DEFAULT_HOST): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          console.error('[server] Uncaught request error:', err);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Internal Server Error' }));
          }
        });
      });

      server.on('error', (err) => {
        reject(err);
      });

      server.listen(port, host, () => {
        const address = server.address();
        const actualPort =
          typeof address === 'object' && address ? address.port : port;
        console.log(`[server] Daemon control plane listening on http://${host}:${actualPort}`);
        this.server = server;
        resolve(actualPort);
      });
    });
  }

  /**
   * Stops the server and closes all active SSE connections.
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const client of this.sseClients) {
        try {
          client.end();
        } catch {}
      }
      this.sseClients.clear();

      if (this.server) {
        this.server.close(() => resolve());
        this.server = null;
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Add CORS headers for local origin safety
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const host = req.headers.host || 'localhost';
    const parsedUrl = new URL(req.url || '/', `http://${host}`);
    const pathname = parsedUrl.pathname;

    // Static dashboard delivery
    if (pathname === '/' || pathname === '/dashboard') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getDashboardHtml());
      return;
    }

    // Authenticate all /api requests
    if (pathname.startsWith('/api')) {
      if (!this.authenticate(req, parsedUrl)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error: 'Unauthorized: Invalid or missing bearer token',
          })
        );
        return;
      }

      await this.handleApiRoute(pathname, req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Not Found' }));
  }

  private authenticate(req: http.IncomingMessage, parsedUrl: URL): boolean {
    // 1. Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const provided = authHeader.substring(7).trim();
      if (provided === this.token) return true;
    }

    // 2. Query parameter (?token=...)
    const queryToken = parsedUrl.searchParams.get('token');
    if (queryToken && queryToken === this.token) {
      return true;
    }

    return false;
  }

  private async handleApiRoute(
    pathname: string,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const method = req.method || 'GET';

    // GET /api/status
    if (pathname === '/api/status' && method === 'GET') {
      this.sendJson(res, 200, {
        success: true,
        data: {
          status: 'ok',
          uptime: process.uptime(),
          pid: process.pid,
          version: '1.0.0',
        },
      });
      return;
    }

    // GET /api/events (SSE)
    if (pathname === '/api/events' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');

      this.sseClients.add(res);

      req.on('close', () => {
        this.sseClients.delete(res);
      });
      return;
    }

    // GET /api/processes
    if (pathname === '/api/processes' && method === 'GET') {
      const processes = await this.supervisor.listProcesses();
      this.sendJson(res, 200, { success: true, data: processes });
      return;
    }

    // POST /api/processes (Register & Start)
    if (pathname === '/api/processes' && method === 'POST') {
      const body = await this.readJsonBody(req);
      if (!body.script) {
        this.sendJson(res, 400, { success: false, error: 'Missing required field: script' });
        return;
      }

      const registered = await this.supervisor.registerProcess(body);
      const started = await this.supervisor.startProcess(registered.id);
      this.sendJson(res, 201, { success: true, data: started });
      return;
    }

    // Process-specific routes: /api/processes/:id/...
    const processMatch = pathname.match(/^\/api\/processes\/([^/]+)(?:\/(.*))?$/);
    if (processMatch) {
      const id = decodeURIComponent(processMatch[1]);
      const subAction = processMatch[2] || '';

      if (subAction === '' && method === 'GET') {
        const info = this.supervisor.getRuntime(id);
        if (!info) {
          this.sendJson(res, 404, { success: false, error: `Process '${id}' not found` });
          return;
        }
        this.sendJson(res, 200, { success: true, data: info });
        return;
      }

      if (subAction === 'start' && method === 'POST') {
        try {
          const started = await this.supervisor.startProcess(id);
          this.sendJson(res, 200, { success: true, data: started });
        } catch (err: any) {
          this.sendJson(res, 400, { success: false, error: err.message });
        }
        return;
      }

      if (subAction === 'stop' && method === 'POST') {
        try {
          await this.supervisor.stopProcess(id);
          this.sendJson(res, 200, { success: true, data: { id, status: 'stopped' } });
        } catch (err: any) {
          this.sendJson(res, 400, { success: false, error: err.message });
        }
        return;
      }

      if (subAction === 'restart' && method === 'POST') {
        try {
          const restarted = await this.supervisor.restartProcess(id);
          this.sendJson(res, 200, { success: true, data: restarted });
        } catch (err: any) {
          this.sendJson(res, 400, { success: false, error: err.message });
        }
        return;
      }

      if (subAction === 'logs' && method === 'GET') {
        const logs = await this.supervisor.getLogs(id);
        this.sendJson(res, 200, { success: true, data: logs });
        return;
      }

      if (subAction === '' && method === 'DELETE') {
        const deleted = await this.supervisor.deleteProcess(id);
        if (!deleted) {
          this.sendJson(res, 404, { success: false, error: `Process '${id}' not found` });
          return;
        }
        this.sendJson(res, 200, { success: true, data: { id, deleted: true } });
        return;
      }
    }

    this.sendJson(res, 404, { success: false, error: 'Endpoint Not Found' });
  }

  private broadcastSse(event: string, data: any): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  private sendJson<T>(res: http.ServerResponse, status: number, body: ApiResponse<T>): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private readJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (err) {
          reject(new Error('Invalid JSON payload'));
        }
      });
      req.on('error', reject);
    });
  }
}
