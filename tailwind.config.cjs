/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        glass: "0 20px 60px rgba(15,23,42,0.25)"
      }
    }
  },
  plugins: []
};
