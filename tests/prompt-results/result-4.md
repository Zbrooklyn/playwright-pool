# Accessibility Audit: Blog Editor UI (WCAG 2.1 AA)

**Screenshots analyzed:**
- Desktop: `blog-editor-audit/desktop.png` (approx. 1280px wide)
- Mobile: `blog-editor-audit/mobile.png` (approx. 375px wide)

---

## Color Contrast (WCAG 1.4.3, 1.4.6)

### Issues Found

1. **Toolbar text labels ("Rich Text", "Markdown", "HTML", "Edit", "Preview", "Split") — estimated ~3.5:1 contrast**
   - **Criterion violated:** WCAG 1.4.3 (Contrast Minimum)
   - These navigation/mode labels appear as medium-gray text on a white/very light gray background. The estimated contrast ratio falls below the 4.5:1 minimum for normal-size text.
   - **Fix:** Darken the text color to at least `#595959` (or darker) to achieve 4.5:1 against the white background.

2. **"Heading 2" dropdown label and formatting toolbar icon labels — estimated ~3.8:1**
   - **Criterion violated:** WCAG 1.4.3
   - The light gray text for the heading-level selector appears below the 4.5:1 threshold.
   - **Fix:** Use a darker gray (`#545454` or darker) for these controls.

3. **Status bar text (bottom bar: "85.7%", "1716 words", "11,852 chars", "SEO 63%") — estimated ~3.2:1**
   - **Criterion violated:** WCAG 1.4.3
   - Small gray text on a white/light background in the footer status bar. This is small text (likely 12-13px), requiring the full 4.5:1 ratio.
   - **Fix:** Darken status bar text to at least `#595959` or increase font size to 18px+ (making 3:1 sufficient for large text).

4. **"SEO 63%" indicator — color alone communicates score quality**
   - **Criterion violated:** WCAG 1.4.1 (Use of Color)
   - The SEO percentage likely uses color coding (green/yellow/red) to indicate quality, but the number alone does not communicate whether 63% is good, acceptable, or poor without color context.
   - **Fix:** Add a textual label (e.g., "Fair") or an icon alongside the percentage.

### Passing

- **Body text** (article content): Black or very dark gray text on white. Estimated contrast ~12:1 or higher. Passes both AA and AAA.
- **Heading text** ("Every growing brand hits this decision point"): Dark black, large text. Well above 4.5:1. Passes.
- **"Update" button**: White text on a blue/purple button. Estimated ~5:1+. Passes for the button text size.

---

## Touch/Click Targets (WCAG 2.5.5, 2.5.8)

### Issues Found

5. **Formatting toolbar icons (B, I, U, S, etc.) on desktop — estimated ~28x28px**
   - **Criterion violated:** WCAG 2.5.5 (Target Size)
   - The individual formatting buttons (bold, italic, underline, strikethrough, alignment, lists, etc.) appear to be significantly smaller than the recommended 44x44px minimum.
   - **Desktop impact:** Lower severity since mouse precision is higher, but still a compliance gap.
   - **Fix:** Increase touch/click target padding to at least 44x44px, even if the visible icon remains smaller.

6. **Mobile: Formatting toolbar icons are larger but still appear borderline (~36x40px)**
   - **Criterion violated:** WCAG 2.5.5
   - On mobile the toolbar icons are rendered larger than desktop, but several still appear to fall short of 44x44px.
   - **Fix:** Add padding to ensure each icon's tappable area is at least 44x44px.

7. **"Close" (X) button and pencil icon (top-left, desktop) — estimated ~24x24px**
   - **Criterion violated:** WCAG 2.5.5
   - These small icon buttons in the top toolbar are well below the 44px minimum.
   - **Fix:** Increase the clickable area with padding while keeping the visual icon compact.

8. **Mobile: Back arrow "<" button (top-left) — estimated ~32x32px**
   - **Criterion violated:** WCAG 2.5.5
   - The back navigation arrow on mobile is undersized for reliable finger tapping.
   - **Fix:** Expand tappable region to 44x44px minimum.

9. **Spacing between toolbar items on desktop is tight — risk of mis-clicks**
   - **Criterion violated:** WCAG 2.5.8 (Target Size minimum, for closely spaced targets)
   - Multiple formatting icons are packed together with minimal spacing.
   - **Fix:** Add at least 8px gap between adjacent clickable targets, or increase target size to 44px.

---

## Text Readability (WCAG 1.4.4, 1.4.8, 1.4.12)

### Issues Found

10. **Desktop: Body text appears to be ~14-15px — below the 16px recommendation**
    - **Criterion violated:** WCAG 1.4.8 (Visual Presentation, AAA recommendation)
    - While 1.4.8 is AAA (not required for AA), the body text in the editor appears slightly small. This is a best-practice concern rather than a strict AA failure.
    - **Fix:** Increase body font size to 16px for improved readability.

11. **Desktop: Line spacing appears to be ~1.3x — slightly below the 1.5x recommendation**
    - **Criterion violated:** WCAG 1.4.8 (AAA), relevant advisory for AA
    - The body text line-height looks tighter than 1.5x the font size. Paragraphs appear dense.
    - **Fix:** Set `line-height: 1.5` or `1.6` on body text within the editor.

