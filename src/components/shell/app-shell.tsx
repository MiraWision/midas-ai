'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  IconFlask2,
  IconLayoutDashboard,
  IconRobot,
  IconChartCandle,
  IconBook2,
} from '@tabler/icons-react';

const NAV = [
  { href: '/', label: 'Dashboard', icon: IconLayoutDashboard, ready: true },
  { href: '/research', label: 'Research', icon: IconFlask2, ready: false },
  { href: '/sandbox', label: 'Sandbox', icon: IconChartCandle, ready: false },
  { href: '/agent', label: 'Agent', icon: IconRobot, ready: false },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mw-shell">
      <aside className="mw-sidebar">
        <Link href="/" className="mw-logo">
          <span className="mw-logo-mark">M</span>
          MidasAI
        </Link>
        <nav className="mw-nav">
          {NAV.map(({ href, label, icon: Icon, ready }) => (
            <Link key={href} href={href} className="mw-nav-item" data-active={pathname === href}>
              <Icon size={17} stroke={1.7} />
              {label}
              {!ready && <span className="mw-soon">soon</span>}
            </Link>
          ))}
          <a
            className="mw-nav-item"
            href="https://github.com/MiraWision/midas-ai#readme"
            target="_blank"
            rel="noreferrer"
          >
            <IconBook2 size={17} stroke={1.7} />
            Docs
          </a>
        </nav>
        <div className="mw-sidebar-footer">v0.1 · foundation</div>
      </aside>
      <main className="mw-main">{children}</main>
    </div>
  );
}
