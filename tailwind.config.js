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
        sans: [
          'Manrope',
          '"Segoe UI Variable Text"',
          'Segoe UI',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      colors: {
        canvas: '#171a21',
        shadow: '#000000',
        primary: '#1b2838',
        secondary: '#16202d',
        tertiary: '#2a475e',
        surfaceMuted: '#3d4450',
        border: '#3d4450',
        selected: 'rgba(102, 192, 244, 0.18)',
        accent: '#66c0f4',
        accentBar: '#67c1f5',
        onAccent: '#0e141b',
        atlasLogo: '#ffffff',
        text: '#c7d5e0',
        highlight: '#2a475e',
        glam: '#d5a51b',
        overlayTopColor: '#000000',
        overlayBottomColor: '#000000',
      },
      boxShadow: {
        glass: 'inset 0 1px 0 rgba(255, 255, 255, 0.06)',
        'glass-sm': 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
        'glow-accent': '0 0 14px rgba(102, 192, 244, 0.22)',
        'glow-glam': '0 0 10px rgba(213, 165, 27, 0.2)',
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
