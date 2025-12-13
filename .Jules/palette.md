## 2024-05-23 - [Mobile-First Button Accessibility]
**Learning:** Buttons that use CSS classes like `hidden sm:inline` to hide text on small screens become inaccessible icon-only buttons on mobile devices if they lack explicit `aria-label`s.
**Action:** Always add `aria-label` to buttons that selectively hide their text content, ensuring screen reader users on mobile have the same context as desktop users.
