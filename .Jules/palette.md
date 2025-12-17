## 2024-05-23 - Accessibility for Responsive Buttons
**Learning:** Responsive buttons that hide text labels on mobile (`hidden sm:inline`) often become inaccessible icon-only buttons for screen reader users on small screens if they don't have explicit `aria-label` attributes.
**Action:** Always include `aria-label` on buttons that toggle text visibility based on screen size, ensuring the label provides the same context as the hidden text.
