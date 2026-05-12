import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Vibrant / playful palette: cream background, coral primary,
        // cyan info accent, slate text. Stock badges keep green semantics.
        //
        // v0.9 ADR-040 — `accent` + `paper` resolve through CSS custom
        // properties so the merchant's brand_primary_color / theme_bg_color
        // re-themes the whole app at runtime without a rebuild. Default
        // values for the CSS vars live in src/styles/index.css :root and
        // match the prior hard-coded hex exactly, so an install with no
        // brand color set is pixel-identical to v0.8.
        //
        // Space-separated RGB triples + the `<alpha-value>` token is the
        // Tailwind v3 idiom for keeping opacity utilities working —
        // `bg-accent/[0.12]` compiles to `rgb(var(--color-brand-rgb) / 0.12)`,
        // the CSS-var lookup happens per element at paint time.
        paper: {
          DEFAULT: 'rgb(var(--color-bg-rgb) / <alpha-value>)',
          deep: 'rgb(var(--color-bg-deep-rgb) / <alpha-value>)',
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
          DEFAULT: 'rgb(var(--color-brand-rgb) / <alpha-value>)',
          soft: 'rgb(var(--color-brand-soft-rgb) / <alpha-value>)',
          ink: 'rgb(var(--color-brand-ink-rgb) / <alpha-value>)',
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
