## 2025-10-26 - [Mobile Accessibility Hidden Text]
**Learning:** Buttons using Tailwind's `.hidden` utility (e.g., `hidden sm:inline`) to hide text on mobile devices are effectively icon-only buttons for screen readers on those devices. They MUST have an explicit `aria-label` to be accessible.
**Action:** Always verify if responsive text hiding creates icon-only states and add `aria-label` accordingly.
