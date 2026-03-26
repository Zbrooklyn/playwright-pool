# Adversarial QA Audit: Blog Editor UI

## Desktop Screenshot Bugs

### Bug 1
- **Element**: Blog post title / H1 heading
- **Bug**: The title "Ecommerce agency vs freelancer vs in-house: which is right for your brand in 2026?" appears to be in a plain input field with no visible border or boundary indication. It is difficult to distinguish the editable title area from the surrounding UI. There is no clear affordance that this is an editable field versus static display text.
- **Severity**: Minor
- **Evidence**: The title text sits between the toolbar and the body content with no visible input border, background differentiation, or focus indicator.

### Bug 2
- **Element**: Bottom status bar, right side -- "SEO 67%" indicator
- **Bug**: The SEO score text is partially cut off or extremely small and hard to read at the bottom-right corner of the viewport. It appears cramped against the edge.
- **Severity**: Minor
- **Evidence**: The "SEO 67%" text at the bottom right is rendered in small, low-contrast text that blends with the footer bar. It is barely legible in the screenshot.

### Bug 3
- **Element**: Comparison table at the bottom of the content area
- **Bug**: The table row starting with "Factor Agency Freelancer In-house" and "Monthly cost range $2,000 - $15,000+ $500 - $5,000 (project-" is truncated horizontally. The table content is cut off and the last cell's text ends with "(project-" indicating horizontal overflow is hiding content without any scroll indicator or visual cue.
- **Severity**: Major
- **Evidence**: The visible table row clearly cuts off mid-word at "(project-" with no horizontal scrollbar, ellipsis, or other indication that more content exists to the right.

### Bug 4
- **Element**: Toolbar formatting options (top bar with Rich Text, Markdown, HTML, Edit, Preview, Split tabs)
- **Bug**: The "Split" tab text appears slightly clipped or has inconsistent spacing compared to the other tabs (Rich Text, Markdown, HTML, Edit, Preview). The tab labels have uneven visual weight.
- **Severity**: Minor
- **Evidence**: Comparing the tab items in the top navigation, "Split" appears slightly different in spacing/padding than its siblings.

### Bug 5
- **Element**: Editor content area vertical spacing
- **Bug**: The body text paragraphs under each section heading (e.g., under "Ecommerce agency", "Freelancer", "In-house hire") have no visible paragraph spacing or line breaks between them. The content runs together in dense blocks making it hard to distinguish where one paragraph ends and the next begins.
- **Severity**: Minor
- **Evidence**: The text under "Freelancer" and "In-house hire" subheadings runs continuously without clear paragraph breaks, appearing as a wall of text despite containing distinct conceptual paragraphs.

---

## Mobile Screenshot Bugs

### Bug 6
- **Element**: Blog post title
- **Bug**: The title is truncated. It reads "Ecommerce agency vs freelancer vs in-ho" and cuts off. The full title ("...in-house: which is right for your brand in 2026?") is not visible and there is no indication that more text exists (no ellipsis, no wrapping).
- **Severity**: Major
- **Evidence**: The title clearly ends at "in-ho" with the remaining text invisible. On mobile, the title field does not wrap to multiple lines or provide any way to see the full title.

### Bug 7
- **Element**: Formatting toolbar (B, I, U, S, A, and icon buttons)
- **Bug**: The toolbar shows only a subset of the formatting options visible on desktop. Several toolbar buttons present on desktop (lists, links, images, alignment, code blocks, etc.) are missing on mobile with no overflow menu, "more" button, or horizontal scroll indicator to access them.
- **Severity**: Major
- **Evidence**: Desktop shows approximately 15+ toolbar buttons. Mobile shows only 6 (B, I, U, S, A, and one icon). The remaining options are completely absent with no way to access them.

### Bug 8
- **Element**: "Heading 2" dropdown selector
- **Bug**: The heading level dropdown appears as plain text "Heading 2" with a small caret. It is visually indistinct and could be mistaken for a label rather than an interactive dropdown control.
- **Severity**: Minor
- **Evidence**: The "Heading 2" text with tiny caret has no button-like styling (no border, no background) making it look like static text rather than a clickable selector.

### Bug 9
- **Element**: Mode tabs (Rich Text dropdown, Edit, Preview)
- **Bug**: The "Markdown" and "HTML" mode tabs visible on desktop are hidden on mobile behind the "Rich Text" dropdown. However, the "Split" view mode that exists on desktop is completely absent on mobile -- there is no way to access split view.
- **Severity**: Minor
- **Evidence**: Desktop shows "Rich Text | Markdown | HTML | Edit | Preview | Split" tabs. Mobile shows only "Rich Text (dropdown) | Edit | Preview" with no Split option anywhere visible.

### Bug 10
- **Element**: Three-dot overflow menu (vertical ellipsis)
- **Bug**: A three-dot menu icon appears between "Preview" and the "Update" button on mobile. Its purpose is unclear and it has no label or tooltip. It is very small and close to other tap targets.
- **Severity**: Minor
- **Evidence**: The ":" (three dots) icon sits between "Preview" and "Update" with minimal spacing, making it a small tap target that could easily result in accidental taps on adjacent elements.

### Bug 11
- **Element**: Content area bottom -- text cutoff
- **Bug**: The content at the bottom of the mobile view is cut off mid-sentence. The last visible line reads "touching your account) who handle multiple" and then abruptly ends at the status bar. There is no visual indication that the user can scroll for more content (no scroll shadow, fade, or partial line visible).
- **Severity**: Minor
- **Evidence**: The text ends cleanly at the status bar boundary with the sentence clearly incomplete, but no scroll affordance is visible.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Major    | 3 |
| Minor    | 8 |
| **Total**| **11**|

The most significant issues are the **truncated title on mobile** (Bug 6), the **missing toolbar buttons on mobile with no overflow access** (Bug 7), and the **table content cut off on desktop** (Bug 3). These degrade the editing experience meaningfully -- a user cannot read their own title on mobile, cannot access formatting tools, and cannot see full table content on desktop.
