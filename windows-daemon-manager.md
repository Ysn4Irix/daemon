# Windows Daemon Manager

## Goal
Build a Windows-specialized background daemon manager for Node.js (and generic) processes, featuring a Windows Service supervisor running in Session 0, loopback REST/WebSocket control plane with token authentication, scriptable CLI, and a zero-interruption web dashboard.

## Architecture
- **Daemon Supervisor**: Headless daemon running as a Windows Service (Session 0). Spawns processes detached with hidden console windows (`windowsHide: true`).
- **Process Isolation**: Manages process trees via PID tracking and tree kill (`taskkill /T /F`) to prevent orphaned subprocesses.
- **Security & IPC**: Loopback API (`127.0.0.1:4040`) authenticated by bearer token in `%LOCALAPPDATA%\daemon-manager\auth.token`.
- **CLI**: User-facing unprivileged command interface (`daemon start`, `daemon stop`, `daemon list`, `daemon logs`, `daemon ui`).
- **Web Dashboard**: Embedded real-time management dashboard served at `http://127.0.0.1:4040/dashboard` with live log streaming.

## Tasks
- [x] Task 1: Initialize project structure, `package.json`, and TypeScript build config → Verify: `npm run build` generates clean output in `dist/`.
- [x] Task 2: Implement Windows process supervisor with detached execution, log rotation, and crash backoff → Verify: Spawns Node script with hidden window, stdout captured to log file.
- [x] Task 3: Implement Windows process tree terminator and user environment snapshotting → Verify: Child and grandchild processes terminate completely.
- [x] Task 4: Implement authenticated loopback REST & WebSocket API server on `127.0.0.1:4040` → Verify: Requests without token are rejected; valid token returns process list.
- [x] Task 5: Implement Windows Service installation and lifecycle controller (`sc.exe` wrapper) → Verify: Service installs, starts, and survives reboot.
- [x] Task 6: Implement CLI commands (`start`, `stop`, `restart`, `list`, `logs`, `service`, `ui`) → Verify: `daemon list` and `daemon start` work seamlessly from regular terminal.
- [x] Task 7: Build accessible, anti-slop Web Dashboard with live status and log streaming → Verify: Dashboard renders in browser, displays real metrics, complies with WCAG AA.
- [x] Task 8: Verification suite & end-to-end integration test → Verify: Run background Node app, verify zero window popups, view logs, stop app cleanly.

## Done When
- [x] Background apps launch with zero UI or terminal window interruptions.
- [x] Service supervisor runs as an OS background service with persistent state across reboots.
- [x] CLI functions without Administrator elevation for everyday tasks.
- [x] Web Dashboard provides real-time monitoring and log inspection with token security.
