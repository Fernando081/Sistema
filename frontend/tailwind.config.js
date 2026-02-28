/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        // We'll rely on CSS variables defined in styles.css for dynamic colors,
        // but we can add specific Power BI style colors here if needed.
        background: 'var(--bg-primary)',
        card: 'var(--bg-card)',
        textMain: 'var(--text-main)',
        textMuted: 'var(--text-muted)',
      },
      boxShadow: {
        soft: '0 5px 20px rgba(0, 0, 0, 0.05)',
        'soft-hover': '0 15px 30px rgba(0, 0, 0, 0.1)',
      },
    },
  },
  plugins: [],
};
