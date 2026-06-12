import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          0: "var(--ink-0)",
          1: "var(--ink-1)",
          2: "var(--ink-2)",
          3: "var(--ink-3)",
        },
        line: {
          DEFAULT: "var(--line)",
          2: "var(--line-2)",
        },
        mint: {
          DEFAULT: "var(--mint)",
          soft: "var(--mint-soft)",
          line: "var(--mint-line)",
        },
        amber: {
          DEFAULT: "var(--amber)",
          soft: "var(--amber-soft)",
        },
        text: "var(--text)",
        muted: {
          DEFAULT: "var(--muted)",
          2: "var(--muted-2)",
        },
      },
      fontFamily: {
        display: "var(--font-display)",
        ui: "var(--font-ui)",
        mono: "var(--font-mono)",
      },
      maxWidth: {
        wrap: "1140px",
      },
      letterSpacing: {
        eyebrow: "0.16em",
      },
      keyframes: {
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
        flow: {
          "0%": { transform: "translateY(-120%)" },
          "100%": { transform: "translateY(120%)" },
        },
      },
      animation: {
        marquee: "marquee 38s linear infinite",
        flow: "flow 5.5s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
