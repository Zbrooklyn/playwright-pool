# Competitor Analysis: Playwright Pool vs. Browser MCP Servers

*Last updated: 2026-03-24*

This is an exhaustive feature-by-feature comparison of **playwright-pool** against every real competitor in the MCP browser automation space. These are the tools AI coding assistants actually use for browser automation -- not audit-only tools like Lighthouse or Pa11y.

---

## Competitors at a Glance

| | playwright-pool | @playwright/mcp | agent-browser | browser-pool-mcp | playwriter | browserbase | mcp-playwright |
|:-|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Maintainer** | Zbrooklyn | Microsoft | Vercel Labs | OMGEverdo | remorses | Browserbase Inc. | ExecuteAutomation |
| **GitHub stars** | New | 29,606 | 24,625 | 0 | 3,212 | 3,203 | 5,347 |
| **npm package** | playwright-pool | @playwright/mcp | agent-browser | N/A | playwriter | @browserbasehq/mcp-server-browserbase | @executeautomation/playwright-mcp-server |
| **Latest version** | 4.0.0 | 0.0.68 | 0.22.1 | N/A | 0.0.89 | 2.4.3 | 1.0.12 |
| **Last updated** | 2026-03-24 | 2026-03-20 | 2026-03-24 | 2026-02-02 | 2026-03-22 | 2026-02-27 | 2025-12-13 |
| **Primary approach** | MCP server + CLI | MCP server | Standalone CLI | MCP proxy layer | Chrome extension + MCP | Cloud MCP server | MCP server |
| **Architecture** | Pool mgmt over @playwright/mcp internals | Direct Playwright wrapper | Native Rust CLI | Spawns @playwright/mcp subprocesses | Chrome debugger + WebSocket | Stagehand v3 cloud API | Direct Playwright wrapper |

---

## A. Core Capabilities

| Feature | playwright-pool | @playwright/mcp | agent-browser | browser-pool-mcp | playwriter | browserbase | mcp-playwright |
|:--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Total MCP tools** | 59 (+ 8 audit-only CLI) | ~47 (with all caps) | N/A (CLI tool) | ~20 (proxied) | 1 (`execute`) | ~5-8 | ~6-10 |
| **Chromium support** | ✅ | ✅ | ✅ (Chrome for Testing) | ✅ (via @pw/mcp) | ✅ (Chrome only) | ✅ (cloud) | ✅ |
| **Firefox support** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **WebKit support** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Headed mode** | ✅ (default) | ✅ (default) | ⚠️ (headless-first) | ✅ | ✅ (headed only) | ❌ (cloud) | ✅ |
| **Headless mode** | ✅ | ✅ | ✅ (default) | ✅ | ❌ | ✅ (cloud) | ✅ |
| **Multiple concurrent browsers** | ✅ Unlimited, dynamic | ❌ 1 per config entry | ❌ Single instance | ✅ Up to 10 | ❌ Single browser | ✅ (cloud-managed) | ⚠️ HTTP mode multi-client |
| **Session persistence** | ✅ Golden profile overlay | ✅ Persistent user-data-dir | ✅ Profile directory | ❌ Isolated only | ✅ Uses existing browser | ✅ Context persistence | ❌ |
| **Cross-session isolation** | ✅ UUID-based, zero conflicts | ❌ Sessions share state | ❌ Single instance | ✅ Port-based isolation | ❌ Shared tabs | ⚠️ Session IDs | ❌ |
| **Window + tab modes** | ✅ Both, user chooses | ❌ Single context | ✅ Tab management | ❌ Window only | ⚠️ Tab-based | ❓ | ❌ |
| **Device emulation** | ⚠️ Manual resize | ✅ `--device` flag | ✅ `set device` | ❌ | ❌ | ✅ Width/height | ✅ 143 device presets |

---

## B. Authentication & Profiles

