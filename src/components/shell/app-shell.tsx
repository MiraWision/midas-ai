'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  IconFlask2,
  IconLayoutDashboard,
  IconRobot,
  IconChartCandle,
  IconChartLine,
  IconChartHistogram,
  IconTable,
  IconBook2,
} from '@tabler/icons-react';

import { STRATEGIES } from '@/strategies';
import { usePinnedStrategies } from './use-pinned-strategies';

const NAV = [
  { href: '/', label: 'Dashboard', icon: IconLayoutDashboard, ready: true },
  { href: '/strategies', label: 'Strategies', icon: IconChartLine, ready: true },
  { href: '/charts', label: 'Charts', icon: IconChartHistogram, ready: true },
  { href: '/datasets', label: 'Datasets', icon: IconTable, ready: true },
  { href: '/research', label: 'Research', icon: IconFlask2, ready: true },
  { href: '/sandbox', label: 'Sandbox', icon: IconChartCandle, ready: true },
  { href: '/agent', label: 'Agent', icon: IconRobot, ready: true },
] as const;

export function AppShell({ children, version }: { children: React.ReactNode; version: string }) {
  const pathname = usePathname();
  const { pinned } = usePinnedStrategies();
  const pinnedStrategies = pinned
    .map((id) => STRATEGIES.find((s) => s.id === id))
    .filter((s): s is (typeof STRATEGIES)[number] => s !== undefined);

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
          {pinnedStrategies.length > 0 && (
            <>
              <div className="mw-nav-section">Pinned</div>
              {pinnedStrategies.map((strategy) => (
                <Link
                  key={strategy.id}
                  href={`/strategies/${strategy.id}`}
                  className="mw-nav-item mw-nav-sub"
                  data-active={pathname === `/strategies/${strategy.id}`}
                >
                  <span className="mw-nav-dot" />
                  {strategy.name.replace(/ \(.*\)$/, '')}
                </Link>
              ))}
            </>
          )}
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
        <div className="mw-sidebar-footer">v{version}</div>
      </aside>
      <main className="mw-main">{children}</main>
    </div>
  );
}
