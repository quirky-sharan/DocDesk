/** @type {import('tailwindcss').Config} */

// Every colour here resolves to a CSS variable defined in src/index.css, so the
// light/dark swap happens in one place and utilities like `bg-surface/80` still
// work (the variables hold bare RGB channels for exactly that reason).
const channel = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', '"SF Mono"', '"Cascadia Code"', '"JetBrains Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        canvas: channel('canvas'),
        surface: channel('surface'),
        elevated: channel('elevated'),
        sunken: channel('sunken'),
        ink: {
          DEFAULT: channel('text'),
          2: channel('text-2'),
          3: channel('text-3'),
        },
        accent: {
          DEFAULT: channel('accent'),
          hover: channel('accent-hover'),
          ink: channel('accent-text'),
        },
        good: channel('success'),
        warn: channel('warning'),
        bad: channel('danger'),
        violet: channel('violet'),
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        spring: 'var(--ease-spring)',
      },
      keyframes: {
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '100%': { transform: 'scale(1.9)', opacity: '0' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite',
        'spin-slow': 'spin-slow 8s linear infinite',
        float: 'float 6s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 1.6s cubic-bezier(0.16, 1, 0.3, 1) infinite',
      },
    },
  },
  plugins: [],
};
