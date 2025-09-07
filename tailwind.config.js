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
          dark: "#0b0f14", // subtle blue‑black for depth
          gray: "#111827",  // slate‑900 style surface
          lightGray: "#1f2937", // slate‑800 hover surface
          border: "#2a3441", // muted cool border
          text: "#ffffff",
          textSecondary: "#cbd5e1", // slate‑300
          textMuted: "#94a3b8", // slate‑400
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
        // Refined neon accents (accessible on black)
        accent: {
          blue: "#22d3ee",     // cyan‑400
          green: "#34d399",    // emerald‑400
          purple: "#a78bfa",   // violet‑400
          amber: "#fbbf24",    // amber‑400
          red: "#fb7185",      // rose‑400
          emerald: "#14b8a6",  // teal‑500
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
        "glow-blue": "0 0 20px rgba(34, 211, 238, 0.3)",
        "glow-green": "0 0 20px rgba(52, 211, 153, 0.3)",
        "glow-purple": "0 0 20px rgba(167, 139, 250, 0.3)",
      },
    },
  },
  plugins: [],
};
