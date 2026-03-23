# Playwright Pool — Tool Roadmap

## Current Tools (v2.0.0 — Shipped)

Pool management tools that handle dynamic browser scaling and session isolation.

| Tool | Description |
|------|-------------|
| `pool_launch` | Create a new browser window or tab with golden profile auth |
| `pool_navigate` | Navigate a browser context to a URL |
| `pool_screenshot` | Take a screenshot (inline or save to file, full page optional) |
| `pool_snapshot` | Get accessibility tree for element interaction |
| `pool_click` | Click an element via CSS or text selector |
| `pool_fill` | Fill a form field |
| `pool_evaluate` | Run JavaScript in page context, return result |
| `pool_resize` | Resize viewport dimensions |
| `pool_list` | List all active browser contexts in this session |
| `pool_close` | Close a specific context or all contexts |

---

## Phase 1 — Core Browser Tools (from @playwright/mcp)

Essential browser automation tools matching the official Playwright MCP. These are the tools that every browser session needs.

### `browser_open`
Open a URL in a new page. Unlike `pool_navigate`, this creates a fresh page rather than navigating an existing one.
- **Params:** `url` (string)
- **Returns:** Page title and URL
- **Priority:** High

### `browser_navigate_back`
Go back to the previous page in browser history.
- **Params:** `id` (context ID)
- **Returns:** New page URL and title
- **Priority:** High

### `browser_press_key`
Press a single key or key combination on the keyboard. Essential for form submission (Enter), tabbing between fields (Tab), closing modals (Escape), and keyboard shortcuts (Ctrl+A, Ctrl+C).
- **Params:** `id` (context ID), `key` (string — e.g., "Enter", "Tab", "Escape", "Control+a")
- **Returns:** Confirmation
- **Priority:** High

### `browser_type`
Type text into the currently focused or specified editable element. Different from `pool_fill` — this simulates real keystrokes and triggers input events, which matters for search fields with autocomplete, chat inputs, and contenteditable elements.
- **Params:** `id` (context ID), `selector` (string, optional), `text` (string)
- **Returns:** Confirmation
- **Priority:** High

### `browser_hover`
Hover over an element to trigger hover states, tooltips, dropdown menus, and other hover-dependent UI. Essential for auditing interactive states.
- **Params:** `id` (context ID), `selector` (string)
- **Returns:** Confirmation
- **Priority:** High

### `browser_wait_for`
Wait for a specific condition before proceeding — text to appear/disappear, an element to become visible, or a fixed amount of time. Prevents race conditions when pages load dynamically.
- **Params:** `id` (context ID), `text` (string, optional), `selector` (string, optional), `timeout` (number, optional), `state` (visible/hidden/attached/detached)
- **Returns:** Whether the condition was met
- **Priority:** High

### `browser_tabs`
List all open tabs, create a new tab, close a tab, or switch to a different tab. Needed for workflows where links open in new tabs.
- **Params:** `id` (context ID), `action` (list/create/close/select), `tabIndex` (number, optional)
- **Returns:** Tab list or confirmation
- **Priority:** High

### `browser_run_code`
Execute an arbitrary Playwright code snippet in the context. The escape hatch for anything the dedicated tools don't cover — complex multi-step flows, custom assertions, advanced selectors.
- **Params:** `id` (context ID), `code` (string — Playwright JavaScript)
- **Returns:** Code execution result
- **Priority:** High

---

## Phase 2 — Extended Interaction Tools

Tools for more complex browser interactions beyond basic click/fill.

### `browser_select_option`
Select an option from a `<select>` dropdown by value, label, or index.
- **Params:** `id` (context ID), `selector` (string), `value` (string or string[])
- **Returns:** Selected option(s)
- **Priority:** Medium

### `browser_press_sequentially`
Type text one character at a time with delays between keystrokes. Simulates real human typing speed, important for inputs that react to each keystroke (search autocomplete, real-time validation).
- **Params:** `id` (context ID), `text` (string), `delay` (number, optional — ms between keys)
- **Returns:** Confirmation
- **Priority:** Medium

### `browser_handle_dialog`
Accept or dismiss JavaScript dialogs (alert, confirm, prompt). Without this tool, dialogs block all other interactions on the page.
- **Params:** `id` (context ID), `action` (accept/dismiss), `promptText` (string, optional)
- **Returns:** Dialog message text
- **Priority:** Medium

