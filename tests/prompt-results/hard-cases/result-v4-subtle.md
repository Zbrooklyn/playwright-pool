# WCAG 2.1 AA Accessibility Audit — CloudStack Pricing Page

**Screenshots analyzed:**
- Desktop: `subtle-desktop-1280x800.png` (1280x800)
- Mobile: `subtle-mobile-375x812.png` (375x812)

---

## Color Contrast (WCAG 1.4.3, 1.4.6)

### Issues Found

1. **Subtitle/description text appears low contrast** — WCAG 1.4.3 (Minimum Contrast)
   - The subtitle "Start free and scale as you grow. No hidden fees, no surprises. Cancel anytime." and the tier description text ("Perfect for individuals and small projects", "For teams that need more power and collaboration", etc.) render in a light gray on white background. Estimated contrast ratio is approximately 3.5:1 to 4:1, which falls below the 4.5:1 minimum for normal-sized text.
   - **Fix:** Darken the gray text to at least `#595959` (or darker) to achieve 4.5:1 against white.

2. **Struck-through original prices are very low contrast** — WCAG 1.4.3
   - The original prices (e.g., the crossed-out price below "$9.99/mo") appear in a very light gray, estimated around 2.5:1 to 3:1 contrast. While these are secondary/decorative, they still convey pricing information the user needs.
   - **Fix:** Use at least `#767676` for struck-through prices to hit 4.5:1, or ensure the information is available through other means.

3. **"Save 20%" badge text** — WCAG 1.4.3
   - The green "Save 20%" text next to the Annual toggle appears to be a medium green on white. Estimated contrast around 3.5:1 to 4:1 depending on the exact shade. This is below the 4.5:1 threshold for small text.
   - **Fix:** Darken the green to at least `#1a7a1a` or similar to reach 4.5:1.

4. **Footer links** — WCAG 1.4.3
   - "Terms of Service", "Documentation", "Status", "Privacy Policy", "Contact" and the copyright notice in the footer appear in light gray text on a light background. Estimated ratio around 3:1 to 3.5:1.
   - **Fix:** Darken footer text to meet 4.5:1 minimum.

5. **"/mo" unit text** — WCAG 1.4.3
   - The "/mo" suffix after each price renders in a lighter weight/color than the price itself. On the Starter and Enterprise tiers especially, this appears close to the 4.5:1 boundary.
   - **Fix:** Verify computed contrast; darken if below threshold.

### Passing

- Main heading "Simple, transparent pricing for growing teams" — dark text on white, well above 4.5:1.
- Feature list items (checkmark text) — appear to be dark gray/black on white, likely passing.
- "Most Popular" badge — white text on purple background, estimated 7:1+, passes.
- Purple CTA buttons — white text on purple, estimated 5:1+, passes.
- White CTA buttons (Starter "Get Started") — purple text on white with purple border, passes.

---

## Touch/Click Targets (WCAG 2.5.5, 2.5.8)

### Issues Found

6. **Monthly/Annual toggle switch is undersized** — WCAG 2.5.5 (Target Size)
   - The toggle switch between "Monthly" and "Annual" appears to be approximately 36x20px, well below the 44x44px minimum recommended target size.
   - **Fix:** Increase the toggle's clickable area to at least 44x44px (the visual can remain smaller if the tap target is padded).

7. **Footer links lack adequate spacing on mobile** — WCAG 2.5.8 (Target Size Minimum)
   - On mobile, the footer links ("Terms", "Documentation", "Status", "Privacy", "Contact") are arranged horizontally with minimal spacing. They appear close together and likely under 44px in height.
   - **Fix:** Stack footer links vertically on mobile or increase tap target padding to 44px minimum height with 8px+ gaps.

### Passing

- "Get Started" and "Contact Sales" buttons appear adequately sized (full-width on mobile, large enough on desktop).
- Pricing cards themselves are large enough to not cause mis-tap issues.

---

## Text Readability (WCAG 1.4.4, 1.4.8, 1.4.12)

### Issues Found

8. **Tier description text may be below 16px on mobile** — WCAG 1.4.4 (Resize Text)
   - The description text under each tier name ("Perfect for individuals and small projects") appears to be approximately 12-13px on mobile, which is below the recommended 16px minimum for body content.
   - **Fix:** Set a minimum of 16px (`1rem`) for all body text on mobile.

9. **Feature list text appears small** — WCAG 1.4.4
   - The checkmark feature items (e.g., "5 projects", "10 GB storage") appear to be around 13-14px on both desktop and mobile. While WCAG technically allows resizing up to 200%, starting small creates readability issues.
   - **Fix:** Increase feature list font size to at least 16px on mobile.

