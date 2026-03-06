/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        velion: {
          black: "#08090d",
          discord: "#1b1f2a",
          fuchsia: "#ff0f88",
          steel: "#2f3548",
          text: "#e8ecf2",
        },
      },
      boxShadow: {
        glow: "0 0 40px rgba(255, 15, 136, 0.25)",
      },
      backgroundImage: {
        mesh: "radial-gradient(circle at 20% 20%, rgba(255, 15, 136, 0.15), transparent 35%), radial-gradient(circle at 80% 0%, rgba(47, 53, 72, 0.7), transparent 40%), linear-gradient(180deg, #08090d 0%, #111420 100%)",
      },
    },
  },
  plugins: [],
};

