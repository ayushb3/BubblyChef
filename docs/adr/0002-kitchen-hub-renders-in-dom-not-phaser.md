# The kawaii kitchen hub renders in DOM + Framer Motion, not Phaser 3

The kitchen hub home screen (#39, specced as PRD #67 with children #68–#75) will be built with regular DOM elements animated by Framer Motion. PRD #67 specified Phaser 3 and a canvas scene; that part of the PRD is superseded. Its design principles — the zones, the mascot, the glow states, the tappable navigation — all carry over unchanged. Only the renderer changes.

The scene the PRD describes is four or five static zones, one walking mascot, and some glow and pulse states. That is not a game-engine workload. It has no physics, no sprite batching, no frame-budget pressure, and no continuous simulation — the things Phaser exists to provide.

Against that, canvas costs us two things we have already built and paid for. The five-palette theme system is pure CSS custom properties: every component reads `--color-primary` and friends, and switching `data-theme` on `<html>` retints the whole app for free. A canvas scene sits outside the cascade, so each palette would have to be re-plumbed as JavaScript colour constants and manually redrawn on theme change — reimplementing theming for one screen. The same applies to accessibility (#10): DOM zones are real focusable elements with real ARIA, while canvas has no accessibility tree at all and would need a parallel hidden DOM mirror to be operable by a screen reader or keyboard.

There is also a smaller argument that matters in practice: `nextjs/src/lib/motion.ts` already defines the spring vocabulary the rest of the app animates with, including `useMotionConfig()`, which honours `prefers-reduced-motion`. Building the hub in DOM means the kitchen inherits that reduced-motion behaviour automatically rather than needing its own opt-out path.

Phaser would be the right call if the hub later grows into something genuinely game-like — many moving entities, collision, per-frame simulation. If that happens, this decision should be revisited rather than worked around, since porting a DOM scene to canvas is a rewrite of the view layer but not of the data or progression model behind it.

This also matches the reasoning recorded in the gamification plan (PR #124), which reached the same conclusion independently.
