## 2025-05-18 - Accessibility on Hidden Elements
**Learning:** Buttons that use `hidden sm:inline` to hide text on mobile devices must have an explicit `aria-label`. Without it, screen readers on mobile only announce the icon (if labeled) or nothing at all, making the button inaccessible.
**Action:** Always verify responsive visibility classes. If text is hidden at any breakpoint, add `aria-label` to the container or button.

## 2025-05-18 - Focus Visibility for Custom Buttons
**Learning:** When using custom backgrounds and borders for buttons (e.g., `bg-white/5`), the default browser focus ring is often insufficient or hidden by `overflow: hidden` or low contrast.
**Action:** Explicitly add `focus-visible:ring-2` and `focus-visible:outline-none` with a high-contrast color (like `ring-primary` or `ring-white`) to ensure keyboard users can track their focus.
