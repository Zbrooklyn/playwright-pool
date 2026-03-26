# QA Triage Report — Blog Editor UI

**Date**: 2026-03-26
**Screenshots analyzed**: Desktop (1280px) and Mobile (375px)
**Application**: Blog post editor (Rich Text mode)

---

## Critical Issues (P0)

**No Critical issues found.** The editor is functional, content renders correctly, text is readable, and no elements overlap to the point of making interaction impossible.

---

## Serious Issues (P1)

### 1. Mobile: Blog post title is truncated, losing meaning

- **What**: The H1 title "Ecommerce agency vs freelancer vs in-house: which is right for your brand in 2026?" is cut off on mobile, displaying only "Ecommerce agency vs freelancer vs in-ho" with no way to see the full title without tapping into the field.
- **Where**: Top of the mobile view, directly below the toolbar row.
- **Impact**: All mobile users. The truncation cuts the title mid-word ("in-ho" instead of "in-house"), making it unclear what the article is actually comparing. Authors reviewing or editing cannot confirm the title is correct without interacting with the field.
- **Suggested Fix**: Allow the title field to wrap to multiple lines on mobile viewports instead of enforcing a single-line display with overflow hidden.

### 2. Desktop: Editor mode tabs (Rich Text, Markdown, HTML, Edit, Preview, Split) have low visual distinction for active state

- **What**: The top navigation tabs for editor modes are all rendered in a similar light gray text style; the active tab ("Edit") is only distinguished by a subtle underline, making it difficult to quickly identify which mode and sub-mode are currently active.
- **Where**: Top-center of the desktop view, in the horizontal tab bar.
- **Impact**: All desktop users. Users switching between modes (Rich Text vs Markdown vs HTML) or sub-modes (Edit vs Preview vs Split) may not immediately recognize their current state, leading to confusion when the editor behavior doesn't match expectations.
- **Suggested Fix**: Increase the visual weight of the active tab — use a bolder font weight, a filled background, or a higher-contrast color to clearly differentiate the selected mode from inactive options.

### 3. Mobile: Formatting toolbar icons are small and closely spaced

- **What**: The second row of formatting controls (Bold, Italic, Underline, Strikethrough, text color, and additional icons) are rendered at a size and spacing that makes precise tap targeting difficult on mobile.
- **Where**: Second row below the "Heading 2" dropdown on mobile, containing B/I/U/S and icon buttons.
- **Impact**: All mobile users. The buttons appear to be below or near the minimum recommended 44x44px tap target size, increasing the risk of mis-taps, especially for users with larger fingers or motor impairments.
- **Suggested Fix**: Increase the tap target size of toolbar icons to at least 44x44px and add adequate spacing (at least 8px) between adjacent interactive elements on mobile viewports.

---

## Release Recommendation: **RELEASE WITH KNOWN ISSUES**

**Rationale**: No critical functionality is broken. The editor loads, content is fully readable and editable on both desktop and mobile. The three serious issues identified are usability concerns — the truncated title on mobile is the most impactful as it hides content from the user. These should be fixed this sprint but do not block a release, provided they are documented as known issues in release notes.
