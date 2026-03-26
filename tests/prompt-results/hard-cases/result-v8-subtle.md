# QA Triage Report — CloudStack Pricing Page

**Screenshots analyzed:**
- Desktop (1280x800): `subtle-desktop-1280x800.png`
- Mobile (375x812): `subtle-mobile-375x812.png`

---

## Critical (P0) Issues

No Critical issues found.

---

## Serious (P1) Issues

No Serious issues found.

---

## No Critical or Serious issues detected — Top 3 Moderate issues listed below:

### 1. Struck-through original prices are barely legible (Desktop + Mobile)

- **What**: The original prices shown with strikethrough text beneath the current prices (e.g., under $9.99, $29, $99) are rendered in very small, light gray text that is difficult to read at normal viewing distance.
- **Where**: Inside each pricing card, directly below the main price figures.
- **Impact**: All users may struggle to see the discount comparison, reducing the effectiveness of the pricing anchor.
- **Suggested Fix**: Increase the font size of the struck-through price by 1-2px and darken the text color slightly (e.g., from ~#ccc to ~#999) to maintain visual hierarchy while improving readability.

### 2. Footer text is very small and low-contrast (Desktop + Mobile)

- **What**: The footer links ("Terms of Service", "Documentation", "Status", "Privacy Policy", "Contact") and the copyright line use small, light gray text on a white background, making them harder to read.
- **Where**: Bottom of the page, below the pricing cards.
- **Impact**: All users, particularly those with low vision; the footer contains legal and support links that should remain accessible.
- **Suggested Fix**: Increase footer text to at least 14px and ensure contrast ratio meets WCAG AA (4.5:1 minimum for body text).

### 3. "Most Popular" badge placement creates slight visual imbalance (Desktop)

- **What**: The "Most Popular" badge on the Professional card sits above the card border, causing the Professional card's top edge to appear higher than the Starter and Enterprise cards, even though all three cards share the same vertical alignment for their content.
- **Where**: Top-center of the middle pricing card on desktop view.
- **Impact**: Minor visual inconsistency; does not affect usability but creates a slightly uneven card row appearance.
- **Suggested Fix**: Either inset the badge within the card's top padding or add equivalent invisible spacing above the Starter and Enterprise cards to keep the row visually balanced.

---

## Release Recommendation

**RELEASE**

The pricing page is clean, well-structured, and fully functional across both desktop and mobile viewports. No critical or serious issues were found. The three moderate items noted above are cosmetic refinements that can be addressed in a future sprint without blocking release.
