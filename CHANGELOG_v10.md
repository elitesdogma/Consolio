# Consolio v0.10.0

## Responsive desktop and tablet layout

The app was a fixed glass slab capped at 440px wide on every screen, so on a
desktop it showed as an iPhone-width column stranded mid-screen. This version
keeps the floating-slab aesthetic and the ambient field behind it, but lets the
slab widen on larger screens and rearranges the Total surface to use the space.

### What changes
- The .device slab widens above the design's existing 600px breakpoint: to 760px
  on tablet, 940px on desktop, 1040px on large screens. The floating treatment
  (radius, shadow) from the base 600px rule still applies, so it stays a slab,
  just a wider one.
- On the Total surface, the three panels (Concentration, NZD exposure, FIF) move
  from a vertical stack into a horizontal row above 760px (new .panel-deck
  wrapper), so they stop consuming vertical height. The holdings list below stays
  full width for its dense rows. Below 760px the panels stack exactly as before.

### What does NOT change
- Phone layout (below 600px) is byte-for-byte identical. Every responsive rule is
  inside a min-width query at or above 600px.
- The design system, glass material, tokens, type, and colours are untouched. No
  value in styles.css is redefined; responsive.css only adds wide-screen rules.
- Other surfaces (Account, Position, Security) are unchanged; only the Total
  surface gains the panel row.

### Files
- src/responsive.css (new): the additive responsive layer.
- src/App.jsx: imports responsive.css; wraps the three Total-surface panels in a
  .panel-deck div. No other logic changed.

### Caveats to verify in the running app
- Load order: responsive.css must load after styles.css for the .device width to
  win (no !important is used for width). It is imported at the top of App.jsx,
  which Vite bundles after the entry stylesheet. If the slab does not widen,
  move the import into the entry file after the main stylesheet.
- The panels' inline margin-bottom is overridden with !important inside the row
  rule only (inline styles cannot be overridden otherwise); scoped to >=760px so
  the phone stack is unaffected.
