# Consolio v0.10.1

## Fix: responsive widening now wins regardless of stylesheet load order

v0.10.0 widened the .device slab with a bare `.device` rule in responsive.css
and relied on that file being bundled AFTER styles.css so it would win on source
order. In the deployed build the order was not guaranteed, so styles.css line 73
(max-width:440px) kept winning and the app stayed iPhone-wide on desktop.

Fix: the width override now uses the selector `html .device`, specificity
(0,1,1), which outranks the base `.device` rule, specificity (0,1,0), on
specificity alone. It therefore wins irrespective of which stylesheet loads
first, removing the load-order dependency. Verified: the only max-width rule on
.device in styles.css is the (0,1,0) base rule, so (0,1,1) wins.

No other change from v0.10.0. The panel-deck row layout and the App.jsx wrapper
are unchanged; only responsive.css selectors were strengthened.

### If it is STILL iPhone-wide after deploying this
The cause is no longer CSS. Check, in order:
1. Did the delta actually land? In the repo:
   grep -c "panel-deck" src/App.jsx ; ls src/responsive.css
   If 0 / missing, the deploy shipped old code.
2. Railway build cache serving a stale bundle: trigger a clean rebuild.
3. Browser cache: hard-reload (the app sets no width inline, confirmed, so a
   correct fresh build cannot render at 440px on desktop).
