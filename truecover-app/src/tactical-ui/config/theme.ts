/**
 * Tactical UI Theme Configuration
 *
 * This file defines the core theme values for the tactical-ui library.
 * These values are used by both Tailwind CSS and component styles.
 */

export const theme = {
  colors: {
    background: {
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
      redDim: '#7f1d1d',
      green: '#10b981',
      greenDim: '#064e3b',
      blue: '#3b82f6',
      blueDim: '#1e3a8a',
    },
  },
  typography: {
    fontFamily: {
      mono: "'JetBrains Mono', 'Fira Code', 'Consolas', 'Monaco', 'Courier New', monospace",
    },
    fontSize: {
      xs: '10px',
      sm: '12px',
      base: '14px',
      lg: '16px',
      xl: '18px',
      '2xl': '20px',
    },
    fontWeight: {
      normal: 400,
      medium: 500,
      bold: 700,
    },
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px',
    '2xl': '24px',
    '3xl': '32px',
  },
  borderRadius: {
    none: '0px',
    sm: '2px',
    md: '4px',
    lg: '6px',
  },
  borderWidth: {
    thin: '1px',
    medium: '2px',
    thick: '3px',
  },
} as const;

export type Theme = typeof theme;

export default theme;
