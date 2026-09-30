# Zaxis Worker 1.1.0

Standalone Windows desktop worker for local Web Intelligence jobs.

## Included in Part 1
- Native Electron desktop window (no terminal required)
- Start/stop/pause worker engine
- Start with Windows toggle
- Launch minimized / close to tray
- Windows system tray controls
- Persistent local job queue and recovery
- Live Common Crawl dataset discovery
- Domain Capture Lookup against Common Crawl index
- Exact URL History lookup
- Live URL HTTP verification
- In-app logs and JSON/CSV export
- Local results storage
- Settings and resource-limit preferences
- Future Zaxis Connection placeholder for Part 2

## Important limitation
Reverse backlink discovery is intentionally not faked. It requires a bulk Common Crawl WAT/link pipeline, which is the next provider module.

## Windows build
The repository includes a GitHub Actions workflow that builds a Windows x64 portable package.

After a successful build:
1. Open the latest **Build Windows** workflow run.
2. Download artifact **Zaxis-Worker-Windows-x64**.
3. Extract it.
4. Open **Zaxis Worker.exe**.

No CMD or PowerShell is required to use the application.

## Zaxis server pairing (desktop side complete)
- Server URL, Worker Name and one-time Pairing Code fields
- Connect / Test Connection / Disconnect controls
- Unique persistent Device ID
- Device token encrypted with Electron/Windows safe storage
- 15-second heartbeat
- 8-second remote job polling
- Remote job accept, progress, result upload, complete and fail callbacks
- No inbound laptop port required; all connections are outbound HTTPS

The matching server endpoints are implemented in Part 2 on the Zaxis Tools website.
