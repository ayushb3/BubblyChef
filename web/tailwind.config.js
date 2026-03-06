/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'pastel-pink': '#FFB5C5',
        'pastel-mint': '#B5EAD7',
        'pastel-lavender': '#C9B5E8',
        'pastel-peach': '#FFDAB3',
        'pastel-coral': '#FF9AA2',
        'pastel-yellow': '#FFF1B5',
        'pastel-blue': '#B5D8EB',
        'cream': '#FFF9F5',
        'soft-charcoal': '#4A4A4A',
      },
      borderRadius: {
        'xl': '12px',
        '2xl': '16px',
        '3xl': '24px',
      },
      boxShadow: {
        'soft': '0 2px 8px rgba(255, 181, 197, 0.15)',
        'soft-lg': '0 4px 16px rgba(255, 181, 197, 0.2)',
      },
      fontFamily: {
        sans: ['Nunito', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
