/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      // U01.6 · La clase `border` sin color usa el borde del sistema (antes gris fijo de Tailwind, blanco visible en oscuro).
      borderColor: { DEFAULT: 'var(--c-border)' },
      boxShadow: {
        soft: '0 5px 20px rgba(0, 0, 0, 0.05)',
        'soft-hover': '0 15px 30px rgba(0, 0, 0, 0.1)',
      },
    },
  },
  plugins: [],
};
