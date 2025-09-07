/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // AMOLED-optimized colors
        amoled: {
          black: "#000000",
          dark: "#0b1220",    // deep navy‑black
          gray: "#111a2b",     // primary surface
          lightGray: "#18233a", // hover surface
          border: "#22304a",   // cool border
          text: "#ffffff",
          textSecondary: "#9fb3c8", // desaturated blue‑gray
          textMuted: "#6b7c93",     // muted steel
        },
        primary: {
          50: "#f0f9ff",
          100: "#e0f2fe",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
        },
        gray: {
          50: "#f9fafb",
          100: "#f3f4f6",
          200: "#e5e7eb",
          300: "#d1d5db",
          400: "#9ca3af",
          500: "#6b7280",
          600: "#4b5563",
          700: "#374151",
          800: "#1f2937",
          900: "#111827",
        },
        // Bold modern accents (distinct from previous look)
        accent: {
          blue: "#7c4dff",     // electric violet
          green: "#a3e635",    // lime
          purple: "#ff4d8d",   // vivid magenta
          amber: "#fb923c",    // vibrant orange
          red: "#f43f5e",      // rose
          emerald: "#22d3ee",  // neon cyan
        },
      },
      // Enhanced animations
      animation: {
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.4s ease-out",
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "bounce-gentle": "bounceGentle 2s infinite",
      },
      keyframes: {
        slideUp: {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        bounceGentle: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-5px)" },
        },
      },
      // Enhanced spacing for better touch targets
      spacing: {
        18: "4.5rem",
        88: "22rem",
      },
      // Better typography
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1.2" }],
        sm: ["0.875rem", { lineHeight: "1.4" }],
        base: ["1rem", { lineHeight: "1.5" }],
        lg: ["1.125rem", { lineHeight: "1.4" }],
        xl: ["1.25rem", { lineHeight: "1.3" }],
      },
      // Enhanced border radius for modern look
      borderRadius: {
        xl: "1rem",
        "2xl": "1.5rem",
        "3xl": "2rem",
      },
      // Better shadows for depth
      boxShadow: {
        amoled: "0 0 0 1px rgba(255, 255, 255, 0.1)",
        "amoled-lg": "0 0 0 1px rgba(255, 255, 255, 0.15)",
        "glow-blue": "0 0 20px rgba(124, 77, 255, 0.35)",
        "glow-green": "0 0 20px rgba(163, 230, 53, 0.35)",
        "glow-purple": "0 0 20px rgba(255, 77, 141, 0.35)",
      },
    },
  },
  plugins: [],
};
