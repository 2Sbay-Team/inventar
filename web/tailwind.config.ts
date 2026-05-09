import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Vibrant / playful palette: cream background, coral primary,
        // cyan info accent, slate text. Stock badges keep green semantics.
        paper: {
          DEFAULT: '#FFF8F2',
          deep: '#FCEFE2',
        },
        ink: {
          DEFAULT: '#1F2937',
          '2': '#4B5563',
          '3': '#6B7280',
          '4': '#9CA3AF',
        },
        hair: {
          DEFAULT: 'rgba(31, 41, 55, 0.08)',
          '2': 'rgba(31, 41, 55, 0.14)',
        },
        accent: {
          DEFAULT: '#FF6B35',
          soft: '#FFE4D6',
          ink: '#C44417',
        },
        info: {
          DEFAULT: '#06B6D4',
          soft: '#CFFAFE',
        },
        ok: {
          DEFAULT: '#16A34A',
          soft: '#DCFCE7',
        },
        warn: {
          DEFAULT: '#D97706',
          soft: '#FEF3C7',
        },
        bad: {
          DEFAULT: '#DC2626',
          soft: '#FEE2E2',
        },
        device: '#0F172A',
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
