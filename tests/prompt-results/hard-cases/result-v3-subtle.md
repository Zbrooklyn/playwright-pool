# Design Review: CloudStack Pricing Page

## Screenshots Analyzed
- Desktop (1280x800): `subtle-desktop-1280x800.png`
- Mobile (375x812): `subtle-mobile-375x812.png`

---

## Spacing & Layout

### Desktop
1. **Inconsistent vertical spacing between pricing cards and feature lists.** The Starter card's feature list appears slightly more compressed vertically than the Professional and Enterprise cards. All three cards should use identical internal padding and line spacing for their feature lists.
2. **Uneven card heights.** The three pricing cards are not equal in height -- the Enterprise card is taller due to more features, but the Starter and Professional cards do not stretch to match. The CTA buttons sit at different vertical positions. **Fix:** Pin all cards to equal height with CTA buttons anchored to the bottom of each card.
3. **Footer spacing is too tight.** The footer links ("Terms of Service", "Documentation", "Status", "Privacy Policy", "Contact") sit very close to the bottom of the page with minimal breathing room above and below. Add at least 48px top margin above the footer divider and 24px below the copyright line.

### Mobile
4. **Cards are stacked with inconsistent gaps.** The gap between the Starter card's "Get Started" button and the "Most Popular" badge on the Professional card appears smaller than the gap between Professional and Enterprise. Use a uniform 24px gap between all stacked cards.
5. **Header navigation wrapping.** The nav items ("Product", "Solutions", "Pricing", "Docs") wrap to a second line beside the logo. This looks unintentional. At 375px, this should collapse into a hamburger menu.

---

## Typography

### Desktop
6. **Price styling inconsistency.** The Starter tier shows "$9.99" with the "9" in the dollar amount rendered noticeably larger than the ".99" and "/mo" -- this superscript-style treatment is applied across all tiers, but the visual weight difference between "$9.99" and "$29" and "$99" makes the hierarchy feel uneven. The single-digit prices look undersized compared to the two-digit ones. Consider making all price values the same font size with the cents/period as a consistent smaller suffix.
7. **Strikethrough original prices are barely legible.** The crossed-out original prices beneath each plan's current price are extremely small and low-contrast (light gray on white). Bump these to at least 14px and ensure a 4.5:1 contrast ratio.

### Mobile
8. **Heading line breaks awkwardly.** "Simple, transparent pricing for growing teams" breaks after "growing" leaving "teams" orphaned on its own line. Consider a `max-width` or manual break to get a more balanced wrap, such as breaking after "pricing for" instead.

---

## Color & Contrast

9. **"Save 20%" label contrast.** The green "Save 20%" text next to the Annual toggle is small and uses a mid-green that may not meet WCAG AA against the white background. Verify contrast ratio is at least 4.5:1; if not, darken the green.
10. **Checkmark icons vs. text weight.** The purple checkmarks in the feature lists are visually heavier than the light-gray feature text beside them, pulling the eye to the checkmarks rather than the features themselves. Consider using a slightly lighter or thinner checkmark, or darkening the feature text to at least #4B5563.
11. **Strikethrough prices have insufficient contrast.** As noted in Typography, these are very faint. Light gray (~#C0C0C0) on white fails WCAG AA. Use at least #6B7280.

---

## Alignment

### Desktop
12. **Price baselines do not align across cards.** Because the cards are laid out side by side, the dollar amounts should share a common baseline. Currently, the varying description text lengths push prices to slightly different vertical positions. **Fix:** Use a fixed-height zone for plan name + description so prices always start at the same Y position.
13. **CTA buttons are not bottom-aligned.** The "Get Started" / "Contact Sales" buttons sit at different vertical positions because feature list lengths vary. Anchor buttons to card bottom with `margin-top: auto` in a flex column layout.

### Mobile
14. **"Most Popular" badge positioning.** On mobile, the badge sits between the Starter and Professional cards, overlapping the gap. It should be anchored to the top of the Professional card with a negative top offset, not floating in the gap.

---

## Visual Polish

15. **Border radius consistency.** The pricing cards use rounded corners (appears ~8-12px radius), and the CTA buttons also use rounded corners, but the "Most Popular" badge uses a different, smaller radius. All interactive/container elements should share the same radius family (e.g., cards 12px, buttons 8px, badges 6px -- or all fully rounded pills for badges and buttons).
16. **Card elevation/shadow.** The cards appear to have a very subtle shadow or border, but the Professional "Most Popular" card does not have additional elevation to distinguish it from the others despite being the recommended plan. Add a slightly stronger shadow or a 2px purple border to the featured card to reinforce the visual hierarchy.
17. **Toggle switch styling.** The Monthly/Annual toggle uses a purple pill style which is fine, but the "Monthly" and "Annual" labels have no visible active/inactive state differentiation beyond the toggle position. Bold or darken the active label and lighten the inactive one.
18. **Enterprise CTA button style mismatch.** "Contact Sales" uses a purple filled button identical in style to the Professional tier's "Get Started." Since Enterprise is a sales-led motion (not self-serve), consider using an outlined/secondary button style to differentiate the action type, or keep it filled but ensure the Professional card's button is the most visually prominent (larger, or with the card's elevated treatment drawing more attention).

---

## Verdict: **Ship with minor fixes**

The pricing page is clean, professional, and communicates the tier structure effectively. None of the issues above are blocking, but several would noticeably improve polish:

**Priority fixes before ship:**
1. Equalize card heights and bottom-align CTA buttons (issue #2, #13)
2. Fix mobile navigation -- implement hamburger menu at 375px (issue #5)
3. Improve strikethrough price contrast (issue #7, #11)
4. Align price baselines across cards (issue #12)

**Nice-to-have post-ship:**
- Consistent card gaps on mobile (#4)
- Heading orphan control (#8)
- "Save 20%" contrast check (#9)
- Featured card elevation (#16)
