'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './ThemeToggle';
import { AlertsBadge } from './AlertsBadge';
import { useAdminAuth } from '@/hooks/useAdminAuth';

export function Nav() {
  const pathname = usePathname();
  const { isAuthenticated } = useAdminAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const links = [
    { href: '/', label: 'Dashboard' },
    { href: '/analytics', label: 'Analytics' },
    { href: '/blocks', label: 'Blocks' },
    { href: '/milestones', label: 'Milestones' },
    ...(isAuthenticated ? [
      { href: '/alerts', label: 'Alerts', hasBadge: true },
      { href: '/admin/rpc', label: 'RPC Status' },
      { href: '/admin', label: 'Admin' },
    ] : []),
  ];

  return (
    <header className="glass-header sticky top-0 z-50">
      {/* Accent line at top */}
      <div className="h-0.5 bg-accent" />
      <div className="max-w-full mx-auto px-4 py-4 flex justify-between items-center">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold text-accent">Polygon Dashboard</h1>
          <nav className="hidden md:flex gap-2">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-all duration-150 flex items-center gap-1.5 ${
                  pathname === link.href
                    ? 'btn-gradient-active'
                    : 'text-muted hover:text-accent hover:bg-surface-hover'
                }`}
              >
                {link.label}
                {link.hasBadge && <AlertsBadge />}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {/* Hamburger button — mobile only */}
          <button
            className="md:hidden p-2 rounded text-muted hover:text-accent hover:bg-surface-hover transition-colors"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          >
            {mobileMenuOpen ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="6" y1="18" x2="18" y2="6" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <nav className="md:hidden border-t border-border px-4 py-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`block py-3 px-4 rounded text-sm font-medium transition-all duration-150 flex items-center gap-1.5 ${
                pathname === link.href
                  ? 'btn-gradient-active'
                  : 'text-muted hover:text-accent hover:bg-surface-hover'
              }`}
            >
              {link.label}
              {link.hasBadge && <AlertsBadge />}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