### Passing

- **Mobile:** Text size appears appropriate (~16px), and line spacing looks adequate. Text reflows correctly without horizontal scrollbar — no horizontal scrolling observed.
- **Text reflow (WCAG 1.4.10):** On mobile, the content reflows into a single column properly. No horizontal overflow detected.

---

## Visual Indicators (WCAG 1.4.1, 1.4.11)

### Issues Found

12. **Active tab indicator ("Edit" tab) uses only a color/underline distinction**
    - **Criterion violated:** WCAG 1.4.1 (Use of Color)
    - The currently active mode ("Edit" vs "Preview" vs "Split") appears to be indicated primarily by text color or a subtle underline. On desktop, the distinction between active and inactive tabs is minimal.
    - **Fix:** Add a visible underline bar, bold weight, or background fill to the active tab — not just color change.

13. **No visible focus indicators observed**
    - **Criterion violated:** WCAG 2.4.7 (Focus Visible)
    - Screenshots are static so focus state cannot be directly confirmed, but the UI does not show any obvious focus ring styling. If default browser focus outlines are suppressed via `outline: none` without a replacement, this is a violation.
    - **Fix:** Ensure all interactive elements show a clearly visible focus indicator (e.g., 2px solid outline in a contrasting color) when focused via keyboard.

14. **"Update" button dropdown chevron — state not conveyed beyond color**
    - **Criterion violated:** WCAG 1.4.11 (Non-text Contrast)
    - The small dropdown arrow next to the "Update" button is white on blue. While contrast may be sufficient, the chevron itself is very small and may fall below the 3:1 contrast requirement for its hit area border/boundary.
    - **Fix:** Ensure the dropdown separator line between "Update" and the chevron has at least 3:1 contrast against the button background.

---

## Content Structure (WCAG 1.3.1, 2.4.6)

### Issues Found

15. **Mobile: Blog post title is truncated ("Ecommerce agency vs freelancer vs in-ho...")**
    - **Criterion violated:** WCAG 1.3.1 (Info and Relationships)
    - The title is cut off on mobile without any indication that it continues (no ellipsis tooltip or expand mechanism visible). Users cannot read the full title.
    - **Fix:** Allow the title to wrap to multiple lines on mobile, or provide a way to view the full title (e.g., tapping expands it).

### Passing

- **Heading hierarchy:** The content uses visible headings ("Every growing brand hits this decision point" as an H2-style heading, "What each option actually means" as another heading, sub-sections like "Ecommerce agency", "Freelancer", "In-house hire"). The hierarchy appears logical.
- **Reading order:** Content flows top-to-bottom in a logical sequence on both desktop and mobile.
- **Labels:** The "Heading 2" dropdown clearly labels the current heading level. Toolbar mode labels ("Rich Text", "Edit", etc.) are visible.

---

## General Layout and UI Issues (Non-Accessibility)

16. **Desktop: Content area appears to have no max-width constraint**
    - The body text spans the full width of the editor on desktop (roughly 900-1000px of text width). Optimal reading width is 45-75 characters per line. Lines appear to exceed 80+ characters.
    - **Fix:** Add `max-width: 700px` (or similar) to the content area with `margin: 0 auto`.

17. **Desktop: Bottom status bar is very subtle**
    - The "85.7% | 1716 words | 11,852 chars | SEO 63%" bar at the very bottom is easy to overlook. It is functional but low-prominence.
    - **Suggestion:** Consider slightly increasing font size or adding a subtle top border to make it more discoverable.

18. **Mobile: Status bar overlaps or crowds the bottom of the content**
    - The green checkmark, time, word count, and SEO score at the bottom of the mobile view are packed tightly. While functional, the information density is high for a small screen.
    - **Suggestion:** Consider collapsing some stats behind a tap-to-expand control on mobile.

---

## Summary of Violations by Priority

| Priority | Issue # | WCAG Criterion | Description |
|----------|---------|---------------|-------------|
| High | 1, 2, 3 | 1.4.3 | Insufficient text contrast on toolbar labels and status bar |
| High | 13 | 2.4.7 | Missing visible focus indicators (needs code verification) |
| High | 15 | 1.3.1 | Title truncation on mobile hides information |
| Medium | 5, 6, 7, 8 | 2.5.5 | Touch targets below 44x44px minimum |
| Medium | 9 | 2.5.8 | Insufficient spacing between toolbar targets |
| Medium | 12 | 1.4.1 | Active tab state conveyed primarily by color |
| Medium | 4 | 1.4.1 | SEO score uses color as sole quality indicator |
| Low | 14 | 1.4.11 | Dropdown chevron boundary contrast |
| Advisory | 10, 11 | 1.4.8 | Body text size and line spacing (AAA, not AA required) |

**Overall assessment:** The content area itself is well-structured and readable. The primary accessibility gaps are in the toolbar and chrome surrounding the editor — low-contrast labels, undersized touch targets, and potentially missing focus indicators. Fixing items 1-3, 5-8, and 13 would bring the UI substantially closer to WCAG 2.1 AA compliance.
