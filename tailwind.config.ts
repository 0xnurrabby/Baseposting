import type { Config } from "tailwindcss";

export default {
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./styles/**/*.{css}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", "monospace"],
      },
      boxShadow: {
        glow: "0 0 20px rgba(34, 211, 238, 0.15)",
      },
      keyframes: {
        blink: {
          "0%, 49%": { opacity: "1" },
          "50%, 100%": { opacity: "0" }
        },
        scan: {
          "0%": { transform: "translateY(-40%)" },
          "100%": { transform: "translateY(140%)" }
        }
      },
      animation: {
        blink: "blink 1.05s steps(2, start) infinite",
        scan: "scan 6s linear infinite"
      }
    },
  },
  plugins: [],
} satisfies Config;