| Feature | playwright-pool | @playwright/mcp | agent-browser | browser-pool-mcp | playwriter | browserbase | mcp-playwright |
|:--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Golden profile / credential sharing** | ✅ Auth-file overlay from single master profile | ❌ One profile per instance | ⚠️ Manual profile reuse | ❌ | ✅ Uses your live browser | ❌ API key auth | ❌ |
| **Google OAuth support** | ✅ Via golden profile cookies | ✅ Via persistent profile | ⚠️ Blocked by Chrome for Testing; manual workaround | ❌ | ✅ Already logged in | ❌ | ❌ |
| **Cookie management tools** | ⚠️ Via browser_evaluate | ✅ 5 dedicated tools (get/set/list/delete/clear) | ✅ cookies, cookies set, cookies clear | ❌ | ⚠️ Via execute | ❌ | ❌ |
| **localStorage management** | ⚠️ Via browser_evaluate | ✅ 5 dedicated tools | ✅ storage local get/set/clear | ❌ | ⚠️ Via execute | ❌ | ❌ |
| **sessionStorage management** | ⚠️ Via browser_evaluate | ✅ 5 dedicated tools | ✅ storage session get/set/clear | ❌ | ⚠️ Via execute | ❌ | ❌ |
| **Storage state save/restore** | ❌ | ✅ browser_storage_state / browser_set_storage_state | ❌ | ❌ | ❌ | ✅ Context persistence | ❌ |
| **Template caching** | ✅ One-time template, filesystem copies | ❌ | ❌ | ❌ | N/A | N/A (cloud) | ❌ |
| **Auth overlay (not full copy)** | ✅ 13 auth-critical files only | ❌ Full profile | ❌ Full profile | ❌ | N/A | N/A | ❌ |

---

## C. Interaction Tools

| Feature | playwright-pool | @playwright/mcp | agent-browser | browser-pool-mcp | playwriter | browserbase | mcp-playwright |
|:--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Click** | ✅ browser_click | ✅ browser_click | ✅ click, dblclick | ✅ (proxied) | ✅ via execute | ✅ act | ✅ |
| **Type / fill** | ✅ browser_type, browser_fill_form | ✅ browser_type, browser_fill_form | ✅ type, fill | ✅ (proxied) | ✅ via execute | ✅ act | ✅ |
| **Hover** | ✅ browser_hover | ✅ browser_hover | ✅ hover | ✅ (proxied) | ✅ via execute | ❌ | ❌ |
| **Drag and drop** | ✅ browser_drag | ✅ browser_drag | ✅ drag | ❌ | ✅ via execute | ❌ | ❌ |
| **Keyboard input** | ✅ browser_press_key | ✅ browser_press_key | ✅ press, key, keyboard | ✅ (proxied) | ✅ via execute | ❌ | ❌ |
| **File upload** | ✅ browser_file_upload | ✅ browser_file_upload | ✅ upload | ✅ (proxied) | ✅ via execute | ❌ | ❌ |
| **Dialog handling** | ✅ browser_handle_dialog | ✅ browser_handle_dialog | ❌ | ✅ (proxied) | ✅ via execute | ❌ | ❌ |
| **Tab management** | ✅ browser_tabs | ✅ browser_tabs | ✅ tab, tab new, tab close | ✅ (proxied) | ⚠️ Extension tab control | ❌ | ❌ |
| **Select dropdown** | ✅ browser_select_option | ✅ browser_select_option | ✅ select | ✅ (proxied) | ✅ via execute | ❌ | ❌ |
| **Mouse XY move** | ✅ browser_mouse_move_xy | ✅ browser_mouse_move_xy | ✅ mouse move | ❌ | ✅ via execute | ❌ | ❌ |
| **Mouse XY click** | ✅ browser_mouse_click_xy | ✅ browser_mouse_click_xy | ✅ mouse down/up | ❌ | ✅ via execute | ❌ | ❌ |
| **Mouse XY drag** | ✅ browser_mouse_drag_xy | ✅ browser_mouse_drag_xy | ❌ | ❌ | ✅ via execute | ❌ | ❌ |
| **Mouse wheel** | ❌ | ✅ browser_mouse_wheel | ✅ mouse wheel | ❌ | ✅ via execute | ❌ | ❌ |
| **Mouse down/up** | ❌ | ✅ browser_mouse_down/up | ✅ mouse down/up | ❌ | ✅ via execute | ❌ | ❌ |
| **Wait / verify tools** | ✅ 5 tools (wait, verify element/text/list/value) | ✅ browser_wait_for + 4 verify tools | ✅ wait (multiple modes) | ✅ browser_wait_for | ✅ via execute | ❌ | ❌ |
| **Viewport resize** | ✅ browser_resize | ✅ browser_resize | ✅ set viewport | ✅ (proxied) | ⚠️ | ✅ CLI flags | ✅ playwright_resize |
| **Navigate back** | ✅ browser_navigate_back | ✅ browser_navigate_back | ❌ | ❌ | ✅ via execute | ❌ | ❌ |

