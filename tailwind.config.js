module.exports = {
  content: ['./src/**/*.{html,js,jsx}'],
  theme: {
    borderRadius: {
      none: '0',
      sm: '0',
      DEFAULT: '0',
      md: '0',
      lg: '0',
      xl: '0',
      '2xl': '0',
      '3xl': '0',
      full: '0',
    },
    extend: {
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        canvas: '#050506',
        shadow: '#000000',
        primary: '#121418',
        secondary: '#1a1d22',
        tertiary: '#252a31',
        border: 'rgba(255, 255, 255, 0.26)',
        selected: 'rgba(44, 142, 169, 0.22)',
        accent: '#2C8EA9',
        accentBar: '#3db4d4',
        atlasLogo: '#FFFFFF',
        text: '#e8e6e3',
        highlight: '#5ec8e0',
        glam: '#c9a65a',
        overlayTopColor: '#000000',
        overlayBottomColor: '#000000',
      },
      boxShadow: {
        glass:
          '0 8px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.07)',
        'glass-sm':
          '0 4px 16px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
        'glow-accent': '0 0 28px rgba(44, 142, 169, 0.35)',
        'glow-glam': '0 0 20px rgba(201, 166, 90, 0.2)',
      },
      transitionDuration: {
        DEFAULT: '220ms',
      },
      keyframes: {
        'atlas-shimmer': {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'atlas-fade-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'atlas-pulse-soft': {
          '0%, 100%': { opacity: '0.45' },
          '50%': { opacity: '0.85' },
        },
      },
      animation: {
        'atlas-shimmer': 'atlas-shimmer 2.4s ease-in-out infinite',
        'atlas-fade-up': 'atlas-fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        'atlas-pulse-soft': 'atlas-pulse-soft 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}