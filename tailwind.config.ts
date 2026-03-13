import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        space: {
          950: "#060810",
          900: "#0a0e17",
          800: "#0f1629",
          700: "#151d33",
        },
        neon: {
          blue: "#22d3ee",
          cyan: "#06b6d4",
          purple: "#a78bfa",
          violet: "#8b5cf6",
        },
      },
      boxShadow: {
        glow: "0 0 20px rgba(34, 211, 238, 0.25)",
        "glow-purple": "0 0 20px rgba(167, 139, 250, 0.2)",
      },
    },
  },
  plugins: [],
};

export default config;
