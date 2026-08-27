/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)',
        secondary: 'var(--color-secondary)',
        third: 'var(--color-third)',
        forth: 'var(--color-forth)',
        fifth: 'var(--color-fifth)',
        sixth: 'var(--color-sixth)',
        input: 'var(--color-input)',
        inputText: 'var(--color-input-text)',
      },
      spacing: {
        'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
        'safe-top': 'env(safe-area-inset-top, 0px)',
      },
    },
  },
  plugins: [],
};
