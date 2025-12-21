## 2024-05-23 - [Icon-Only Buttons & Hidden Text]
**Learning:** Buttons that rely on hidden text (via `hidden sm:inline`) for visual labels on small screens often leave screen reader users without context on mobile devices if `aria-label` is not explicitly set.
**Action:** Always provide an explicit `aria-label` when using `hidden` classes on button text, ensuring the label matches the visual text or provides equivalent context.
