'use client';

import { useState, useEffect } from 'react';

interface AdminAuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
}

/**
 * Hook to check admin authentication state.
 * Used by Nav to conditionally show Admin link.
 */
export function useAdminAuth(): AdminAuthState {
  const [state, setState] = useState<AdminAuthState>({
    isAuthenticated: false,
    isLoading: true,
  });

  useEffect(() => {
    let mounted = true;

    const checkAuth = async () => {
      try {
        const response = await fetch('/api/admin/session');
        const data = await response.json();

        if (mounted) {
          setState({
            isAuthenticated: data.authenticated === true,
            isLoading: false,
          });
        }
      } catch {
        if (mounted) {
          setState({
            isAuthenticated: false,
            isLoading: false,
          });
        }
      }
    };

    checkAuth();

    return () => {
      mounted = false;
    };
  }, []);

  return state;
}
