import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Polygon brand colors
        'polygon-purple': 'rgb(var(--polygon-purple) / <alpha-value>)',
        'polygon-magenta': 'rgb(var(--polygon-magenta) / <alpha-value>)',
        'polygon-blue': 'rgb(var(--polygon-blue) / <alpha-value>)',

        // Semantic colors
        background: 'rgb(var(--background) / <alpha-value>)',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-elevated': 'rgb(var(--surface-elevated) / <alpha-value>)',
        'surface-hover': 'rgb(var(--surface-hover) / <alpha-value>)',
        'text-secondary': 'rgb(var(--text-secondary) / <alpha-value>)',

        // Status colors
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
      },
      boxShadow: {
        'glass': '0 4px 30px rgba(123, 63, 228, 0.1)',
        'glass-lg': '0 8px 40px rgba(123, 63, 228, 0.15)',
        'glow-sm': '0 0 15px rgba(123, 63, 228, 0.2)',
        'glow-md': '0 0 25px rgba(123, 63, 228, 0.3)',
        'glow-lg': '0 0 40px rgba(123, 63, 228, 0.4)',
      },
      backgroundImage: {
        'gradient-polygon': 'linear-gradient(to right, rgb(var(--polygon-magenta)), rgb(var(--polygon-purple)), rgb(var(--polygon-blue)))',
        'gradient-polygon-vertical': 'linear-gradient(to bottom, rgb(var(--polygon-magenta)), rgb(var(--polygon-purple)), rgb(var(--polygon-blue)))',
      },
      animation: {
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 15px rgba(123, 63, 228, 0.2)' },
          '50%': { boxShadow: '0 0 25px rgba(123, 63, 228, 0.4)' },
        },
      },
    },
  },
  plugins: [],
};
export default config;