---

## D. Inspection Tools

| Feature | playwright-pool | @playwright/mcp | agent-browser | browser-pool-mcp | playwriter | browserbase | mcp-playwright |
|:--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Screenshot (inline base64)** | ✅ browser_take_screenshot | ✅ browser_take_screenshot | ❌ | ✅ (proxied) | ✅ Annotated with labels | ✅ Full-page + element | ✅ |
| **Screenshot (save to file)** | ✅ | ✅ | ✅ screenshot [path] | ❌ | ❌ | ❌ | ❌ |
| **Annotated screenshots** | ❌ | ❌ | ✅ --annotate (numbered labels) | ❌ | ✅ Color-coded labels | ✅ Vision annotations | ❌ |
| **Full-page screenshot** | ✅ | ✅ | ✅ --full | ❌ | ✅ | ✅ | ✅ |
| **Accessibility snapshot** | ✅ browser_snapshot | ✅ browser_snapshot | ✅ snapshot (with @refs) | ✅ (proxied) | ✅ | ❌ | ❌ |
| **Console messages** | ✅ browser_console_messages | ✅ browser_console_messages | ❌ | ✅ (proxied) | ✅ via execute | ❌ | ❌ |
| **Network requests** | ✅ browser_network_requests | ✅ browser_network_requests | ✅ network requests | ✅ (proxied) | ✅ via execute | ❌ | ❌ |
| **Network mocking/routing** | ❌ | ✅ browser_route / browser_unroute | ✅ network route/unroute | ❌ | ✅ via execute | ❌ | ❌ |
| **Network offline toggle** | ❌ | ✅ browser_network_state_set | ✅ set offline | ❌ | ✅ via execute | ❌ | ❌ |
| **HAR recording** | ❌ | ❌ | ✅ network har start/stop | ❌ | ❌ | ❌ | ❌ |
| **JS evaluation** | ✅ browser_evaluate | ✅ browser_evaluate | ✅ eval | ✅ (proxied) | ✅ via execute | ❌ | ✅ |
| **Run Playwright code** | ✅ browser_run_code | ✅ browser_run_code | ❌ | ❌ | ✅ Full Playwright API | ❌ | ❌ |
| **PDF generation** | ✅ browser_pdf_save | ✅ browser_pdf_save | ✅ pdf | ❌ | ✅ via execute | ❌ | ❌ |
| **Tracing (start/stop)** | ✅ browser_start/stop_tracing | ✅ browser_start/stop_tracing | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Video recording** | ❌ | ✅ browser_start/stop_video | ❌ | ❌ | ✅ Native tab capture | ❌ | ❌ |
| **Locator generation** | ✅ browser_generate_locator | ✅ browser_generate_locator | ✅ find (role/text/label) | ❌ | ❌ | ❌ | ❌ |
| **Get config** | ❌ | ✅ browser_get_config | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Clipboard access** | ❌ | ❌ | ✅ clipboard read/write/copy/paste | ❌ | ❌ | ❌ | ❌ |

---

## E. Audit Capabilities

This is where playwright-pool differentiates most dramatically. No other MCP browser tool has built-in audit capabilities.

