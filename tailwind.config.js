/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        // True black ops palette
        background: {
          DEFAULT: "#000000",
          secondary: "#050505",
          tertiary: "#0c0c0c",
          raised: "#111111",
        },
        line: {
          DEFAULT: "rgba(255,255,255,0.09)",
          strong: "rgba(255,255,255,0.16)",
          faint: "rgba(255,255,255,0.05)",
        },
        glass: {
          DEFAULT: "rgba(255, 255, 255, 0.03)",
          hover: "rgba(255, 255, 255, 0.06)",
          active: "rgba(255, 255, 255, 0.09)",
          border: "rgba(255, 255, 255, 0.09)",
        },
        // Single operational accent family
        primary: {
          DEFAULT: "#e8e8e6",
          glow: "rgba(232, 232, 230, 0.12)",
        },
        accent: {
          amber: "#d4a017",
          amberDim: "rgba(212, 160, 23, 0.14)",
          red: "#ff2d2d",
          redDim: "rgba(255, 45, 45, 0.14)",
          green: "#6fbf73",
          cyan: "#8aa0ad",
          purple: "#8aa0ad", // legacy alias → steel
          pink: "#8aa0ad",
        },
        text: {
          primary: "#e8e8e6",
          secondary: "#9a9a96",
          muted: "#5c5c58",
        },
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        "scale-in": "scaleIn 0.15s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(6px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        scaleIn: {
          "0%": { transform: "scale(0.98)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
      borderRadius: {
        // Tactical: keep corners tight, not bubbly
        sm: "2px",
        DEFAULT: "3px",
        md: "4px",
        lg: "6px",
        xl: "8px",
        "2xl": "10px",
        "3xl": "12px",
        full: "9999px",
      },
    },
  },
  plugins: [],
};