### `browser_file_upload`
Upload one or more files to a file input element. Required for testing file upload flows, profile photo uploads, document submissions.
- **Params:** `id` (context ID), `selector` (string), `files` (string[] — file paths)
- **Returns:** Confirmation
- **Priority:** Medium

### `browser_drag`
Drag an element and drop it on another element. For drag-and-drop interfaces, sortable lists, kanban boards.
- **Params:** `id` (context ID), `sourceSelector` (string), `targetSelector` (string)
- **Returns:** Confirmation
- **Priority:** Low

### `browser_mouse_move_xy`
Move the mouse cursor to exact x,y coordinates on the page. For canvas interactions, map widgets, custom UI that doesn't use standard HTML elements.
- **Params:** `id` (context ID), `x` (number), `y` (number)
- **Returns:** Confirmation
- **Priority:** Low

### `browser_mouse_click_xy`
Click at exact x,y coordinates. For clicking on canvas elements, SVG regions, or positions within images/maps.
- **Params:** `id` (context ID), `x` (number), `y` (number), `button` (left/right/middle)
- **Returns:** Confirmation
- **Priority:** Low

### `browser_mouse_drag_xy`
Drag from current mouse position to x,y coordinates. For slider controls, drawing on canvas, resizing panels.
- **Params:** `id` (context ID), `x` (number), `y` (number)
- **Returns:** Confirmation
- **Priority:** Low

---

## Phase 3 — Inspection & Debugging Tools

Tools for understanding what's happening on the page — network, console, selectors.

### `browser_console_messages`
Return all console messages (log, warn, error, info) captured since the page loaded. Essential for catching JavaScript errors during audits.
- **Params:** `id` (context ID), `level` (string, optional — "error", "warn", "log", "all")
- **Returns:** Array of console messages with level, text, and timestamp
- **Priority:** Medium

### `browser_network_requests`
Return all network requests made since the page loaded — URLs, methods, status codes, sizes, timing. Catches failed API calls, slow requests, missing resources, CORS errors.
- **Params:** `id` (context ID), `filter` (string, optional — URL pattern)
- **Returns:** Array of requests with url, method, status, size, duration
- **Priority:** Medium

### `browser_generate_locator`
Generate the best CSS/XPath selector for an element described in natural language. Helps when you need a precise selector but don't know the page structure.
- **Params:** `id` (context ID), `description` (string — e.g., "the blue submit button at the bottom")
- **Returns:** CSS selector string
- **Priority:** Low

### `browser_verify_element_visible`
Assert that a specific element is visible on the page. Returns pass/fail with details.
- **Params:** `id` (context ID), `selector` (string)
- **Returns:** Boolean result with element details
- **Priority:** Medium

### `browser_verify_text_visible`
Assert that specific text content is visible on the page.
- **Params:** `id` (context ID), `text` (string)
- **Returns:** Boolean result with location
- **Priority:** Medium

### `browser_verify_list_visible`
Assert that a list of items is visible on the page in expected order.
- **Params:** `id` (context ID), `items` (string[])
- **Returns:** Boolean result with matches
- **Priority:** Low

### `browser_verify_value`
Assert that a form input has a specific value.
- **Params:** `id` (context ID), `selector` (string), `expected` (string)
- **Returns:** Boolean result with actual value
- **Priority:** Low

---

## Phase 4 — Advanced & Export Tools

Specialized tools for export, tracing, and browser management.

### `browser_pdf_save`
Save the current page as a PDF file. Useful for generating reports, archiving page states, print layout testing.
- **Params:** `id` (context ID), `path` (string), `format` (A4/Letter/Legal, optional), `landscape` (boolean)
- **Returns:** File path of saved PDF
- **Priority:** Low

### `browser_start_tracing`
Start recording a Playwright trace — captures screenshots, DOM snapshots, network activity, and console logs over time. Used for performance debugging.
- **Params:** `id` (context ID)
- **Returns:** Confirmation
- **Priority:** Low

### `browser_stop_tracing`
Stop trace recording and save the trace file. Can be viewed in Playwright's trace viewer.
- **Params:** `id` (context ID), `path` (string)
- **Returns:** File path of trace
- **Priority:** Low

