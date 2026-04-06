/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        fast: { DEFAULT: "#10b981", light: "#d1fae5", dark: "#065f46" },
        slow: { DEFAULT: "#6366f1", light: "#e0e7ff", dark: "#3730a3" },
        warn: { DEFAULT: "#f59e0b", light: "#fef3c7" },
      },
    },
  },
  plugins: [],
};
