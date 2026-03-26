# UI Audit: Blog Editor — Desktop & Mobile

## Desktop Screenshot

1. **Blog title (H1 field)** — Title text is clipped/truncated at the right edge — The full title "Ecommerce agency vs freelancer vs in-house: which is right for your brand in 2026?" appears to fit, but the input field offers no visible boundary or padding on the right side, making it unclear where the editable area ends. The field blends into the toolbar region with no distinct container border or background differentiation.

2. **Toolbar row (formatting icons)** — Toolbar icons are extremely small and tightly packed — The formatting buttons (bold, italic, underline, strikethrough, alignment, lists, link, image, embed, table, code, etc.) are approximately 16-18px icons with roughly 4-6px spacing between them. At desktop resolution this makes them hard to identify and click accurately. No grouping separators visually distinguish text formatting from structural elements.

3. **Editor content area** — No visible left/right margins or max-width constraint — The body text runs from roughly the left gutter all the way across the viewport. At 1280px+ desktop width, line lengths appear to exceed 100 characters, making the text difficult to read. Best practice is 60-80 characters per line (roughly 600-700px max-width for body copy).

4. **Status bar (bottom)** — Status bar text ("85.7%", word count, character count, "SEO 87%") is extremely small (~10-11px) and low-contrast gray on white — The information is barely legible. The SEO score in particular is isolated in the far bottom-right corner with no visual emphasis despite being an important metric.

5. **"Split" toggle in top nav** — The top navigation items ("Rich Text", "Markdown", "HTML", "Edit", "Preview", "Split") lack clear active-state differentiation — "Edit" appears to be the active tab but is only distinguished by a subtle underline or weight change. At a glance, it is hard to tell which mode is currently selected, especially between "Edit" and "Split" which sit close together.

## Mobile Screenshot

1. **Blog title (H1 field)** — Title is truncated with no indication of overflow — The title reads "Ecommerce agency vs freelancer vs in-ho" and is cut off at approximately 340px width. There is no ellipsis, no scroll indicator, and no way for the user to see the full title without tapping into the field. The truncation loses critical information.

2. **Toolbar row (formatting icons)** — Toolbar wraps to a second line but icons remain too small for touch targets — The formatting icons appear at roughly 24-28px size with tight spacing. Mobile touch targets should be at minimum 44x44px (Apple HIG) or 48x48px (Material Design). The toolbar also lacks horizontal scrolling, so it takes up approximately 80-90px of vertical space with two rows of small icons.

3. **Editor content area** — No paragraph spacing between body paragraphs — The text blocks flow together with no visible margin between paragraphs (0px gap or very minimal). The section starting "You've outgrown the founder-does-everything phase..." runs directly into subsequent paragraphs with only line breaks, not proper paragraph spacing. This makes the wall of text hard to scan on mobile.

4. **Top navigation bar** — "Rich Text" dropdown and nav items crowd the top bar — On mobile, the navigation shows "Rich Text" dropdown, "Edit", "Preview", a three-dot menu, and the "Update" button all in a single ~375px row. The items are approximately 12-14px text with minimal tap spacing (~8-10px gaps). The "Update" button with its dropdown chevron is the only properly sized touch target.

5. **Heading 2 selector** — The "Heading 2" dropdown sits on its own row below the nav, wasting vertical space — It occupies roughly 30-35px of vertical height as a standalone row, pushing the actual content further down. On a mobile screen where vertical real estate is precious, this selector could be integrated into the toolbar row or collapsed behind a menu.

## Overall Assessment

This blog editor is functional and content-readable, but suffers from insufficient touch target sizing on mobile, poor paragraph spacing in the editor body, a truncated title field on mobile with no overflow indication, and overly dense toolbar icons on both viewports -- collectively these issues degrade usability without making the editor unusable.
