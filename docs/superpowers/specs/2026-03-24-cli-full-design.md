# Playwright Pool CLI — Full Design Spec

**Date:** 2026-03-24
**Status:** Approved
**Author:** Edward Shamosh + Claude

## Purpose

Build a full CLI that mirrors 100% of the MCP server's capabilities (66 tools) as 37 CLI commands. The CLI is the preferred interface for AI sessions because it saves massive context tokens — stdout summaries instead of inline base64 screenshots and full accessibility trees.

## Context Savings

| Operation | MCP cost | CLI cost |
|-----------|----------|----------|
| Full site audit (27 tools) | ~50k tokens | ~200 tokens summary |
| 3 breakpoint screenshots | ~15k tokens | ~20 tokens (file paths) |
| Accessibility snapshot | ~5k tokens | ~10 tokens (element count + file path) |

## Design Principles

1. **Smart output** — short results to stdout, large results (screenshots, long reports) auto-saved to files with path printed
2. **gh CLI-style resource-action model** — `playwright-pool <group> <action> [target] [options]`
3. **Lighthouse-style output flexibility** — `--output json,html`, `--save <dir>`, `--json` shorthand
4. **Pa11y-style CI integration** — `--threshold N`, `--fail-on critical`, exit codes 0/1/2
5. **Playwright-style positional args** — `screenshot <url> [filename]`, not `--url` and `--output`
6. **Device presets** — `--mobile`, `--tablet`, `--desktop` as boolean flags
7. **100% MCP parity** — every MCP tool has a CLI equivalent

## Command Reference

### SETUP (5 commands)

Already built in cli.js v3.2.0.

| Command | Description |
|---------|-------------|
| `init` | Create `~/.playwright-pool/` directory structure |
| `login [url]` | Launch headed browser to save credentials to golden profile. Default URL: `https://accounts.google.com` |
| `config` | Auto-detect paths, output `.mcp.json` snippet for Claude Code (Unix + Windows formats) |
| `status` | Show golden profile readiness + list active pool-context sessions with age |
| `clean` | List orphaned pool-context directories with age, prompt for deletion |

### BROWSER (15 commands)

Persistent browser management. These operate on a running browser context that persists until closed.

| Command | MCP Equivalent | Description |
|---------|---------------|-------------|
| `browser launch [options]` | `pool_launch` | Launch a new browser context |
| `browser list [--json]` | `pool_list` | List active contexts |
| `browser switch <id>` | `pool_switch` | Switch active context |
| `browser close <id\|all>` | `pool_close` | Close context(s) |
| `browser navigate <url>` | `browser_navigate` | Navigate active context to URL |
| `browser back` | `browser_navigate_back` | Go back in history |
| `browser tabs <action> [n]` | `browser_tabs` | Tab management (list/new/close/select) |
| `browser click <ref>` | `browser_click` | Click element by snapshot ref |
| `browser hover <ref>` | `browser_hover` | Hover over element |
| `browser type <ref> "text"` | `browser_type` | Type text into element |
| `browser key <key>` | `browser_press_key` | Press key (Enter, Tab, Escape, Ctrl+a) |
| `browser fill <ref> "value"` | `browser_fill_form` | Fill a form field |
| `browser select <ref> "option"` | `browser_select_option` | Select dropdown option |
| `browser resize <w> <h>` | `browser_resize` | Resize viewport to arbitrary dimensions |
| `browser upload <ref> <file...>` | `browser_file_upload` | Upload file(s) to input |
| `browser dialog <accept\|dismiss> [text]` | `browser_handle_dialog` | Handle JS alert/confirm/prompt |
| `browser drag <source-ref> <target-ref>` | `browser_drag` | Drag element to another element |

**`browser launch` options:**
- `--mode window|tab` — isolated window or shared tab (default: window)
- `--label <name>` — name the context
- `--mobile` — 375x812 viewport
- `--tablet` — 768x1024 viewport
- `--desktop` — 1280x800 viewport (default)

**Output:** All browser commands print compact confirmations to stdout. `browser list` supports `--json` for machine-readable output.

### AUDIT (2 commands, 27 audit types)

The primary value of the CLI. One command runs any combination of 27 audits, saves artifacts to files, and prints a compact summary.

| Command | Description |
|---------|-------------|
| `audit <url...> [options]` | Run audits against one or more URLs |
| `audit list [--category <cat>]` | Discover available audit names and categories |

**`audit` options:**

| Flag | Description |
|------|-------------|
| `--only <audits>` | Comma-separated audit names to run |
| `--skip <audits>` | Comma-separated audit names to exclude |
| `--category <cat>` | Run all audits in a category |
| `--mobile` | Run at 375x812 |
| `--tablet` | Run at 768x1024 |
| `--output json\|html` | Output format (repeatable for multiple) |
| `--save <dir>` | Save all artifacts to directory |
| `--json` | Shorthand for `--output json` |
| `--threshold <n>` | Exit code 2 if more than N issues |
| `--fail-on critical\|serious` | Exit code 2 on severity level |
| `--urls-file <file>` | Read URLs from a text file (one per line) |
| `--headed` | Show browser window during audit (default: headless) |

