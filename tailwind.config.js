/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/app/**/*.{js,jsx}",
    "./src/components/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: "#0B3556",
        brand: {
          DEFAULT: "#1C86C7",
          deep: "#135F94",
          light: "#6FC3E8",
          tint: "#EAF6FC",
        },
        ink: {
          DEFAULT: "#10202B",
          soft: "#4C6272",
        },
        mint: { DEFAULT: "#2C8F63", tint: "#E4F5EC" },
        amber: { DEFAULT: "#C97F16", tint: "#FBEEDA" },
        coral: { DEFAULT: "#C3492F", tint: "#FBEAE5" },
        line: "#D7E7F0",
        paper: "#FBFDFE",
      },
      fontFamily: {
        display: ["var(--font-display)", "'Space Grotesk'", "sans-serif"],
        body: ["var(--font-body)", "'Inter'", "sans-serif"],
      },
      borderRadius: {
        xl2: "1rem",
      },
    },
  },
  plugins: [],
};
