import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: '#F4F1EA',
          deep: '#EBE6DA',
        },
        ink: {
          DEFAULT: '#1B1815',
          '2': '#4A4339',
          '3': '#8A8073',
          '4': '#B8AE9F',
        },
        hair: {
          DEFAULT: 'rgba(27, 24, 21, 0.08)',
          '2': 'rgba(27, 24, 21, 0.14)',
        },
        accent: {
          DEFAULT: '#B8642C',
          soft: '#F4E4D2',
          ink: '#6B3815',
        },
        ok: {
          DEFAULT: '#3D6B47',
          soft: '#DCE8DC',
        },
        warn: {
          DEFAULT: '#A8741C',
          soft: '#F2E5C9',
        },
        bad: {
          DEFAULT: '#8C3C32',
          soft: '#EBD5D0',
        },
        device: '#16140F',
      },
      fontFamily: {
        display: ['"Funnel Display"', 'serif'],
        sans: ['"Funnel Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontFeatureSettings: {
        tnum: '"tnum"',
      },
    },
  },
  plugins: [],
};

export default config;