**Categories and their audits:**

| Category | Audits |
|----------|--------|
| `performance` | core_web_vitals, image_sizes, fonts, loading_states |
| `accessibility` | accessibility, color_contrast, focus_order, tap_targets, interactive_states |
| `seo` | meta, broken_links |
| `security` | security_headers, mixed_content, third_party_scripts, cookie_compliance |
| `visual` | breakpoints, overflow, dark_mode, element_overlap, spacing_consistency, z_index_map, scroll_behavior, print_layout, computed_styles |
| `forms` | form_validation |
| `comprehensive` | lighthouse (aggregates all categories into scores) |
| `utility` | diff (takes two file paths, not a URL — run separately via `audit diff <fileA> <fileB>`) |

**Default behavior:**
- No `--only` or `--category` flag → runs ALL audits
- Text results (violations, metadata) → stdout as compact summary
- Screenshots → auto-saved to `./playwright-audit/<timestamp>/`
- Summary line: `12 issues (3 critical, 5 serious, 4 moderate). Full report: ./playwright-audit/2026-03-24T10-30/`

**Exit codes:**
- `0` — pass (no issues, or below threshold)
- `1` — error (couldn't reach URL, browser crash, invalid args)
- `2` — audit issues found (above threshold or matching `--fail-on` severity)

### QUICK OPERATIONS (4 commands)

Fire-and-forget — launch browser, do the thing, close browser, return result. No persistent context needed.

| Command | MCP Equivalent | Description |
|---------|---------------|-------------|
| `screenshot <url> [file]` | `browser_take_screenshot` | Save screenshot, print path |
| `snap <url> [file]` | `browser_snapshot` | Save accessibility snapshot, print path + element count |
| `eval <url> "expression"` | `browser_evaluate` | Run JS expression, print result to stdout |
| `pdf <url> [file]` | `browser_pdf_save` | Save page as PDF, print path |

**`screenshot` options:**
- `--full-page` — capture full scrollable page
- `--mobile` / `--tablet` — device presets
- `--breakpoints` — save 3 screenshots (desktop.png, tablet.png, mobile.png)

**`snap` options:**
- `--interactive` — only interactive elements (reduces output size)

**Default filenames:** `screenshot-<timestamp>.png`, `snapshot-<timestamp>.md`, `page-<timestamp>.pdf`

### INSPECTION (8 commands)

Operate on the active browser context (requires `browser launch` first).

| Command | MCP Equivalent | Description |
|---------|---------------|-------------|
| `console [--level <level>]` | `browser_console_messages` | Dump console messages |
| `network [--filter <pattern>]` | `browser_network_requests` | Dump network requests |
| `run "<playwright code>"` | `browser_run_code` | Run arbitrary Playwright script |
| `wait text "expected"` | `browser_wait_for` | Wait for text to appear |
| `wait gone "expected"` | `browser_wait_for` | Wait for text to disappear |
| `wait <seconds>` | `browser_wait_for` | Wait a fixed time |
| `verify text "expected"` | `browser_verify_text_visible` | Check if text is visible |
| `verify element <role> "name"` | `browser_verify_element_visible` | Check if element is visible |
| `verify list <ref> "item1" "item2"` | `browser_verify_list_visible` | Check if list items are visible in order |
| `verify value <ref> "expected"` | `browser_verify_value` | Check if input has expected value |
| `locator "<description>"` | `browser_generate_locator` | Generate CSS/XPath selector for element |

**`console` levels:** `error`, `warn`, `info`, `debug`, `all` (default: `all`)

**`network` options:**
- `--filter <pattern>` — URL pattern to filter (e.g., `api`, `.json`)
- `--include-static` — include images, fonts, CSS (excluded by default)

**`run` behavior:** Receives a Playwright function string, executes it, prints the return value to stdout. Also accepts bare expressions — `playwright-pool run "await page.title()"` auto-wraps in an async function.

**`wait` behavior:** Blocks until the condition is met or timeout (default 30s). Prints `OK: "text" appeared` or `TIMEOUT: "text" not found after 30s`. Exit code 0 on success, 2 on timeout.

**`verify` behavior:** Prints `PASS: "text" found` or `FAIL: "text" not found` with exit code 0 or 2.

**`locator` behavior:** Prints the generated selector string to stdout.

### MOUSE (3 commands)

Operate on the active browser context. For canvas, SVG, or custom UI interactions.

| Command | MCP Equivalent | Description |
|---------|---------------|-------------|
| `mouse move <x> <y>` | `browser_mouse_move_xy` | Move cursor to coordinates |
| `mouse click <x> <y> [--button left\|right\|middle]` | `browser_mouse_click_xy` | Click at coordinates |
| `mouse drag <x1> <y1> <x2> <y2>` | `browser_mouse_drag_xy` | Drag between coordinates |

### TRACING (2 commands)

Performance trace recording. Operate on active browser context.

| Command | MCP Equivalent | Description |
|---------|---------------|-------------|
| `trace start` | `browser_start_tracing` | Start recording trace |
| `trace stop [file]` | `browser_stop_tracing` | Stop recording, save trace file |

Default filename: `trace-<timestamp>.zip`

### MANAGEMENT (1 command)

| Command | MCP Equivalent | Description |
|---------|---------------|-------------|
| `install` | `browser_install` | Install Chromium binary |

## MCP Parity Matrix

| MCP Tool | CLI Command | Status |
|----------|-------------|--------|
| pool_launch | browser launch | Covered |
| pool_list | browser list | Covered |
| pool_switch | browser switch | Covered |
| pool_close | browser close | Covered |
| browser_open | browser navigate | Covered |
| browser_navigate | browser navigate | Covered |
| browser_navigate_back | browser back | Covered |
| browser_tabs | browser tabs | Covered |
| browser_click | browser click | Covered |
| browser_hover | browser hover | Covered |
| browser_type | browser type | Covered |
| browser_press_key | browser key | Covered |
| browser_press_sequentially | browser type --slowly | Covered |
| browser_fill_form | browser fill | Covered |
| browser_select_option | browser select | Covered |
| browser_drag | browser drag \<src-ref\> \<tgt-ref\> | Covered |
| browser_file_upload | browser upload | Covered |
| browser_handle_dialog | browser dialog accept\|dismiss | Covered |
| browser_wait_for | wait text/gone/seconds | Covered |
| browser_mouse_move_xy | mouse move | Covered |
| browser_mouse_click_xy | mouse click | Covered |
| browser_mouse_drag_xy | mouse drag | Covered |
| browser_snapshot | snap | Covered |
| browser_take_screenshot | screenshot | Covered |
| browser_evaluate | eval | Covered |
| browser_run_code | run | Covered |
| browser_console_messages | console | Covered |
| browser_network_requests | network | Covered |
| browser_generate_locator | locator | Covered |
| browser_verify_element_visible | verify element | Covered |
| browser_verify_text_visible | verify text | Covered |
| browser_verify_list_visible | verify list | Covered |
| browser_verify_value | verify value | Covered |
| browser_resize | browser resize | Covered |
| browser_close | browser close | Covered |
| browser_install | install | Covered |
| browser_pdf_save | pdf | Covered |
| browser_start_tracing | trace start | Covered |
| browser_stop_tracing | trace stop | Covered |
| 27 audit_* tools | audit command | Covered |

**Coverage: 67/67 (100%)** (4 pool + 36 browser + 27 audit)

## Implementation Notes

### File structure
- `cli.js` — main CLI entry point, argument parsing, command routing
- `cli-commands/browser.js` — browser group commands
- `cli-commands/audit.js` — audit command (imports audit logic from server.js/audit-tools-b.js or reimplements for standalone use)
- `cli-commands/quick.js` — screenshot, snap, eval, pdf
- `cli-commands/inspect.js` — console, network, run, verify, wait, locator
- `cli-commands/mouse.js` — mouse move/click/drag
- `cli-commands/trace.js` — trace start/stop
- `cli-commands/mouse.js` — mouse move/click/drag
- `cli-commands/trace.js` — trace start/stop

### Shared context for persistent commands
Browser, inspection, mouse, and trace commands need a persistent browser context. The CLI should:
1. Store the active context state in a temp file (`~/.playwright-pool/cli-state.json`)
2. `browser launch` writes the CDP endpoint to this file
3. Subsequent commands reconnect via CDP
4. `browser close all` clears the state file

### Standalone vs persistent
- **Standalone** (no prior `browser launch` needed): `screenshot`, `snap`, `eval`, `pdf`, `audit`, `init`, `login`, `config`, `status`, `clean`, `install`
- **Persistent** (requires `browser launch` first): `browser *`, `console`, `network`, `run`, `verify`, `wait`, `locator`, `mouse *`, `trace *`

### Global flags
- `--version` / `-V` — print version and exit
- `--quiet` / `-q` — suppress stdout, only set exit code (for CI)
- `--verbose` / `-v` — include passing checks and full details
- `--headed` — show browser window (default for `browser *`, opt-in for `audit`/quick ops)

### Dependencies
- `playwright` — already installed
- No additional dependencies (arg parsing done manually, matching existing cli.js pattern)