| Feature | playwright-pool | @playwright/mcp | agent-browser | browser-pool-mcp | playwriter | browserbase | mcp-playwright |
|:--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Accessibility audit (WCAG)** | ✅ audit_accessibility | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Color contrast checking** | ✅ audit_color_contrast | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **SEO metadata audit** | ✅ audit_meta | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Core Web Vitals** | ✅ audit_core_web_vitals | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Responsive breakpoint testing** | ✅ audit_breakpoints | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Visual diff / regression** | ✅ audit_diff | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Dark mode comparison** | ✅ audit_dark_mode | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Tap target sizing** | ✅ audit_tap_targets | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Image audit** | ✅ audit_image_sizes | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Font consistency** | ✅ audit_fonts | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Computed styles** | ✅ audit_computed_styles | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Overflow detection** | ✅ audit_overflow | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Focus order audit** | ✅ audit_focus_order | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Interactive state capture** | ✅ audit_interactive_states | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Spacing consistency** | ✅ audit_spacing_consistency | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Z-index stacking map** | ✅ audit_z_index_map | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Broken link checker** | ✅ audit_broken_links | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Loading state capture** | ✅ audit_loading_states | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Form validation audit** | ✅ audit_form_validation | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Print layout audit** | ✅ audit_print_layout | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Scroll behavior audit** | ✅ audit_scroll_behavior | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Element overlap detection** | ✅ audit_element_overlap | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Security headers** | ✅ audit_security_headers | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Mixed content detection** | ✅ audit_mixed_content | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Third-party script inventory** | ✅ audit_third_party_scripts | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Cookie compliance (GDPR)** | ✅ audit_cookie_compliance | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Lighthouse integration** | ✅ audit_lighthouse | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Comprehensive visual audit** | ✅ audit_visual (all-in-one) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Total audit tools** | **27** | **0** | **0** | **0** | **0** | **0** | **0** |

---

## F. CLI / Standalone Usage

| Feature | playwright-pool | @playwright/mcp | agent-browser | browser-pool-mcp | playwriter | browserbase | mcp-playwright |
|:--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **CLI available** | ✅ 42 commands | ⚠️ Config flags only | ✅ Full CLI (50+ commands) | ❌ | ✅ Session + execute CLI | ⚠️ Config flags | ❌ |
| **Can run without MCP** | ✅ | ❌ | ✅ (CLI-native) | ❌ | ✅ | ❌ | ❌ |
| **Scriptable / CI-friendly** | ✅ | ⚠️ (MCP only) | ✅ (batch mode, piping) | ❌ | ✅ | ⚠️ | ⚠️ (HTTP mode) |
| **Benchmark tooling** | ✅ benchmark + accuracy + compare | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Quick commands** | ✅ screenshot/snap/eval/pdf | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Setup wizard** | ✅ init, login, config | ❌ | ✅ install | ❌ | ❌ | ❌ | ❌ |
| **Status/health check** | ✅ status, clean | ❌ | ❌ | ✅ pool_status, pool_test | ❌ | ❌ | ❌ |

---

## G. Architecture