### `browser_install`
Install the Chromium browser binary if not already present. Fallback for environments where Playwright browsers weren't pre-installed.
- **Params:** none
- **Returns:** Installation status
- **Priority:** Low

---

## Phase 5 — UI Audit Tools (Unique to Playwright Pool)

Purpose-built tools for UI auditing workflows. These don't exist in any other MCP server — they're what differentiates Playwright Pool from a generic browser automation tool.

### `audit_accessibility`
Run axe-core accessibility engine on the current page. Returns WCAG 2.1 violations grouped by severity (critical, serious, moderate, minor) with element selectors, violation descriptions, and fix suggestions.
- **Params:** `id` (context ID), `standard` (WCAG2A/WCAG2AA/WCAG2AAA, default AA), `scope` (string, optional — CSS selector to limit audit scope)
- **Returns:** Violation count by severity, detailed violation list with selectors and fix guidance
- **Use case:** Run before every deploy to catch accessibility regressions

### `audit_color_contrast`
Check text/background color contrast ratios across the page against WCAG standards. Identifies every text element that fails contrast requirements, reports the actual ratio vs. required ratio, and shows the exact colors.
- **Params:** `id` (context ID), `level` (AA/AAA, default AA)
- **Returns:** Pass/fail count, list of failing elements with their colors, ratios, and required minimums
- **Use case:** Verify readability across light/dark themes

### `audit_breakpoints`
One command to screenshot the page at multiple viewport sizes. Automatically resizes the viewport, waits for layout to settle, and captures each breakpoint. Eliminates the repetitive resize-screenshot-resize cycle.
- **Params:** `id` (context ID), `url` (string, optional — navigate first), `breakpoints` (array, optional — defaults to [{w:1280,h:800,name:"desktop"}, {w:768,h:1024,name:"tablet"}, {w:375,h:812,name:"mobile"}]), `savePath` (string, optional — directory to save screenshots)
- **Returns:** Array of screenshots (inline or saved to files) with breakpoint labels
- **Use case:** Responsive design verification in one call

