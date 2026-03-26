# Adversarial QA Audit — CloudStack Pricing Page (Subtle Hard Cases)

## Desktop (1280x800)

### Bug 1
- **Element**: Starter plan price — struck-through original price
- **Bug**: The original price text beneath `$9.99/mo` is too small and blurry to be legible. It appears as an illegible gray smudge rather than a readable crossed-out price. Users cannot confirm what discount they are getting.
- **Severity**: Minor
- **Evidence**: The struck-through text below `$9.99` is rendered at an extremely small font size with low contrast gray, making it unreadable even at full desktop resolution.

### Bug 2
- **Element**: Professional plan price — struck-through original price
- **Bug**: Same illegibility issue as the Starter plan. The crossed-out original price beneath `$29/mo` is too small to read.
- **Severity**: Minor
- **Evidence**: Gray struck-through text below the `$29` price is a tiny, unreadable smudge.

### Bug 3
- **Element**: Enterprise plan price — struck-through original price
- **Bug**: Same illegibility issue. The crossed-out original price beneath `$99/mo` cannot be read.
- **Severity**: Minor
- **Evidence**: Gray struck-through text below `$99` is indecipherable.

### Bug 4
- **Element**: Starter plan price — dollar sign and digits vertical alignment
- **Bug**: The dollar sign `$` and the digits `9.99` appear to have inconsistent vertical alignment. The dollar sign sits noticeably higher than the large numeral, creating a misaligned baseline. This is most visible on the Starter card where the superscript-style dollar sign floats above the number.
- **Severity**: Minor
- **Evidence**: On the Starter card, `$` is rendered smaller and elevated compared to the `9` digits, appearing more like a superscript than a properly aligned currency symbol. The Professional and Enterprise cards show the same pattern.

### Bug 5
- **Element**: Enterprise plan description text
- **Bug**: The description text "For organizations with advanced security and compliance needs." ends with a period followed by what appears to be a trailing period or extra punctuation artifact — "needs.." or irregular spacing after the period.
- **Severity**: Minor
- **Evidence**: The description text on the Enterprise card has an extra dot or unusual spacing after "needs." compared to the other card descriptions.

### Bug 6
- **Element**: Pricing card heights / vertical alignment
- **Bug**: The three pricing cards have different content lengths but appear to have equal heights, which leaves significant empty whitespace at the bottom of the Starter card (fewer features listed) before its CTA button. The CTA buttons are not vertically aligned across the three cards — "Get Started" on Starter sits much higher than "Get Started" on Professional and "Contact Sales" on Enterprise.
- **Severity**: Minor
- **Evidence**: The Starter card's "Get Started" button is positioned higher than the Professional card's button, and the Enterprise "Contact Sales" button is at a different vertical position than Professional's. The buttons do not form a horizontal line across cards.

### Bug 7
- **Element**: Footer copyright text
- **Bug**: The footer copyright text is extremely low contrast — very light gray on white background — making it nearly invisible and failing WCAG contrast requirements.
- **Severity**: Minor
- **Evidence**: The copyright line at the very bottom of the page is barely visible, significantly lighter than even the footer navigation links above it.

### Bug 8
- **Element**: "Save 20%" badge next to Annual toggle
- **Bug**: The "Save 20%" text uses a color (appears to be green or teal) that has relatively low contrast against the white background, reducing readability.
- **Severity**: Minor
- **Evidence**: The "Save 20%" label next to the Annual toggle is noticeably harder to read than surrounding text elements.

---

## Mobile (375x812)

### Bug 9
- **Element**: Navigation header links
- **Bug**: The navigation links (Product, Solutions, Pricing, Docs) are displayed as plain text in a cramped horizontal layout rather than collapsed into a hamburger menu. The text is very small and tightly packed.
- **Severity**: Major
- **Evidence**: All four nav items plus the logo are squeezed into the 375px-wide header. The links wrap to two rows ("Product Solutions" on one line, "Pricing Docs" on the next), creating a messy two-line navigation rather than using a mobile hamburger menu pattern.

### Bug 10
- **Element**: "Most Popular" badge on Professional card
- **Bug**: The "Most Popular" badge appears between the Starter and Professional cards rather than being clearly attached to the top of the Professional card. It floats in the gap between cards, creating visual ambiguity about which plan it belongs to.
- **Severity**: Minor
- **Evidence**: On mobile, the purple "Most Popular" pill badge sits in the space between the bottom of the Starter card and the top of the Professional card, visually disconnected from the Professional card header.

### Bug 11
- **Element**: Struck-through original prices on all three plan cards (mobile)
- **Bug**: Same as desktop — the crossed-out original prices are illegibly small on mobile, and even harder to read at the smaller mobile viewport.
- **Severity**: Minor
- **Evidence**: The gray struck-through price text under each plan's price is an unreadable smudge on mobile.

### Bug 12
- **Element**: Footer links on mobile
- **Bug**: The footer links (Terms, Documentation, Status, Privacy, Contact) are squeezed onto one line at a very small font size with tight spacing, making them difficult to tap on mobile. "Terms of Service" appears to wrap or truncate.
- **Severity**: Minor
- **Evidence**: The footer row shows all links crammed together at small size. "Terms of" appears on one line with "Service" potentially wrapping, and tap targets are too small and close together for comfortable mobile use.

### Bug 13
- **Element**: Copyright text on mobile
- **Bug**: Same ultra-low-contrast issue as desktop, even more problematic on mobile where screens may have lower brightness in outdoor use.
- **Severity**: Minor
- **Evidence**: The copyright line at the bottom is nearly invisible on mobile.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Major    | 1 |
| Minor    | 12 |
| **Total** | **13** |

The most significant issue is the **mobile navigation not collapsing into a hamburger menu** (Bug 9), which degrades the mobile experience by cramming desktop navigation into a 375px viewport. The remaining issues are cosmetic: illegible struck-through prices across all cards and viewports, inconsistent CTA button alignment across desktop cards, and low-contrast footer text.