| Feature | playwright-pool | @playwright/mcp | agent-browser | browser-pool-mcp | playwriter | browserbase | mcp-playwright |
|:--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Browser instance management** | Pool with golden profile template caching | Single persistent or isolated context | Single Chrome for Testing instance | Spawns @playwright/mcp subprocesses on dynamic ports | Connects to user's running Chrome via extension | Cloud-managed (Browserbase infra) | Single Playwright instance |
| **Concurrent session handling** | UUID-prefixed temp dirs, zero conflicts | N/A (single instance) | N/A (single instance) | Port-based isolation, max 10 | Shared browser, isolated session state | Cloud session IDs | HTTP mode: shared server |
| **Cleanup on exit** | ✅ Auto-cleanup temp dirs on close/exit | ✅ Manages own profile | ❌ | ✅ 30-min idle timeout | N/A (user's browser) | Cloud-managed | ❌ |
| **RAM per instance** | ~200-500 MB (Chromium) | ~200-500 MB | ~200-500 MB | ~200-500 MB per subprocess | 0 (reuses existing Chrome) | 0 (cloud) | ~200-500 MB |
| **Template caching** | ✅ First launch creates reusable template | ❌ | ❌ | ❌ | N/A | N/A | ❌ |
| **Transport** | stdio (MCP) | stdio or SSE (HTTP) | N/A (CLI) | stdio (MCP) | WebSocket + stdio | stdio or SSE | stdio or HTTP |
| **Anti-bot stealth** | ⚠️ --disable-blink-features flag | ❌ | ❌ | ❌ | ✅ Real browser with extensions | ✅ Advanced stealth mode | ❌ |

---

## H. Ecosystem

| Feature | playwright-pool | @playwright/mcp | agent-browser | browser-pool-mcp | playwriter | browserbase | mcp-playwright |
|:--------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **npm package** | ✅ (not yet published) | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| **GitHub stars** | New repo | 29,606 | 24,625 | 0 | 3,212 | 3,203 | 5,347 |
| **Maintenance status** | Active | Active (Microsoft) | Active (Vercel) | Stale (Feb 2026) | Active | Slowing | Stale (Dec 2025) |
| **Documentation quality** | Comprehensive README + ROADMAP | Excellent (Microsoft-grade) | Good (extensive CLI help) | Minimal | Good | Good | Moderate |
| **Install complexity** | `npm install` + `npx playwright install chromium` | `npx @playwright/mcp@latest` | `npm i -g agent-browser && agent-browser install` | Clone + npm install | `npm i -g playwriter` + Chrome extension | `npm install` + API key signup | `npm install` |
| **MCP client compatibility** | Claude Code, Cursor, Windsurf, Cline | Claude Code, Cursor, Windsurf, Cline | Claude Code (via bash) | Claude Code | Claude Code, Cursor | Claude Code, Cursor | Claude Desktop, VS Code |
| **Free / open source** | ✅ MIT | ✅ Apache 2.0 | ✅ MIT | ✅ MIT | ✅ MIT | ⚠️ Free tier + paid | ✅ MIT |
| **Cloud option** | ❌ Local only | ❌ Local only | ❌ Local only | ❌ Local only | ❌ Local only | ✅ Cloud-native | ❌ Local only |

---

## Strategic Analysis

### 1. Where playwright-pool wins -- features no competitor has

These capabilities are **unique to playwright-pool** across all competitors:

1. **27 built-in audit tools** -- No other MCP browser server has even 1 audit tool. This is the single biggest differentiator. Every competitor requires external tooling (Lighthouse CLI, Pa11y, axe-core CLI) for any quality auditing.

2. **Golden profile auth with overlay architecture** -- Other tools either copy the entire profile (crash-prone with Chromium builds) or have no auth sharing at all. The 13-file auth overlay is unique.

3. **Dynamic browser pooling from a single MCP entry** -- browser-pool-mcp also does pooling, but spawns entire @playwright/mcp subprocesses (heavy). playwright-pool manages pool entries within a single process using internal Playwright MCP modules.

4. **Window + tab mode choice** -- Users can choose isolated windows (separate auth) or shared tabs (comparison workflows). No competitor offers this choice.

5. **Template caching** -- First launch creates a reusable template profile; subsequent launches are filesystem copies only (no extra Chromium startup). No competitor does this.

6. **Benchmark + accuracy scoring infrastructure** -- Built-in tools for measuring audit accuracy against planted bugs and benchmarking performance. No competitor has anything similar.

7. **Comprehensive programmatic visual audit** (`audit_visual`) -- Single-command all-in-one audit covering 12+ categories. Unique.

8. **42-command CLI with full MCP parity** -- Every MCP tool is also available standalone from the command line, plus benchmark/accuracy/compare tools. agent-browser has a rich CLI too, but without audit capabilities.

### 2. Where competitors win -- features playwright-pool is missing

| Gap | Who has it | Priority | Effort |
|:----|:-----------|:---------|:-------|
| **Firefox + WebKit support** | @playwright/mcp, mcp-playwright | Medium | Medium -- Playwright supports all three; need config plumbing |
| **Dedicated cookie/localStorage/sessionStorage tools** | @playwright/mcp (15 storage tools) | High | Low -- add thin wrappers around page.context().cookies() etc. |
| **Storage state save/restore** | @playwright/mcp (browser_storage_state, browser_set_storage_state) | High | Low -- serialize/deserialize cookies + localStorage |
| **Network mocking/routing** | @playwright/mcp, agent-browser | Medium | Medium -- wrap Playwright route API |
| **Network offline toggle** | @playwright/mcp, agent-browser | Low | Low -- one-liner context.setOffline() |
| **HAR recording** | agent-browser | Low | Medium -- Playwright has built-in HAR support |
| **Video recording** | @playwright/mcp, playwriter | Low | Medium -- context.tracing has video support |
| **Mouse wheel scrolling** | @playwright/mcp, agent-browser | Low | Low -- page.mouse.wheel() |
| **Mouse down/up events** | @playwright/mcp, agent-browser | Low | Low -- page.mouse.down()/up() |
| **Annotated screenshots** | agent-browser, playwriter, browserbase | Medium | Medium -- overlay element labels on screenshot |
| **Device emulation presets** | @playwright/mcp (--device), mcp-playwright (143 presets), agent-browser | Medium | Low -- Playwright has built-in device descriptors |
| **Clipboard access** | agent-browser | Low | Low -- page.evaluate with clipboard API |
| **Anti-bot stealth** | playwriter (real browser), browserbase (advanced stealth) | Low | High -- complex to implement well |
| **Cloud execution** | browserbase | Low | N/A -- different architecture |
| **Codegen / code generation** | @playwright/mcp | Low | Medium |
| **SSE/HTTP transport** | @playwright/mcp, mcp-playwright | Medium | Medium -- useful for remote/VS Code |
| **Config introspection tool** | @playwright/mcp (browser_get_config) | Low | Low |

### 3. Parity features -- things most tools do equally well

These are commodity features where playwright-pool is on par with the ecosystem:

- Basic navigation (navigate, back)
- Click, type, fill, hover interactions
- Keyboard input and shortcuts
- File upload
- Dialog handling
- Tab management
- Viewport resize
- JavaScript evaluation
- Screenshot capture (inline + file)
- Accessibility snapshot
- Console message inspection
- Network request inspection
- PDF generation
- Tracing
- Locator generation
- Element/text/value verification

### 4. Recommended improvements -- prioritized by competitive impact

#### Tier 1: High Impact, Low Effort (ship this week)

1. **Add 15 dedicated storage tools** (cookie get/set/list/delete/clear, localStorage get/set/list/delete/clear, sessionStorage get/set/list/delete/clear) -- @playwright/mcp has these and they are frequently used. Currently requires browser_evaluate workarounds.

2. **Add storage state save/restore** (browser_storage_state, browser_set_storage_state) -- Two tools, high utility for auth workflows.

3. **Add device emulation presets** -- Playwright has `playwright.devices` built in. Add a `--device` flag to pool_launch and a device list command.

4. **Add mouse_wheel, mouse_down, mouse_up** -- Three small tools, fills the gap vs @playwright/mcp.

#### Tier 2: High Impact, Medium Effort (ship this month)

5. **Add network mocking tools** (browser_route, browser_unroute, browser_route_list, browser_network_state_set) -- Four tools, enables testing with mocked API responses.

6. **Add annotated screenshots** -- Overlay numbered element labels on screenshots like agent-browser's `--annotate`. High visibility feature for marketing.

7. **Add Firefox/WebKit support** -- Even if Chromium remains default, supporting all three browsers is a significant competitive advantage in marketing materials.

8. **Add SSE/HTTP transport** -- Enables remote usage and VS Code integration.

#### Tier 3: Nice to Have

9. **Video recording** (browser_start_video, browser_stop_video)
10. **HAR recording** (browser_har_start, browser_har_stop)
11. **Clipboard tools** (browser_clipboard_read, browser_clipboard_write)
12. **Config introspection** (browser_get_config)
13. **Codegen mode** for test generation

---

## Tool Count Summary

| Tool | MCP Tools | CLI Commands | Audit Tools | Total Capabilities |
|:-----|:---------:|:------------:|:-----------:|:------------------:|
| **playwright-pool** | 59 | 42 | 27 | **59 MCP + 42 CLI** |
| **@playwright/mcp** | ~47 (all caps enabled) | 0 | 0 | **~47** |
| **agent-browser** | 0 | 50+ | 0 | **50+ CLI** |
| **browser-pool-mcp** | ~20 | 0 | 0 | **~20** |
| **playwriter** | 1 (execute) | ~5 | 0 | **~6** |
| **browserbase** | ~5-8 | 0 | 0 | **~5-8** |
| **mcp-playwright** | ~6-10 | 0 | 0 | **~6-10** |

---

## Positioning Summary

**playwright-pool occupies a unique niche**: it is the only MCP browser server that combines browser pooling, authentication sharing, and built-in UI auditing. The 27 audit tools represent a capability category that simply does not exist in any competitor.

The primary competitive threats are:
- **@playwright/mcp** for raw browser automation breadth (storage tools, network mocking, video, multi-browser)
- **agent-browser** for CLI power users and its massive GitHub presence (24.6k stars)
- **playwriter** for zero-friction auth (uses your existing browser)

The recommended strategy is: maintain the audit tool lead (it is uncontested), close the storage/network tool gaps vs @playwright/mcp (Tier 1+2 above), and publish to npm + MCP directories to gain visibility.
