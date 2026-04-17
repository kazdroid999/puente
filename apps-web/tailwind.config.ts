import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Punete Micro SaaS Store — Design System v4 Light
        bg: '#FAFAF7',
        surface: '#FFFFFF',
        ink: '#0F0F0F',
        muted: '#666666',
        line: '#E5E5E0',
        accent: '#FF5A1F',    // Puente Orange
        accent2: '#1A4CD1',   // Bolivia Blue
        success: '#1B9E5E',
        warn: '#D97706',
        danger: '#C3342B',
      },
      fontFamily: {
        sans: ['"Noto Sans JP"', '"Inter"', 'system-ui', 'sans-serif'],
        display: ['"Zen Kaku Gothic New"', '"Inter"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'display-1': ['3.5rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'display-2': ['2.5rem', { lineHeight: '1.15' }],
      },
      maxWidth: { content: '1200px' },
    },
  },
  plugins: [],
};
export default config;
