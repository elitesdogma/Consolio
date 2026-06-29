# Consolio v0.11.0

## Full-bleed desktop layout

The app now goes edge to edge on large screens instead of staying an
iPhone-width slab. This is a deliberate departure from the floating-slab design:
on desktop the slab fills the viewport and the content is rearranged so the width
is genuinely used rather than stretched.

### What changes (>= the breakpoints, desktop/tablet only)
- The .device slab widens to 760px on tablet, then goes full-bleed (max-width
  none, full width, radius removed, full viewport height) from 1040px up.
- The three Total-surface panels become a horizontal row (.panel-deck) from
  760px.
- The holdings lists (Holders and Securities) become responsive grids of compact
  cards (.holdings-grid, auto-fit minmax 280px, widening to 320px past 1440px)
  from 760px, so a wide screen packs many columns instead of showing over-wide
  rows.

### What does NOT change
- Phone layout (below 600px) is byte-for-byte identical. Every responsive rule
  is inside a min-width query at or above 600px; .panel-deck and .holdings-grid
  are plain flex columns there.
- The design system, glass material, tokens, type, and colours are untouched.
  styles.css is not modified; responsive.css only adds wide-screen rules.
- Account, Position, Security detail surfaces are unchanged (single column inside
  the now-full-width slab). They can be given a wide treatment in a later pass.

### Robustness fixes carried in
- Width overrides use `html .device` (specificity 0,1,1) so they win over the
  base `.device` rule (0,1,0) regardless of stylesheet load order. No reliance on
  bundle order.
- The holdings-grid wrappers carry an inline display:flex, so the grid override
  uses display:grid !important (inline styles cannot be overridden otherwise).
  Scoped inside the >=760px query, so the phone flex-column is unaffected.

### Files
- src/responsive.css: full-bleed + panel row + holdings grid.
- src/App.jsx: imports responsive.css; .panel-deck wrapper around the 3 panels;
  .holdings-grid class on both list wrappers. No logic changed.

### Verify in the running app
- If still iPhone-wide: confirm the delta landed (grep -c "holdings-grid"
  src/App.jsx, expect 2; ls src/responsive.css) and that Railway did a clean
  rebuild (not a cached bundle).
- Panels in a flex row stretch to equal height; if unbalanced with real holders,
  they can be switched to top-aligned.
