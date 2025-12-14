## 2025-05-22 - Accessibility for Responsive Buttons
**Learning:** Buttons that use `hidden sm:inline` to hide text on mobile devices become inaccessible icon-only buttons for screen readers if they lack an accessible name.
**Action:** Always add an explicit `aria-label` to buttons that hide their text label on smaller screens. This ensures they remain accessible on all devices.
