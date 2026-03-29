# Changelog

## 1.0.0 — First Public Release

### Features
- **75 MCP tools** — pool management, browser automation, 28 audit tools, utility tools
- **42 CLI commands** — full parity with MCP tools, plus standalone audit and screenshot commands
- **35 WCAG accessibility rules** — 95.5% detection rate on Accessible University benchmark
- **Golden profile authentication** — share a single login across unlimited browser instances
- **Vision model integration** — structured prompts for catching what code can't (color-only info, images of text)
- **143 device presets** — test across mobile, tablet, desktop configurations
- **Screenshot auto-save** — images saved to disk, base64 stripped from MCP responses to prevent context crashes
- **Compact snapshots** — 90% fewer tokens than full browser snapshots

### Architecture
- Single audit engine (`audit.js`) shared across CLI, MCP server, and MCP tools — bug fixes apply everywhere
- Auth overlay pattern (not full profile copy) prevents Chromium cache/GPU crashes
- Template caching — first launch ~17s, subsequent launches <2s
- UUID session isolation — concurrent MCP servers never collide

### Benchmarks
- W3C BAD: 74 violations detected across 13 rules
- Accessible University: 95.5% detection (21/22 known barriers)
- Package size: ~150KB (24 files, 1 production dependency)

### Known Limitations
- Google OAuth requires headed mode (`headless: false`) — Google blocks headless Chromium sessions
- Non-Google services work fine in headless mode
