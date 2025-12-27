## 2024-05-23 - Hidden Labels Accessibility
**Learning:** Elements using `.hidden` or `display: none` to hide text labels (like on mobile screens) must have an `aria-label` or `aria-labelledby` because screen readers will skip the hidden text, leaving the button without an accessible name.
**Action:** When using responsive hiding (e.g. `hidden sm:inline`), always add `aria-label` to the container button to ensure it has a name on all screen sizes.
