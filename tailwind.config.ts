import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  safelist: [
    // Gas utilization progress bar colors
    'bg-success/40',
    'bg-warning/40',
    'bg-danger/40',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['var(--font-mono)', 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Consolas', 'monospace'],
      },
      colors: {
        // Semantic colors
        background: 'rgb(var(--background) / <alpha-value>)',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        'foreground-bright': 'rgb(var(--foreground-bright) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-elevated': 'rgb(var(--surface-elevated) / <alpha-value>)',
        'surface-hover': 'rgb(var(--surface-hover) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',

        // Accent colors
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-secondary': 'rgb(var(--accent-secondary) / <alpha-value>)',

        // Status colors
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
      },
      boxShadow: {
        'glow-sm': '0 0 15px rgba(0, 255, 65, 0.1)',
        'glow-md': '0 0 20px rgba(0, 255, 65, 0.15)',
        'glow-lg': '0 0 30px rgba(0, 255, 65, 0.2)',
      },
      animation: {
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 15px rgba(0, 255, 65, 0.1)' },
          '50%': { boxShadow: '0 0 25px rgba(0, 255, 65, 0.2)' },
        },
      },
    },
  },
  plugins: [],
};
export default config;
