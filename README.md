# Playwright Pool

An MCP (Model Context Protocol) server that dynamically manages a pool of authenticated Playwright browser instances from a single golden profile. One MCP config entry, unlimited browser instances, zero conflicts across concurrent AI sessions.

## The Problem

AI coding assistants like Claude Code use MCP Playwright servers for browser automation. But the standard `@playwright/mcp` has limitations:

- **One browser per MCP entry** - need 5 browsers? Configure 5 separate MCP entries
- **No credential sharing** - each instance needs its own login session
- **Cross-session conflicts** - two AI conversations fight over the same browser instance
- **Static scaling** - can't dynamically spin up more browsers without editing config

## The Solution

Playwright Pool solves all of this:

- **One MCP entry** - a single `playwright-pool` config manages everything
- **Golden profile** - log in once, credentials are shared to all instances
- **UUID isolation** - each AI session gets a unique ID, so concurrent sessions never conflict
- **Dynamic scaling** - spin up 1, 5, or 20 browsers on demand, no config changes

```
Session A (uuid: a7f3...) → 3 browser windows (Stripe, Cloudflare, Gmail)
Session B (uuid: b2d1...) → 2 browser windows (product pages)
Session C (uuid: c9e4...) → 1 browser window (docs)
```

Six browsers, three sessions, one MCP entry, zero conflicts.

## How It Works

1. You create a **golden profile** - a Chromium user-data-dir with your login sessions (Google, Stripe, etc.)
2. When an AI session requests a browser, the server:
   - Creates a fresh Chromium profile (cached as a template after first use)
   - Overlays auth files (cookies, localStorage, credentials) from the golden profile
   - Launches a headed Chromium window with the cloned auth
3. Each browser gets a UUID-prefixed temp directory, so parallel sessions never collide
4. Temp directories are cleaned up when browsers close or the session ends

### Why Not Just Copy the Whole Profile?

Copying an entire Chromium profile causes crashes. Cache files, GPU data, and shader caches are tied to specific Chromium builds and break when loaded by a different binary. Playwright Pool solves this by creating a fresh profile and overlaying only the 13 auth-critical files:

- Cookies, Login Data, Local Storage, Session Storage
- Web Data, Preferences, Secure Preferences, Local State

## Setup

### 1. Install

```bash
git clone https://github.com/Zbrooklyn/playwright-pool.git
cd playwright-pool
npm install
npx playwright install chromium
```

### 2. Create a Golden Profile

Create a directory for your golden profile and log into your services:

```bash
# Create the profile directory
mkdir -p ~/.playwright-pool/golden-profile

# Launch a browser with this profile and log in manually
npx playwright open --user-data-dir ~/.playwright-pool/golden-profile https://accounts.google.com
```

Log into Google (and any other services you need - Stripe, Cloudflare, GitHub, etc.), then close the browser. Your credentials are now saved in the golden profile.

### 3. Configure MCP

Add to your `.mcp.json` (Claude Code) or equivalent MCP config:

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

**Windows example:**
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

### 4. Restart Your AI Tool

Restart Claude Code (or whichever MCP client you use). The `playwright-pool` server is now available.

## Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `pool_launch` | Create a new browser window or tab | `mode` (window/tab), `width`, `height`, `label` |
| `pool_navigate` | Navigate to a URL | `id`, `url` |
| `pool_screenshot` | Take a screenshot | `id`, `savePath`, `fullPage` |
| `pool_snapshot` | Get accessibility tree | `id` |
| `pool_click` | Click an element | `id`, `selector` |
| `pool_fill` | Fill a form field | `id`, `selector`, `value` |
| `pool_evaluate` | Run JavaScript in page | `id`, `script` |
| `pool_resize` | Resize viewport | `id`, `width`, `height` |
| `pool_list` | List all active contexts | - |
| `pool_close` | Close a context or "all" | `id` |

## Modes

### Window Mode (default)

Each `pool_launch mode=window` creates a separate Chromium window with its own isolated profile. Windows don't share cookies or state.

**Use for:** Parallel authenticated sessions (e.g., Stripe in one window, Cloudflare in another).

### Tab Mode

`pool_launch mode=tab` opens tabs in a shared browser window. All tabs share the same cookies and localStorage.

**Use for:** Comparing pages that don't need separate auth states (e.g., viewing multiple product pages).

## Examples

### Side-by-Side Dashboards

```
pool_launch mode=window label=stripe
pool_launch mode=window label=cloudflare
pool_navigate <id1> https://dashboard.stripe.com
pool_navigate <id2> https://dash.cloudflare.com
```

### Responsive Audit at 3 Breakpoints

```
pool_launch mode=window width=1280 height=800 label=desktop
pool_launch mode=window width=768 height=1024 label=tablet
pool_launch mode=window width=375 height=812 label=mobile
pool_navigate <all> https://your-site.com
pool_screenshot <all>
```

### Multiple Tabs for Comparison

```
pool_launch mode=tab label=page-1
pool_launch mode=tab label=page-2
pool_launch mode=tab label=page-3
pool_navigate <id1> https://example.com/product/1
pool_navigate <id2> https://example.com/product/2
pool_navigate <id3> https://example.com/product/3
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `GOLDEN_PROFILE` | `~/.playwright-pool/golden-profile` | Path to golden Chromium profile with saved logins |
| `POOL_DIR` | `~/.playwright-pool/pool-contexts` | Directory for temporary browser profiles |

## Refreshing Credentials

When your login sessions expire:

1. Open the golden profile in a browser:
   ```bash
   npx playwright open --user-data-dir ~/.playwright-pool/golden-profile https://accounts.google.com
   ```
2. Log in again
3. Close the browser
4. Restart your AI tool - new browser instances will have fresh credentials

## Architecture

```
~/.playwright-pool/
  golden-profile/          # Master profile (log in here, never browse directly)
  pool-contexts/           # Auto-managed temp directories
    a7f3...-template/      # Cached template (session A)
    a7f3...-1/             # Window 1 (session A)
    a7f3...-2/             # Window 2 (session A)
    b2d1...-template/      # Cached template (session B)
    b2d1...-1/             # Window 1 (session B)
```

### Session Isolation

Each MCP client session (e.g., each Claude Code conversation) gets its own server process with a unique UUID. All temp directories are prefixed with this UUID, so:

- Session A's browsers are in `a7f3...-1/`, `a7f3...-2/`, etc.
- Session B's browsers are in `b2d1...-1/`, `b2d1...-2/`, etc.
- They never touch each other's files or processes

### Cleanup

- Closing a context (`pool_close`) deletes its temp directory
- Closing all contexts (`pool_close all`) wipes everything for that session
- When the server process exits (session ends), it cleans up its own temp dirs
- Other sessions' directories are never touched

## Requirements

- Node.js >= 18
- Playwright (installed automatically with `npm install`)
- Chromium (installed via `npx playwright install chromium`)

## License

MIT
