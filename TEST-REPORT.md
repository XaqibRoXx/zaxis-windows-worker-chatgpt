# Zaxis Worker v1.0.1 — Test Report

## Passed in build environment
- JavaScript syntax checks: PASS
- Local state/job/result/log persistence core test: PASS
- Common Crawl provider parsing/query construction test with mocked network: PASS
- GitHub Actions Windows workflow YAML parse: PASS

## Requires real Windows runtime QA
- Electron window launch on Windows 10/11
- System tray integration
- Start with Windows/login item
- Native Windows notifications
- Close-to-tray behavior
- Portable Windows packaging via included GitHub Actions workflow
- Live Common Crawl network calls from the user's machine

## Intentional limitation
Reverse backlink discovery is not fabricated. Current v1 supports Common Crawl domain capture lookup, exact URL history, and live URL verification. A bulk WAT/link provider is required for real inbound backlink discovery.

## v1.0.1 regression fixes
- Common Crawl Domain/URL field typing and paste persistence fixed.
- Periodic state updates no longer destroy active form controls.
- Job detail view stays open during live state updates.
- Run Local Job starts/resumes the worker automatically.
- Pause/stop/cancel now abort active network work with distinct states.
- Windows startup configuration refreshes when Launch Minimized changes.
- Added UI regression checks to CI.
