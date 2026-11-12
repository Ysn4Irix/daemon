# Windows Daemon Manager

A specialized Windows background daemon and process supervisor designed to execute Node.js (and generic) applications in the background with zero desktop UI or console window interruptions.

## Features

- **Session 0 Headless Execution:** Spawns child processes using Windows flags (`windowsHide: true`, `detached: true`) so no command prompt windows ever appear.
- **Process Tree Management:** Terminates entire process trees via native `taskkill /PID <pid> /T /F` to eliminate orphaned child processes.
- **Crash Recovery & Auto-Restart:** Detects unexpected process exits and restarts them using exponential backoff capped at 30 seconds.
- **Log Streaming & Rotation:** Captures `stdout` and `stderr` directly into size-capped rotating log files, with live streaming over Server-Sent Events (SSE).
- **Dual Control Plane:**
  - Fast scriptable CLI for everyday unprivileged terminal usage.
  - Embedded local Web Dashboard at `http://127.0.0.1:4040/dashboard` with real-time process monitoring, memory metrics, and log tailing.
- **Security:** Authenticated via bearer tokens stored in `%LOCALAPPDATA%\daemon-manager\auth.token`. Loopback-only binding (`127.0.0.1`) prevents unauthorized access.
- **Boot Persistence (Windows Service):** Registerable as a Windows startup service via Windows Task Scheduler (`daemon service install`).

---

## Installation & Setup

### Prerequisites
- Node.js 18+ (tested on Node.js v24)
- Windows 10, 11, or Windows Server

### Build

```bash
pnpm install
pnpm run build
```

To link the CLI globally:
```bash
npm link
```

---

## CLI Usage

### 1. Start a Script or Command in the Background
```bash
# Start a Node.js script
daemon start server.js --name my-api

# Start package manager commands
daemon start npm start --name web-frontend
daemon start pnpm run dev --name dev-server
daemon start yarn start --name app

# Start arbitrary commands
daemon start python worker.py --name sync-job
daemon start --cmd "npm run build --watch" --name builder
```
*Launches scripts or commands with a hidden console window and zero UI interruptions. The supervisor auto-starts in the background if not already running.*

### 2. List All Managed Processes
```bash
daemon list
```
Displays ID, Name, Status, PID, Memory usage, and Uptime.

### 3. View Real-Time Logs
```bash
daemon logs my-api
```
Prints recent stdout and stderr output.

### 4. Restart or Stop a Process
```bash
daemon restart my-api
daemon stop my-api
```

### 5. Remove a Process
```bash
daemon delete my-api
```

### 6. Open the Web Dashboard
```bash
daemon ui
```
Opens your default browser to `http://127.0.0.1:4040/dashboard?token=<token>` with authentication pre-filled.

---

## Windows Service Setup (Boot Persistence)

To have the supervisor launch automatically on system boot before user login:

1. Open an Administrator PowerShell or Command Prompt.
2. Run:
```bash
daemon service install
```
To check status or uninstall:
```bash
daemon service status
daemon service uninstall
```

---

## Verification & Testing

Run the automated test suite:
```bash
pnpm test
```
Validates:
- Storage and token management.
- Headless process spawning, stdout capture, and tree termination.
- Loopback REST and SSE API authentication.
