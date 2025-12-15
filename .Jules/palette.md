## 2025-10-26 - Mobile-Hidden Text Buttons
**Learning:** Buttons that hide text labels on mobile screens using `hidden sm:inline` (like the "Voice" or "Deep Read" buttons) become inaccessible icon-only buttons on small devices if they lack an `aria-label`.
**Action:** Always add `aria-label` to any button that conditionally hides its text content based on screen size. The `aria-label` should match the hidden text.

## 2025-10-26 - Dynamic Button State Labels
**Learning:** Toggle buttons (like Microphone start/stop) need dynamic `aria-label` values to accurately reflect their current function to screen readers, rather than a static label.
**Action:** Use ternary operators in `aria-label` prop to reflect state, e.g., `aria-label={isListening ? "Stop recording" : "Start voice input"}`.
