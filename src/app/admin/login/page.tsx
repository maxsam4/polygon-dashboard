'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Nav } from '@/components/Nav';

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        router.push('/admin');
        router.refresh();
      } else {
        setError(data.error || 'Login failed');
      }
    } catch {
      setError('Failed to connect to server');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Nav />

      <main className="w-full px-4 py-6 max-w-md mx-auto">
        <div className="terminal-card rounded-lg p-6 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent rounded-t-lg" />

          <h1 className="text-2xl font-bold text-foreground mb-6 pt-1">Admin Login</h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-muted text-sm mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
                className="w-full px-3 py-2 bg-surface dark:bg-surface-elevated text-foreground rounded-lg border border-accent/20 focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all"
                disabled={isLoading}
                autoFocus
              />
            </div>

            {error && (
              <div className="text-danger text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !password}
              className="w-full px-4 py-2 btn-gradient-active rounded-lg transition-all disabled:opacity-50"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