### `audit_tap_targets`
Check that all interactive elements (buttons, links, inputs) meet minimum touch target size guidelines (48x48px per WCAG 2.5.5 / Google's mobile UX guidelines). Reports undersized targets with their actual dimensions and locations.
- **Params:** `id` (context ID), `minSize` (number, default 48 — minimum px)
- **Returns:** Pass/fail count, list of undersized elements with actual dimensions and selectors
- **Use case:** Mobile usability verification

### `audit_core_web_vitals`
Measure Core Web Vitals — Largest Contentful Paint (LCP), Cumulative Layout Shift (CLS), and First Input Delay (FID) / Interaction to Next Paint (INP). Reports scores with pass/needs-improvement/fail ratings per Google's thresholds.
- **Params:** `id` (context ID), `url` (string, optional — navigate and measure from scratch)
- **Returns:** LCP (seconds), CLS (score), INP (ms), overall rating, individual ratings
- **Use case:** Performance baseline before/after changes

### `audit_image_sizes`
Audit every image on the page — check for missing alt text, oversized images (rendered size vs. natural size), images served in legacy formats (JPEG/PNG when WebP/AVIF would be better), broken image URLs, and lazy-loading attributes.
- **Params:** `id` (context ID)
- **Returns:** Total image count, issues by category (missing alt, oversized, wrong format, broken, not lazy-loaded)
- **Use case:** Image optimization and accessibility sweep

### `audit_fonts`
List every font loaded on the page — font families, weights, sizes, line heights, and whether they're system fonts, Google Fonts, or custom. Flags inconsistencies (e.g., 7 different font sizes when your design system uses 5).
- **Params:** `id` (context ID)
- **Returns:** Font family list with sources, unique size/weight/line-height combinations, consistency score
- **Use case:** Typography audit, design system compliance

### `audit_computed_styles`
Get the full computed CSS for any element — all resolved property values after cascade, inheritance, and specificity. More detailed than the accessibility snapshot, which only shows semantic info.
- **Params:** `id` (context ID), `selector` (string), `properties` (string[], optional — filter to specific properties like ["color", "font-size", "padding"])
- **Returns:** Map of property → computed value
- **Use case:** Debugging why an element looks wrong, verifying design token usage

### `audit_overflow`
Detect horizontal overflow (content wider than viewport) at each breakpoint. Scrolls the page, checks for elements that extend beyond the viewport, and identifies the offending elements with their widths.
- **Params:** `id` (context ID), `breakpoints` (array, optional — viewports to check)
- **Returns:** Per-breakpoint results: has overflow (boolean), offending elements with selectors and widths
- **Use case:** Catch mobile layout breaks before users see them

### `audit_dark_mode`
Toggle between light and dark color schemes using `prefers-color-scheme` media query emulation. Takes screenshots in both modes. Optionally compares them to flag elements that don't change (potential missing dark mode styles).
- **Params:** `id` (context ID), `savePath` (string, optional)
- **Returns:** Light screenshot, dark screenshot, list of elements with unchanged colors (potential issues)
- **Use case:** Dark mode completeness check

### `audit_meta`
Audit SEO and social sharing metadata — title, description, canonical URL, Open Graph tags, Twitter Card tags, heading hierarchy (h1-h6 order and count), lang attribute, viewport meta, robots directives.
- **Params:** `id` (context ID)
- **Returns:** Structured report of all meta tags with pass/fail flags for common issues (missing description, multiple h1s, no OG image, etc.)
- **Use case:** SEO readiness check before launch

### `audit_diff`
Visual diff between two screenshots. Highlights pixel differences and reports the percentage of changed area. Can compare before/after states, two breakpoints, or light/dark mode.
- **Params:** `screenshotA` (string — path or base64), `screenshotB` (string — path or base64), `threshold` (number, optional — % change to flag, default 1%)
- **Returns:** Diff image (highlighted changes), changed pixel percentage, bounding boxes of changed regions
- **Use case:** Regression detection after code changes

### `audit_focus_order`
Programmatically Tab through every focusable element on the page, recording the order. Reports the full focus sequence with element types, labels, and whether each has a visible focus indicator. Flags elements that are focusable but have no visible focus style.
- **Params:** `id` (context ID), `maxElements` (number, optional — default 100)
- **Returns:** Ordered list of focused elements with type, label, has-visible-focus-style boolean
- **Use case:** Keyboard navigation audit, WCAG 2.4.7 compliance

### `audit_interactive_states`
For every button, link, and input on the page (or a filtered set), automatically capture hover, focus, active, and disabled states. Takes a screenshot of each state for visual comparison.
- **Params:** `id` (context ID), `selector` (string, optional — limit to specific elements), `states` (string[], optional — default ["hover", "focus", "active"]), `savePath` (string, optional)
- **Returns:** Per-element state screenshots, count of elements missing hover/focus styles
- **Use case:** Interactive state completeness audit

### `audit_spacing_consistency`
Extract all margin and padding values used on the page. Groups them into a frequency table and flags values that don't match the most common spacing scale (e.g., if your design uses 4/8/16/24/32/48 but one element has 13px padding).
- **Params:** `id` (context ID), `scale` (number[], optional — expected spacing scale like [4, 8, 12, 16, 24, 32, 48])
- **Returns:** Spacing value frequency table, outlier list with selectors and actual values
- **Use case:** Design system spacing compliance

### `audit_z_index_map`
Map every element with a z-index value across the page. Shows the stacking order, identifies potential z-index conflicts (overlapping elements with competing z-index values), and flags absurdly high values (z-index: 99999).
- **Params:** `id` (context ID)
- **Returns:** Sorted z-index list with element selectors, overlap warnings, unreasonable value warnings
- **Use case:** Debug overlapping elements, z-index debt cleanup

### `audit_broken_links`
Crawl every `<a>` href and `<img>` src on the page. Check each for HTTP status (200, 404, 500, etc.), empty hrefs, javascript:void(0), dead anchor links (#id that doesn't exist), and mixed HTTP/HTTPS content.
- **Params:** `id` (context ID), `checkExternal` (boolean, optional — default false, only check same-origin), `timeout` (number, optional — ms per request)
- **Returns:** Total link count, broken link list with URL, status code, and element selector
- **Use case:** Pre-launch link validation

### `audit_loading_states`
Throttle the network to simulate slow connections (3G, slow 4G) and capture screenshots at timed intervals (0s, 1s, 3s, 5s, 10s). Shows loading skeletons, spinners, progressive rendering, and layout shifts during load.
- **Params:** `id` (context ID), `url` (string), `network` (string — "3G"/"slow4G"/"fast4G"), `captureAt` (number[], optional — seconds, default [0, 1, 3, 5]), `savePath` (string, optional)
- **Returns:** Timed screenshots, layout shift events detected during load
- **Use case:** Loading UX quality check

### `audit_form_validation`
Submit a form in three states: empty (trigger required field validation), with invalid data (trigger format validation), and with valid data (verify success path). Captures screenshots and error messages at each state.
- **Params:** `id` (context ID), `formSelector` (string), `invalidData` (object, optional — field:value pairs), `validData` (object, optional — field:value pairs)
- **Returns:** Per-state screenshots, error messages captured, fields missing validation
- **Use case:** Form UX completeness audit

### `audit_print_layout`
Emulate print media and capture what the page looks like when printed. Checks for hidden navigation, broken layouts, background colors/images that don't print, and page break issues.
- **Params:** `id` (context ID), `savePath` (string, optional)
- **Returns:** Print-mode screenshot, list of elements hidden in print, list of elements with background-color that won't print by default
- **Use case:** Print stylesheet verification

### `audit_scroll_behavior`
Scroll the page in increments and audit scroll-related behavior — sticky elements (do they stay stuck?), parallax effects, infinite scroll triggers, scroll snap points, and layout shifts during scroll.
- **Params:** `id` (context ID), `scrollDistance` (number, optional — pixels per step, default 500), `steps` (number, optional — default 10)
- **Returns:** Per-step screenshots, sticky element status, layout shift events, scroll-triggered content loads
- **Use case:** Scroll UX verification

### `audit_element_overlap`
At the current viewport size (or multiple breakpoints), detect any elements that visually overlap when they shouldn't. Checks for text overlapping text, buttons hidden under headers, absolutely positioned elements breaking out of their containers, and fixed elements covering content.
- **Params:** `id` (context ID), `breakpoints` (array, optional)
- **Returns:** List of overlapping element pairs with their bounding boxes, overlap area, and selectors
- **Use case:** Layout collision detection across responsive breakpoints

---

## Summary

| Phase | Tools | Status |
|-------|-------|--------|
| Current (v2.0.0) | 10 pool management tools | Shipped |
| Phase 1 — Core Browser | 8 essential interaction tools | Planned |
| Phase 2 — Extended Interaction | 8 advanced interaction tools | Planned |
| Phase 3 — Inspection & Debugging | 7 inspection/verification tools | Planned |
| Phase 4 — Advanced & Export | 4 specialized tools | Planned |
| Phase 5 — UI Audit Tools | 22 audit-specific tools | Planned |
| **Total** | **59 tools** | |

## Competitive Positioning

### What exists today (competitors)

| Project | Stars | Browser Pooling | Auth Sharing | Dynamic Scaling | Audit Tools |
|---------|-------|----------------|--------------|-----------------|-------------|
| @playwright/mcp (official) | 29.5k | No | No | No | No |
| browser-pool-mcp | 0 | Yes (proxy) | No | Yes | No |
| mcp-playwright | 5.3k | No | No | No | No |
| browserbase | 3.2k | Cloud | No | Cloud | No |
| playwriter | 3.2k | No | Real browser | No | No |

### What Playwright Pool delivers

| Feature | Playwright Pool | Everyone Else |
|---------|----------------|---------------|
| Dynamic browser pooling | One MCP entry, unlimited instances | N entries for N instances (or cloud) |
| Golden profile auth | Log in once, clone to all instances | Log in per instance or no auth |
| Cross-session isolation | UUID-based, zero conflicts | Sessions fight over shared state |
| Window + tab modes | Both, per-context choice | Usually one or the other |
| UI audit toolkit | 22 purpose-built audit tools | None — raw browser tools only |
| Responsive audit | One command, all breakpoints | Manual resize-screenshot loops |
| Accessibility audit | Built-in axe-core integration | Bring your own |
| Visual regression | Built-in diff tool | External tooling required |