### Passing

- Main heading scales well between desktop and mobile.
- Text reflows properly on mobile without horizontal scrolling — no overflow issues observed.
- Line spacing on the subtitle text appears adequate (approximately 1.5x).

---

## Visual Indicators (WCAG 1.4.1, 1.4.11)

### Issues Found

10. **Monthly/Annual toggle relies primarily on color** — WCAG 1.4.1 (Use of Color)
    - The toggle uses a purple fill to indicate the active state (Annual). The only difference between Monthly and Annual states is the toggle position and color. There is no text label change, checkmark, or other non-color indicator showing which is selected.
    - **Fix:** Add a bold/underline treatment to the active label, or use an explicit "selected" text indicator alongside the toggle.

11. **Checkmark icons use color as sole differentiator** — WCAG 1.4.1
    - Feature list items use purple/green checkmarks. If these were meant to differentiate included vs. not-included features, color alone would be insufficient. Currently all features show checkmarks so this is minor, but the pattern should be reviewed if "not included" states exist elsewhere.
    - **Fix:** If any features are excluded in lower tiers, use a distinct icon (e.g., X mark) rather than relying on color alone.

12. **"Most Popular" badge relies on color for emphasis** — WCAG 1.4.11 (Non-text Contrast)
    - The purple badge is the sole visual indicator distinguishing the Professional tier. The badge itself meets contrast requirements, but tier differentiation relies heavily on this color-based badge.
    - **Fix:** Consider adding a subtle border, shadow, or elevation change to the Professional card to provide a non-color structural distinction. (The desktop version does show a slight card elevation difference, which helps.)

### Passing

- No form fields present, so required field marking is not applicable.
- Focus indicators were not testable from static screenshots but should be verified in live testing.

---

## Content Structure (WCAG 1.3.1, 2.4.6)

### Issues Found

13. **Heading hierarchy should be verified** — WCAG 1.3.1 (Info and Relationships)
    - The main heading ("Simple, transparent pricing for growing teams") should be an `<h1>`. Tier names ("Starter", "Professional", "Enterprise") should be `<h2>` or `<h3>`. This cannot be confirmed from screenshots alone but should be verified in code.
    - **Fix:** Ensure semantic heading tags are used in proper hierarchy.

14. **Price structure lacks semantic grouping** — WCAG 1.3.1
    - The price display ($9.99/mo with struck-through original) combines multiple visual elements. Screen readers may not convey the relationship between the current price and the original price clearly.
    - **Fix:** Use `<del>` for the original price and `<ins>` or `aria-label` for the current price, or wrap in a group with an `aria-label` like "9.99 dollars per month, originally 12.99 dollars per month."

### Passing

- Reading order appears logical: heading, subtitle, toggle, then cards left-to-right (top-to-bottom on mobile).
- Card structure is consistent across all three tiers.
- Visual hierarchy is clear: heading > subtitle > tier name > price > features > CTA.

---

## General Layout Observations (Non-Accessibility)

15. **Mobile footer copyright text is very small** — The "2025 CloudStack, Inc." copyright line at the bottom of the mobile view appears extremely small (likely 10-11px), making it hard to read even for users without visual impairments.

16. **Desktop card heights are uneven** — The three pricing cards on desktop do not appear to have equal heights. The Enterprise card's feature list is longer, but the cards do not stretch to match, creating slight visual unevenness. The CTA buttons are not bottom-aligned across cards.
    - **Fix:** Use CSS `align-items: stretch` on the card container and pin CTAs to the bottom of each card with `margin-top: auto`.

17. **Mobile card spacing is tight** — On mobile, the "Most Popular" badge between the Starter and Professional cards creates awkward spacing. The badge overlaps the boundary between cards.
    - **Fix:** Add adequate margin above the Professional card on mobile to accommodate the badge without visual overlap.

---

## Summary

| Severity | Count | Categories |
|----------|-------|------------|
| Critical | 2 | Low-contrast body text (#1), low-contrast struck-through prices (#2) |
| Major | 4 | Toggle target size (#6), toggle color-only state (#10), small mobile text (#8, #9) |
| Minor | 5 | Footer contrast (#4), Save 20% contrast (#3), /mo contrast (#5), footer tap targets (#7), badge emphasis (#12) |
| Needs Code Review | 2 | Heading hierarchy (#13), price semantics (#14) |

**Top 3 fixes for maximum impact:**
1. Darken all gray text (subtitles, descriptions, feature lists, footer) to meet 4.5:1 contrast.
2. Increase the toggle tap target to 44x44px and add a non-color indicator for the active state.
3. Increase body/feature text to 16px minimum on mobile.
