'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');

  // Suppress lightweight-charts errors during React 18 Strict Mode double-invoke
  // This error occurs when chart is unmounted during the double-invoke cycle
  useEffect(() => {
    const isLightweightChartsError = (message: string | undefined, stack: string | undefined): boolean => {
      // Check for exact error message from lightweight-charts
      if (message !== 'Value is null') return false;
      // Verify it's from lightweight-charts by checking the stack trace
      return stack?.includes('lightweight-charts') ?? false;
    };

    const errorHandler = (event: ErrorEvent) => {
      if (isLightweightChartsError(event.message, event.error?.stack)) {
        event.preventDefault();
        // Don't stopPropagation - let monitoring tools still see it
        return false;
      }
    };
    const rejectionHandler = (event: PromiseRejectionEvent) => {
      if (isLightweightChartsError(event.reason?.message, event.reason?.stack)) {
        event.preventDefault();
        return false;
      }
    };
    window.addEventListener('error', errorHandler, true);
    window.addEventListener('unhandledrejection', rejectionHandler, true);
    return () => {
      window.removeEventListener('error', errorHandler, true);
      window.removeEventListener('unhandledrejection', rejectionHandler, true);
    };
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem('theme') as Theme | null;
    if (stored) {
      setTheme(stored);
    } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
      setTheme('light');
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
