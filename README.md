<div align="center">

# Playwright Pool

**The MCP server for browser automation with shared authentication and built-in UI auditing**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP-Compatible-purple)](https://modelcontextprotocol.io/)
[![Playwright](https://img.shields.io/badge/Playwright-1.58%2B-orange)](https://playwright.dev/)

[Getting Started](#getting-started) | [MCP Tools](#mcp-tools-75-total) | [CLI Commands](#cli-42-commands) | [Audit Tools](#audit-tools-28-built-in-audits) | [Why Playwright Pool?](#why-playwright-pool)

</div>

---

## What is Playwright Pool?

Playwright Pool is an MCP (Model Context Protocol) server and CLI that gives AI coding assistants like **Claude Code**, **Cursor**, **Windsurf**, and **Cline** a dynamically managed pool of authenticated Playwright browser instances. It uses a single **golden profile** to share login credentials across unlimited browser windows, with complete session isolation between concurrent AI conversations.

**One MCP config entry. Unlimited browsers. Zero conflicts. 28 built-in audit tools.**

### Key numbers

- **75 MCP tools** -- browser automation, UI auditing, accessibility testing, performance measurement, storage management
- **42 CLI commands** -- everything the MCP server does, plus benchmarking, accuracy testing, and standalone operations
- **28 audit tools** -- accessibility, color contrast, Core Web Vitals, broken links, dark mode, SEO meta, visual diff, security headers, cookie compliance, and more
- **143 device presets** -- emulate iPhone, iPad, Pixel, Galaxy, and more via `pool_launch --device`
- **Compact snapshots** -- `snapshot_compact` uses 90% fewer tokens than full accessibility trees
- **210 browser audit scenarios** researched and documented -- the most comprehensive browser audit coverage of any MCP server
- **100% accuracy** on 80 planted UI bugs across test pages with varying complexity

---

## Why Playwright Pool?

Every other Playwright MCP server gives you a raw browser. Playwright Pool gives you a **browser automation platform with built-in quality auditing**.

### The problem with existing MCP browser tools

AI coding assistants use MCP Playwright servers for browser automation. But the standard `@playwright/mcp` and alternatives have limitations:

- **One browser per MCP entry** -- need 5 browsers? Configure 5 separate MCP entries
- **No credential sharing** -- each instance needs its own login session
- **Cross-session conflicts** -- two AI conversations fight over the same browser instance
- **No audit tools** -- want accessibility or performance data? Bring your own tooling
- **Static scaling** -- cannot dynamically spin up more browsers without editing config

### What Playwright Pool does differently

| Capability | Playwright Pool | @playwright/mcp | Other MCP servers |
|:-----------|:---------------:|:---------------:|:-----------------:|
| Dynamic browser pooling | One entry, unlimited instances | N entries for N instances | Cloud-only or N-to-N |
| Golden profile auth sharing | Log in once, clone to all | Log in per instance | No auth sharing |
| Cross-session isolation | UUID-based, zero conflicts | Sessions share state | Varies |
| Window + tab modes | Both, per-context choice | Single mode | Usually one |
| Built-in audit tools | 28 purpose-built audits | None | None |
| Accessibility testing | axe-core + WCAG 2.1 built in | External tooling | External tooling |
| Visual regression diffing | Built-in screenshot diff | Not available | Not available |
| Core Web Vitals measurement | One command | Not available | Not available |
| CLI for standalone use | 42 commands | Limited | Varies |
| Responsive breakpoint audit | One command, all viewports | Manual resize loop | Manual resize loop |
| Dark mode audit | Automatic light/dark comparison | Not available | Not available |
| SEO meta audit | Built in | Not available | Not available |

### Competitor benchmark results

Tested against Lighthouse CLI, Pa11y, and axe-core CLI on the same test pages:

| Tool | Setup complexity | Audit breadth | MCP integration | Session management |
|:-----|:----------------:|:-------------:|:---------------:|:------------------:|
| **Playwright Pool** | One config entry | 28 audit types + 75 MCP tools | Native MCP server | Dynamic pool + golden profile |
| Lighthouse CLI | Separate install | Performance-focused | None | None |
| Pa11y | Separate install | Accessibility only | None | None |
| axe-core CLI | Separate install | Accessibility only | None | None |

---

## Getting Started

### Quick install

```bash
git clone https://github.com/Zbrooklyn/playwright-pool.git
cd playwright-pool
npm install
npx playwright install chromium
```

### Create a golden profile

Log into your services once. Every browser instance inherits those credentials automatically.

```bash
# Create the profile directory
mkdir -p ~/.playwright-pool/golden-profile

# Launch a browser with this profile and log in manually
npx playwright open --user-data-dir ~/.playwright-pool/golden-profile https://accounts.google.com
```

Log into Google, Stripe, Cloudflare, GitHub, or any other service you need. Close the browser. Your credentials are saved in the golden profile.

### Configure MCP (Claude Code)

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "playwright-pool": {
      "command": "node",
      "args": ["/path/to/playwright-pool/server.js"],
      "env": {
        "GOLDEN_PROFILE": "/path/to/.playwright-pool/golden-profile",
        "POOL_DIR": "/path/to/.playwright-pool/pool-contexts"
      }
    }
  }
}
```

<details>
<summary>Windows example</summary>

```json
{
  "mcpServers": {
    "playwright-pool": {
      "command": "node",
      "args": ["C:/Users/You/playwright-pool/server.js"],
      "env": {
        "GOLDEN_PROFILE": "C:/Users/You/.playwright-pool/golden-profile",
        "POOL_DIR": "C:/Users/You/.playwright-pool/pool-contexts"
      }
    }
  }
}
```

</details>

Restart Claude Code (or your MCP client). The `playwright-pool` server is now available with all 59 tools.

---

## Features

### Browser pool management
- **Golden profile authentication** -- log in once, credentials shared to all instances via auth-file overlay (not full profile copy)
- **Dynamic browser scaling** -- spin up 1, 5, or 20 browser windows on demand without config changes
- **UUID session isolation** -- each AI conversation gets a unique ID, concurrent sessions never conflict
- **Window and tab modes** -- isolated windows for separate auth states, shared tabs for comparison workflows
- **Template caching** -- first launch creates a cached template, subsequent launches are filesystem-only (no extra Chromium startup)
- **Automatic cleanup** -- temp directories deleted on context close, session end, or server exit

### Browser automation (33 MCP tools)
- Navigate, click, fill, type, hover, drag, select options
- Keyboard shortcuts and key combinations
- File upload, dialog handling
- JavaScript evaluation and custom Playwright code execution
- Console message and network request inspection
- Element visibility and value verification
- Tab management, back navigation
- PDF export, screenshot capture, accessibility snapshots
- Tracing (start/stop) for performance debugging

### UI auditing (27 built-in audit tools)
- **Accessibility** -- WCAG 2.1 violations via axe-core, grouped by severity
- **Color contrast** -- text/background ratio checking against AA/AAA standards
- **Responsive breakpoints** -- screenshot all viewports in one command
- **Tap targets** -- touch target size validation (48x48px WCAG 2.5.5)
- **Core Web Vitals** -- LCP, CLS, INP measurement with pass/fail ratings
- **Image audit** -- missing alt text, oversized images, legacy formats, broken URLs
- **Font audit** -- typography consistency, font family/weight/size inventory
- **Computed styles** -- full resolved CSS for any element
- **Overflow detection** -- horizontal overflow at each breakpoint
- **Dark mode** -- light/dark comparison with unchanged-element flagging
- **SEO meta** -- title, description, OG tags, heading hierarchy, robots directives
- **Visual diff** -- pixel-level screenshot comparison with change percentage
- **Focus order** -- keyboard navigation sequence with visible focus indicator check
- **Interactive states** -- hover/focus/active state capture for buttons and links
- **Spacing consistency** -- margin/padding audit against design system scale
- **Z-index map** -- stacking order inventory with conflict detection
- **Broken links** -- HTTP status check for all hrefs and image sources
- **Loading states** -- network-throttled timed screenshots (3G, slow 4G)
- **Form validation** -- empty, invalid, and valid submission state capture
- **Print layout** -- print media emulation and screenshot
- **Scroll behavior** -- sticky element, parallax, infinite scroll audit
- **Element overlap** -- visual collision detection across breakpoints
- **Security headers** -- CSP, HSTS, X-Frame-Options analysis
- **Mixed content** -- HTTP resource detection on HTTPS pages
- **Third-party scripts** -- external script inventory and risk assessment
- **Cookie compliance** -- cookie audit for GDPR/privacy compliance
- **Lighthouse integration** -- full Lighthouse report via CLI

---

## MCP Tools (59 total)

### Pool management (4 tools)

| Tool | Description |
|:-----|:------------|
| `pool_launch` | Create a new browser window or tab with golden profile auth |
| `pool_close` | Close a specific context or all contexts |
| `pool_list` | List all active browser contexts in this session |
| `pool_switch` | Switch active context |

### Browser automation (33 tools)

| Tool | Description |
|:-----|:------------|
| `browser_navigate` | Navigate to a URL |
| `browser_navigate_back` | Go back in browser history |
| `browser_click` | Click an element via CSS or text selector |
| `browser_hover` | Hover over an element |
| `browser_type` | Type text with real keystrokes |
| `browser_press_key` | Press key or key combination |
| `browser_fill_form` | Fill a form field |
| `browser_select_option` | Select from a dropdown |
| `browser_drag` | Drag and drop elements |
| `browser_file_upload` | Upload files to input |
| `browser_handle_dialog` | Accept or dismiss JS dialogs |
| `browser_tabs` | List, create, close, or switch tabs |
| `browser_resize` | Resize viewport dimensions |
| `browser_take_screenshot` | Capture screenshot (inline or file) |
| `browser_snapshot` | Get accessibility tree |
| `browser_evaluate` | Run JavaScript in page |
| `browser_run_code` | Execute arbitrary Playwright code |
| `browser_console_messages` | Get console log/warn/error output |
| `browser_network_requests` | Inspect network requests and responses |
| `browser_wait_for` | Wait for text, element, or condition |
| `browser_verify_element_visible` | Assert element visibility |
| `browser_verify_text_visible` | Assert text is on page |
| `browser_verify_list_visible` | Assert list items in order |
| `browser_verify_value` | Assert input value |
| `browser_generate_locator` | Generate CSS selector from description |
| `browser_mouse_move_xy` | Move cursor to coordinates |
| `browser_mouse_click_xy` | Click at coordinates |
| `browser_mouse_drag_xy` | Drag to coordinates |
| `browser_pdf_save` | Save page as PDF |
| `browser_start_tracing` | Start Playwright trace recording |
| `browser_stop_tracing` | Stop and save trace |
| `browser_install` | Install Chromium binary |
| `browser_close` | Close browser |

### Audit tools (22 MCP tools)

| Tool | What it checks |
|:-----|:---------------|
| `audit_accessibility` | WCAG 2.1 violations via axe-core |
| `audit_color_contrast` | Text/background contrast ratios |
| `audit_breakpoints` | Multi-viewport responsive screenshots |
| `audit_tap_targets` | Touch target minimum size (48x48px) |
| `audit_core_web_vitals` | LCP, CLS, INP performance metrics |
| `audit_image_sizes` | Alt text, oversized images, format, lazy loading |
| `audit_fonts` | Typography consistency and inventory |
| `audit_computed_styles` | Resolved CSS for any element |
| `audit_overflow` | Horizontal overflow per breakpoint |
| `audit_dark_mode` | Light/dark mode comparison |
| `audit_meta` | SEO metadata and heading hierarchy |
| `audit_visual` | Comprehensive programmatic UI report |
| `audit_diff` | Pixel-level screenshot comparison |
| `audit_focus_order` | Keyboard navigation sequence |
| `audit_interactive_states` | Hover/focus/active state capture |
| `audit_spacing_consistency` | Margin/padding vs design system |
| `audit_z_index_map` | Stacking order and conflicts |
| `audit_broken_links` | HTTP status for all links and images |
| `audit_loading_states` | Network-throttled loading screenshots |
| `audit_form_validation` | Form submission state testing |
| `audit_print_layout` | Print media emulation |
| `audit_scroll_behavior` | Sticky, parallax, scroll audit |

---

## CLI (42 commands)

Playwright Pool includes a full CLI for standalone use outside of MCP. Every audit and browser operation is available from the command line.

```bash
# Setup
playwright-pool init              # Initialize golden profile directory
playwright-pool login             # Open golden profile for login
playwright-pool config            # Show current configuration
playwright-pool status            # Check server and browser status
playwright-pool clean             # Clean up temp directories
playwright-pool install           # Install Chromium binary

# Browser operations (17 subcommands)
playwright-pool browser launch    # Launch a browser window
playwright-pool browser navigate  # Navigate to URL
playwright-pool browser click     # Click element
playwright-pool browser type      # Type text
playwright-pool browser key       # Press key combination
playwright-pool browser fill      # Fill form field
playwright-pool browser hover     # Hover element
playwright-pool browser select    # Select dropdown option
playwright-pool browser drag      # Drag and drop
playwright-pool browser upload    # Upload file
playwright-pool browser dialog    # Handle JS dialog
playwright-pool browser resize    # Resize viewport
playwright-pool browser tabs      # Manage tabs
playwright-pool browser back      # Navigate back
playwright-pool browser list      # List contexts
playwright-pool browser switch    # Switch context
playwright-pool browser close     # Close context

# Quick operations
playwright-pool screenshot <url>  # Quick screenshot
playwright-pool snap <url>        # Quick accessibility snapshot
playwright-pool eval <script>     # Quick JS evaluation
playwright-pool pdf <url>         # Quick PDF export

# Inspection
playwright-pool console           # View console messages
playwright-pool network           # View network requests
playwright-pool run <code>        # Run Playwright code
playwright-pool wait <condition>  # Wait for condition
playwright-pool verify <check>    # Verify element/text/value
playwright-pool locator <desc>    # Generate selector

# Mouse operations
playwright-pool mouse move        # Move to coordinates
playwright-pool mouse click       # Click at coordinates
playwright-pool mouse drag        # Drag to coordinates

# Tracing
playwright-pool trace start       # Start recording
playwright-pool trace stop        # Stop and save trace

# Auditing (27 audit types)
playwright-pool audit <url>                    # Run all audits
playwright-pool audit <url> --type=accessibility
playwright-pool audit <url> --type=color-contrast
playwright-pool audit <url> --type=breakpoints
playwright-pool audit <url> --type=tap-targets
playwright-pool audit <url> --type=core-web-vitals
playwright-pool audit <url> --type=image-sizes
playwright-pool audit <url> --type=fonts
playwright-pool audit <url> --type=overflow
playwright-pool audit <url> --type=dark-mode
playwright-pool audit <url> --type=meta
playwright-pool audit <url> --type=diff
playwright-pool audit <url> --type=focus-order
playwright-pool audit <url> --type=broken-links
playwright-pool audit list                     # List available audits

# Testing & benchmarking
playwright-pool benchmark         # Performance benchmark
playwright-pool accuracy          # Accuracy scoring against planted bugs
playwright-pool compare           # Competitor comparison benchmark
```

---

## How It Works

### Golden profile architecture

Copying an entire Chromium user-data-dir causes crashes because cache files, GPU data, and shader caches are tied to specific Chromium builds. Playwright Pool solves this by creating a fresh profile and overlaying only the 13 auth-critical files:

1. You create a **golden profile** -- a Chromium user-data-dir with your login sessions
2. When an AI session requests a browser, the server:
   - Creates a fresh Chromium profile (cached as a template after first use)
   - Overlays auth files (Cookies, Login Data, Local Storage, Session Storage, Web Data, Preferences, Secure Preferences, Local State) from the golden profile
   - Launches a headed Chromium window with the cloned auth
3. Each browser gets a UUID-prefixed temp directory, so parallel sessions never collide
4. Temp directories are cleaned up when browsers close or the session ends

### Session isolation

```
Session A (uuid: a7f3...) --> 3 browser windows (Stripe, Cloudflare, Gmail)
Session B (uuid: b2d1...) --> 2 browser windows (product pages)
Session C (uuid: c9e4...) --> 1 browser window (docs)
```

Six browsers, three sessions, one MCP entry, zero conflicts. Each MCP client session gets its own server process with a unique UUID. All temp directories are prefixed with this UUID, so sessions never touch each other's files or processes.

### Directory structure

```
~/.playwright-pool/
  golden-profile/          # Master profile (log in here)
  pool-contexts/           # Auto-managed temp directories
    a7f3...-template/      # Cached template (session A)
    a7f3...-1/             # Window 1 (session A)
    a7f3...-2/             # Window 2 (session A)
    b2d1...-template/      # Cached template (session B)
    b2d1...-1/             # Window 1 (session B)
```

---

## Use Cases

### AI-assisted UI auditing

Let Claude Code audit your website across every dimension -- accessibility, performance, responsive design, dark mode, SEO -- using natural language commands through the MCP tools.

### Authenticated browser automation

Automate workflows on authenticated dashboards (Stripe, Cloudflare, AWS, Google Analytics) without re-logging in for every session.

### Concurrent AI sessions

Run multiple Claude Code conversations simultaneously, each with their own browser windows, without session conflicts or credential issues.

### Responsive design testing

Audit your site at desktop, tablet, and mobile breakpoints in a single command. Compare screenshots across viewports automatically.

### Visual regression detection

Take before/after screenshots and get pixel-level diff reports with change percentages and highlighted regions.

### Accessibility compliance

Run WCAG 2.1 audits with axe-core integration, check focus order, validate tap targets, and verify color contrast ratios -- all through MCP or CLI.

---

## Configuration

| Environment Variable | Default | Description |
|:---------------------|:--------|:------------|
| `GOLDEN_PROFILE` | `~/.playwright-pool/golden-profile` | Path to golden Chromium profile with saved logins |
| `POOL_DIR` | `~/.playwright-pool/pool-contexts` | Directory for temporary browser profiles |

### Refreshing credentials

When your login sessions expire:

1. Run `playwright-pool login` (or `npx playwright open --user-data-dir ~/.playwright-pool/golden-profile`)
2. Log in again to expired services
3. Close the browser
4. Restart your AI tool -- new browser instances will have fresh credentials

---

## Requirements

- **Node.js** >= 18
- **Playwright** (installed automatically with `npm install`)
- **Chromium** (installed via `npx playwright install chromium`)

Works on **Windows**, **macOS**, and **Linux**.

---

## Frequently Asked Questions

### What is an MCP server?

MCP (Model Context Protocol) is the open standard that lets AI coding assistants like Claude Code, Cursor, Windsurf, and Cline interact with external tools. An MCP server exposes tools that the AI can call. Playwright Pool is an MCP server that exposes 59 browser automation and UI auditing tools.

### How is this different from @playwright/mcp?

The official `@playwright/mcp` gives you a single browser instance per config entry with no authentication sharing, no audit tools, and no session isolation. Playwright Pool gives you a dynamic pool of authenticated browsers with 27 built-in audit tools, all from a single config entry.

### Does this work with Claude Code?

Yes. Playwright Pool is designed primarily for Claude Code but works with any MCP-compatible client including Cursor, Windsurf, Cline, and custom MCP clients.

### Can I use the CLI without MCP?

Yes. The `playwright-pool` CLI provides 42 commands for standalone browser automation and auditing, independent of any MCP client.

### Is this production-ready?

Playwright Pool is actively used in production for UI auditing workflows. It has been tested across 210 browser audit scenarios with 100% accuracy on 80 planted UI bugs.

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full tool roadmap and competitive positioning analysis.

---

## Contributing

Contributions are welcome. Please open an issue to discuss changes before submitting a pull request.

---

## License

[MIT](LICENSE) -- free for personal and commercial use.

---

<div align="center">

**Built for AI-assisted web development.**

Playwright Pool -- browser automation, UI auditing, and accessibility testing for Claude Code and MCP-compatible AI tools.

[Report a Bug](https://github.com/Zbrooklyn/playwright-pool/issues) | [Request a Feature](https://github.com/Zbrooklyn/playwright-pool/issues) | [View Roadmap](ROADMAP.md)

</div>
