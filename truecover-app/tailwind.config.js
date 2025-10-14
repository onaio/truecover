/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        tactical: {
          bg: {
            primary: '#000000',
            secondary: '#0a0a0a',
            tertiary: '#111111',
          },
          border: {
            light: '#555555',
            medium: '#444444',
            dark: '#333333',
          },
          text: {
            primary: '#ffffff',
            secondary: '#e5e5e5',
            muted: '#cccccc',
            dim: '#aaaaaa',
          },
          accent: {
            red: '#ef4444',
            'red-dim': '#7f1d1d',
            green: '#10b981',
            'green-dim': '#064e3b',
            blue: '#3b82f6',
            'blue-dim': '#1e3a8a',
            orange: '#f97316',
            'orange-dim': '#7c2d12',
          },
        },
      },
      fontFamily: {
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'Consolas',
          'Monaco',
          'Courier New',
          'monospace',
        ],
      },
      fontSize: {
        'xs': ['10px', { lineHeight: '14px' }],
        'sm': ['12px', { lineHeight: '16px' }],
        'base': ['14px', { lineHeight: '20px' }],
        'lg': ['16px', { lineHeight: '24px' }],
        'xl': ['18px', { lineHeight: '28px' }],
        '2xl': ['20px', { lineHeight: '32px' }],
      },
      borderWidth: {
        '1': '1px',
        '1.5': '1.5px',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scan': 'scan 2s linear infinite',
      },
      keyframes: {
        scan: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
