## 2024-05-23 - Accessibility of Responsive Buttons
**Learning:** Icon-only buttons that reveal text on larger screens (e.g., `hidden sm:inline`) are effectively icon-only for mobile users and screen readers. Relying on the `title` attribute is insufficient as it doesn't work on mobile and isn't always announced by screen readers.
**Action:** Always add an explicit `aria-label` to buttons that hide their text label on any breakpoint, ensuring the label matches the hidden text (or is more descriptive).
