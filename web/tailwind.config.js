/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Pastel tier — backgrounds, tints, decorative fills only
        'pastel-pink':     '#FFB5C5',
        'pastel-mint':     '#B5EAD7',
        'pastel-lavender': '#C9B5E8',
        'pastel-peach':    '#FFDAB3',
        'pastel-coral':    '#FF9AA2',
        'pastel-yellow':   '#FFF1B5',
        'pastel-blue':     '#B5D8EB',

        // Deep tier — CTAs, active states, icon color on neutral bg
        'deep-pink':       '#E8748A',
        'deep-mint':       '#6BC4A0',
        'deep-lavender':   '#9B7DD4',
        'deep-peach':      '#E8A660',
        'deep-coral':      '#E8636E',

        // Base
        'cream':           '#FFF9F5',
        'soft-charcoal':   '#4A4A4A',

        // Semantic borders/dividers
        'border-subtle':   '#F2E8E4',
        'border-input':    '#E8DDD8',

        // Dark mode surfaces
        'night-base':      '#1A1F2E',
        'night-surface':   '#242B3D',
        'night-raised':    '#2E3650',
        'night-border':    '#2A3347',
        'night-text':      '#E8E0F0',
        'night-secondary': '#9B93B0',
        'night-pink':      '#C4849A',
        'night-mint':      '#7BB5A0',
        'night-lavender':  '#9985C2',
        'night-peach':     '#C4956A',
        'night-coral':     '#C4707A',
      },
      borderRadius: {
        'pill': '999px',
        'xl':   '12px',
        '2xl':  '16px',
        '3xl':  '24px',
        'full': '9999px',
      },
      boxShadow: {
        'soft':    '0 2px 8px rgba(0, 0, 0, 0.06)',
        'soft-lg': '0 4px 20px rgba(0, 0, 0, 0.08)',
        'soft-xl': '0 8px 30px rgba(0, 0, 0, 0.10)',
        'none':    'none',
      },
      fontFamily: {
        sans: ['Nunito', 'ui-rounded', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'display': ['2rem',    { lineHeight: '1.2', fontWeight: '800' }],
        '3xl':     ['1.5rem',  { lineHeight: '1.3' }],
        '2xl':     ['1.25rem', { lineHeight: '1.4' }],
        'xl':      ['1.125rem',{ lineHeight: '1.4' }],
        'base':    ['1rem',    { lineHeight: '1.5' }],
        'sm':      ['0.875rem',{ lineHeight: '1.5' }],
        'xs':      ['0.75rem', { lineHeight: '1.4' }],
      },
    },
  },
  plugins: [],
}
