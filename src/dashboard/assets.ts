export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Windows Daemon Manager</title>
  <style>
    :root {
      --bg: #0f1117;
      --surface: #181b26;
      --border: #282d3f;
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --success: #10b981;
      --danger: #ef4444;
      --warning: #f59e0b;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    [data-theme="light"] {
      --bg: #f8fafc;
      --surface: #ffffff;
      --border: #e2e8f0;
      --text: #0f172a;
      --text-muted: #64748b;
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --success: #059669;
      --danger: #dc2626;
      --warning: #d97706;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--font-sans);
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 1.5rem;
      min-height: 100vh;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .title-group h1 {
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.02em;
    }

    .title-group p {
      color: var(--text-muted);
      font-size: 0.875rem;
      margin-top: 0.25rem;
    }

    .header-controls {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    button {
      font-family: inherit;
      font-size: 0.875rem;
      font-weight: 500;
      padding: 0.5rem 0.875rem;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      min-height: 40px;
      transition: background-color 0.15s ease, border-color 0.15s ease;
    }

    button:hover {
      background-color: var(--border);
    }

    button:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }

    button.primary {
      background-color: var(--primary);
      border-color: var(--primary);
      color: #ffffff;
    }

    button.primary:hover {
      background-color: var(--primary-hover);
    }

    button.danger {
      color: var(--danger);
    }

    button.danger:hover {
      background-color: rgba(239, 68, 68, 0.1);
      border-color: var(--danger);
    }

    .container {
      display: grid;
      grid-template-columns: 1fr;
      gap: 1.5rem;
      max-width: 1400px;
      margin: 0 auto;
    }

    @media (min-width: 1024px) {
      .container {
        grid-template-columns: 1.4fr 1fr;
      }
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .card-header h2 {
      font-size: 1rem;
      font-weight: 600;
    }

    .table-wrapper {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.875rem;
    }

    th, td {
      padding: 0.75rem 0.5rem;
      border-bottom: 1px solid var(--border);
    }

    th {
      color: var(--text-muted);
      font-weight: 500;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    /* Valid dynamic status indicator */
    .status-badge {
      display: inline-block;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .status-running {
      background-color: rgba(16, 185, 129, 0.15);
      color: var(--success);
    }

    .status-stopped {
      background-color: rgba(148, 163, 184, 0.15);
      color: var(--text-muted);
    }

    .status-crashed {
      background-color: rgba(239, 68, 68, 0.15);
      color: var(--danger);
    }

    .status-starting, .status-restarting {
      background-color: rgba(245, 158, 11, 0.15);
      color: var(--warning);
    }

    .mono {
      font-family: var(--font-mono);
      font-size: 0.8125rem;
    }

    .actions-cell {
      display: flex;
      gap: 0.375rem;
    }

    .action-btn-sm {
      padding: 0.25rem 0.5rem;
      min-height: 32px;
      font-size: 0.75rem;
    }

    /* Logs viewer */
    .logs-panel {
      display: flex;
      flex-direction: column;
      height: 600px;
    }

    .logs-output {
      flex: 1;
      background: #000000;
      color: #38bdf8;
      font-family: var(--font-mono);
      font-size: 0.8125rem;
      padding: 0.75rem;
      border-radius: 6px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }

    [data-theme="light"] .logs-output {
      background: #0f172a;
      color: #7dd3fc;
    }

    .empty-state {
      padding: 2.5rem 1rem;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.875rem;
    }
  </style>
</head>
<body>
  <header>
    <div class="title-group">
      <h1>Windows Daemon Manager</h1>
      <p id="daemon-status-text">Connected to Local Service (Session 0)</p>
    </div>
    <div class="header-controls">
      <button id="btn-theme" type="button" aria-label="Toggle visual theme">Theme</button>
      <button id="btn-refresh" class="primary" type="button">Refresh</button>
    </div>
  </header>

  <main class="container">
    <section class="card" aria-labelledby="processes-heading">
      <div class="card-header">
        <h2 id="processes-heading">Managed Processes</h2>
        <span id="process-count" style="font-size: 0.875rem; color: var(--text-muted);">0 processes</span>
      </div>
      <div class="table-wrapper">
        <table id="process-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Status</th>
              <th scope="col">PID</th>
              <th scope="col">Memory</th>
              <th scope="col">Uptime</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody id="process-list-body">
            <tr>
              <td colspan="6" class="empty-state">No background processes configured. Register one via CLI: <code>daemon start &lt;script&gt;</code></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="card logs-panel" aria-labelledby="logs-heading">
      <div class="card-header">
        <h2 id="logs-heading">Live Logs</h2>
        <span id="selected-process-label" style="font-size: 0.875rem; color: var(--text-muted);">Select a process</span>
      </div>
      <div id="log-display" class="logs-output" tabindex="0" role="region" aria-label="Process log output">No process selected. Click 'Logs' on a process to tail output.</div>
    </section>
  </main>

  <script>
    const urlParams = new URLSearchParams(window.location.search);
    const authToken = urlParams.get('token') || '';
    let selectedProcessId = null;
    let eventSource = null;

    function formatBytes(bytes) {
      if (!bytes || bytes === 0) return '0 MB';
      const mb = (bytes / (1024 * 1024)).toFixed(1);
      return mb + ' MB';
    }

    function formatUptime(seconds) {
      if (!seconds || seconds <= 0) return '-';
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      if (m < 60) return m + 'm ' + s + 's';
      const h = Math.floor(m / 60);
      return h + 'h ' + (m % 60) + 'm';
    }

    async function apiRequest(endpoint, method = 'GET', body = null) {
      const headers = { 'Authorization': 'Bearer ' + authToken };
      if (body) headers['Content-Type'] = 'application/json';
      try {
        const res = await fetch(endpoint, {
          method,
          headers,
          body: body ? JSON.stringify(body) : null
        });
        return await res.json();
      } catch (err) {
        console.error('API request failed:', err);
        return { success: false, error: err.message };
      }
    }

    async function loadProcesses() {
      const res = await apiRequest('/api/processes');
      if (!res.success) return;

      const processes = res.data || [];
      const tbody = document.getElementById('process-list-body');
      document.getElementById('process-count').textContent = processes.length + ' processes';

      if (processes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No background processes configured. Register one via CLI: <code>daemon start &lt;script&gt;</code></td></tr>';
        return;
      }

      tbody.innerHTML = processes.map(p => {
        const statusClass = 'status-' + (p.status || 'stopped');
        return \`
          <tr>
            <td>
              <strong>\${escapeHtml(p.name)}</strong>
              <div style="font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono)">\${escapeHtml(p.script)}</div>
            </td>
            <td><span class="status-badge \${statusClass}">\${p.status}</span></td>
            <td class="mono">\${p.pid || '-'}</td>
            <td class="mono">\${formatBytes(p.metrics ? p.metrics.memoryRssBytes : 0)}</td>
            <td>\${formatUptime(p.uptimeSeconds)}</td>
            <td class="actions-cell">
              \${p.status === 'running' 
                ? \`<button class="action-btn-sm" onclick="stopProcess('\${p.id}')">Stop</button>\` 
                : \`<button class="action-btn-sm primary" onclick="startProcess('\${p.id}')">Start</button>\`}
              <button class="action-btn-sm" onclick="restartProcess('\${p.id}')">Restart</button>
              <button class="action-btn-sm" onclick="viewLogs('\${p.id}', '\${escapeHtml(p.name)}')">Logs</button>
              <button class="action-btn-sm danger" onclick="deleteProcess('\${p.id}')">Delete</button>
            </td>
          </tr>
        \`;
      }).join('');
    }

    async function startProcess(id) {
      await apiRequest('/api/processes/' + id + '/start', 'POST');
      loadProcesses();
    }

    async function stopProcess(id) {
      await apiRequest('/api/processes/' + id + '/stop', 'POST');
      loadProcesses();
    }

    async function restartProcess(id) {
      await apiRequest('/api/processes/' + id + '/restart', 'POST');
      loadProcesses();
    }

    async function deleteProcess(id) {
      if (!confirm('Are you sure you want to delete this process?')) return;
      await apiRequest('/api/processes/' + id, 'DELETE');
      if (selectedProcessId === id) {
        selectedProcessId = null;
        document.getElementById('selected-process-label').textContent = 'Select a process';
        document.getElementById('log-display').textContent = 'No process selected.';
      }
      loadProcesses();
    }

    async function viewLogs(id, name) {
      selectedProcessId = id;
      document.getElementById('selected-process-label').textContent = name + ' (' + id + ')';
      const res = await apiRequest('/api/processes/' + id + '/logs');
      if (res.success && res.data) {
        const out = res.data.out || '';
        const err = res.data.err || '';
        const combined = (out + (err ? '\\n--- STDERR ---\\n' + err : '')).trim();
        document.getElementById('log-display').textContent = combined || 'No logs recorded yet.';
      }
    }

    function connectSse() {
      if (eventSource) eventSource.close();
      eventSource = new EventSource('/api/events?token=' + encodeURIComponent(authToken));
      
      eventSource.addEventListener('status', (e) => {
        loadProcesses();
      });

      eventSource.addEventListener('log', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.id === selectedProcessId) {
            const display = document.getElementById('log-display');
            display.textContent += '\\n' + data.text;
            display.scrollTop = display.scrollHeight;
          }
        } catch {}
      });

      eventSource.onerror = () => {
        document.getElementById('daemon-status-text').textContent = 'Reconnecting to local service...';
      };

      eventSource.onopen = () => {
        document.getElementById('daemon-status-text').textContent = 'Connected to Local Service (Session 0)';
      };
    }

    function escapeHtml(str) {
      return (str || '').replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
      );
    }

    // Theme Toggle
    const themeBtn = document.getElementById('btn-theme');
    themeBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const target = current === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', target);
      localStorage.setItem('daemon_theme', target);
    });

    if (localStorage.getItem('daemon_theme') === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    }

    document.getElementById('btn-refresh').addEventListener('click', loadProcesses);

    // Initial load
    loadProcesses();
    connectSse();
    setInterval(loadProcesses, 5000);
  </script>
</body>
</html>`;
}
