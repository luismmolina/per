## 2025-12-09 - Accessibility of Mobile Hidden Text
**Learning:** Using `hidden sm:inline` on span elements inside buttons effectively removes the text from the accessibility tree on mobile devices, leaving icon-only buttons without accessible names.
**Action:** When designing responsive buttons that hide text on smaller screens, always ensure an `aria-label` is present on the button element to provide an accessible name for screen reader users on mobile devices.
