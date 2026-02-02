'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './ThemeToggle';

export function Nav() {
  const pathname = usePathname();

  const links = [
    { href: '/', label: 'Dashboard' },
    { href: '/analytics', label: 'Analytics' },
    { href: '/blocks', label: 'Blocks' },
    { href: '/milestones', label: 'Milestones' },
    { href: '/status', label: 'Status' },
  ];

  return (
    <header className="glass-header sticky top-0 z-50">
      {/* Gradient accent line at top */}
      <div className="h-0.5 gradient-polygon" />
      <div className="max-w-full mx-auto px-4 py-4 flex justify-between items-center">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold gradient-text">Polygon Dashboard</h1>
          <nav className="flex gap-2">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  pathname === link.href
                    ? 'btn-gradient-active'
                    : 'text-text-secondary hover:text-foreground hover:bg-surface-hover'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
