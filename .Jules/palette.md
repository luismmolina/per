## 2025-05-23 - Palette's Initial Scan
**Learning:** This app is a "Contextual Assistant" focused on notes and AI interactions. It uses a dark theme with glassmorphism.
**Action:** Focus on maintaining the high-quality dark mode aesthetic while improving accessibility.

## 2025-05-23 - Missing ARIA Labels
**Learning:** Several icon-only buttons in `chat-interface.tsx` and `input-area.tsx` rely on `title` attributes or visual icons without `aria-label`. This makes them inaccessible to screen readers.
**Action:** Add descriptive `aria-label` attributes to these buttons.
