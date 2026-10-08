/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        greek: ['"Gentium Plus"', '"Palatino Linotype"', '"Noto Serif"', 'Palatino', 'Georgia', 'serif'],
        ui: ['-apple-system', 'BlinkMacSystemFont', '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', 'sans-serif'],
      },
      colors: {
        ink: {
          50: '#f6f7f9', 100: '#eceef2', 200: '#d5dae3', 300: '#b0bac9',
          400: '#8494aa', 500: '#64748b', 600: '#4e5b70', 700: '#3f4a5b',
          800: '#363f4d', 900: '#1e2530', 950: '#131820',
        },
        aegean: {
          50: '#eff9ff', 100: '#dff2ff', 200: '#b8e6ff', 300: '#78d3ff',
          400: '#30bcff', 500: '#06a3f0', 600: '#0082cd', 700: '#0067a6',
          800: '#065788', 900: '#0b4971', 950: '#072e4b',
        },
        laurel: {
          50: '#f2fbf4', 100: '#e2f6e7', 200: '#c6ecd1', 300: '#98dcac',
          400: '#63c37f', 500: '#3da75c', 600: '#2d8947', 700: '#266d3b',
          800: '#235732', 900: '#1e482c',
        },
        wine: {
          50: '#fdf3f3', 100: '#fbe5e5', 200: '#f8d0d0', 300: '#f2afaf',
          400: '#e87f7f', 500: '#da5555', 600: '#c53838', 700: '#a52c2c',
          800: '#882828', 900: '#722626',
        },
      },
      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'pop': { '0%': { transform: 'scale(.96)', opacity: '0' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        'pulse-ring': { '0%': { transform: 'scale(.9)', opacity: '.7' }, '100%': { transform: 'scale(1.5)', opacity: '0' } },
      },
      animation: {
        'fade-up': 'fade-up .28s ease-out both',
        pop: 'pop .2s ease-out both',
        'pulse-ring': 'pulse-ring .9s ease-out infinite',
      },
    },
  },
  plugins: [],
}
