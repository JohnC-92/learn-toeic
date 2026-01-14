/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        muji: {
          paper: '#f7f1e6',
          card: '#fffaf2',
          wood: '#d8c3a5',
          ink: '#3f332b',
          accent: '#c07a4f',
        },
      },
      boxShadow: {
        soft: '0 24px 40px -28px rgba(63, 51, 43, 0.45)',
      },
      fontFamily: {
        sans: ['"Noto Sans TC"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

