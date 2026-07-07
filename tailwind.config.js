/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        deep: 'rgb(var(--c-deep) / <alpha-value>)',
        ink:  'rgb(var(--c-ink)  / <alpha-value>)',
        surface: {
          1: 'rgb(var(--c-s1) / <alpha-value>)',
          2: 'rgb(var(--c-s2) / <alpha-value>)',
          3: 'rgb(var(--c-s3) / <alpha-value>)',
          4: 'rgb(var(--c-s4) / <alpha-value>)',
          5: 'rgb(var(--c-s5) / <alpha-value>)',
        },
        bdr: {
          DEFAULT: 'rgb(var(--c-bdr)   / <alpha-value>)',
          hover:   'rgb(var(--c-bdr-h) / <alpha-value>)',
          subtle:  'rgb(var(--c-bdr-s) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--c-accent)   / <alpha-value>)',
          hover:   'rgb(var(--c-accent-h) / <alpha-value>)',
          deep:    'rgb(var(--c-accent-d) / <alpha-value>)',
        },
        signal: 'rgb(var(--c-inc) / <alpha-value>)',
        inc: { DEFAULT: 'rgb(var(--c-inc) / <alpha-value>)' },
        exp: { DEFAULT: 'rgb(var(--c-exp) / <alpha-value>)' },
        net: { DEFAULT: 'rgb(var(--c-net) / <alpha-value>)' },
        dng: { DEFAULT: 'rgb(var(--c-dng) / <alpha-value>)' },
        txt: {
          1: 'rgb(var(--c-t1) / <alpha-value>)',
          2: 'rgb(var(--c-t2) / <alpha-value>)',
          3: 'rgb(var(--c-t3) / <alpha-value>)',
          4: 'rgb(var(--c-t4) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans:  ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono:  ['JetBrains Mono', 'ui-monospace', 'monospace'],
        serif: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
      },
      letterSpacing: {
        tightest: '-0.045em',
        ticker:   '0.18em',
      },
      boxShadow: {
        float: '0 24px 60px -28px rgba(0,0,0,0.6), 0 0 0 1px rgb(var(--c-accent) / 0.06)',
        ring:  '0 0 0 1px rgb(var(--c-accent) / 0.18), 0 12px 40px -12px rgb(var(--c-accent) / 0.25)',
      },
    },
  },
  plugins: [],
};
