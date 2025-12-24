## 2024-05-23 - Accessibility of Responsive Buttons
**Learning:** This app frequently uses buttons that hide their text label on small screens (`hidden sm:inline`). This creates an accessibility gap where mobile users relying on screen readers only hear "button" or an icon name.
**Action:** Always include a dynamic `aria-label` on buttons that hide their text labels responsively. Also ensure icon-only buttons have `focus-visible` states for keyboard navigation.
