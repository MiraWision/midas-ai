import Link from 'next/link';
import { count, countDistinct } from 'drizzle-orm';

import { db } from '@/db';
import { marketCandles, sandboxAccounts, trackedMarkets } from '@/db/schema';
import { readFindings, readQueue } from '@/server/research-workspace';
import { STRATEGIES } from '@/strategies';

export const dynamic = 'force-dynamic';

const GATES = [
  'Kill criteria are fixed before the experiment',
  'Permutation nulls, not eyeballs',
  'All returns are net of costs',
  'IS/OOS split is mandatory',
  'Multiple comparisons are counted in a ledger',
  'Negative results are results',
];

interface Stats {
  candles: number | null;
  symbols: number | null;
  accounts: number | null;
}

async function loadStats(): Promise<Stats> {
  try {
    const [candleRows, symbolRows, accountRows] = await Promise.all([
      db.select({ n: count() }).from(marketCandles),
      db.select({ n: countDistinct(trackedMarkets.symbol) }).from(trackedMarkets),
      db.select({ n: count() }).from(sandboxAccounts),
    ]);
    return { candles: candleRows[0]?.n ?? 0, symbols: symbolRows[0]?.n ?? 0, accounts: accountRows[0]?.n ?? 0 };
  } catch {
    return { candles: null, symbols: null, accounts: null };
  }
}

export default async function DashboardPage() {
  const stats = await loadStats();
  const queue = readQueue();
  const findings = readFindings();
  const queued = queue.filter((r) => r.status === 'QUEUED').length;
  const killed = queue.filter((r) => r.status === 'KILLED').length;

  const statCells: Array<{ label: string; value: string; href: string }> = [
    {
      label: 'candles stored',
      value: stats.candles === null ? 'db off' : stats.candles.toLocaleString('en-US'),
      href: '/sandbox',
    },
    { label: 'tracked markets', value: stats.symbols === null ? '—' : String(stats.symbols), href: '/sandbox' },
    { label: 'strategies', value: String(STRATEGIES.length), href: '/strategies' },
    { label: 'hypotheses queued', value: String(queued), href: '/research' },
    { label: 'findings (killed)', value: `${findings.length} (${killed})`, href: '/research' },
    { label: 'sandbox accounts', value: stats.accounts === null ? '—' : String(stats.accounts), href: '/sandbox' },
  ];

  return (
    <>
      <span className="mw-badge">foundation release</span>
      <h1 className="mw-hero-title">An honest research environment for algorithmic trading</h1>
      <p className="mw-hero-sub">
        Bring your hypotheses, your exchange keys, and optionally your own AI agent. MidasAI brings
        the rails: pre-registered experiments, permutation-tested claims, and a sandbox between
        every idea and real money.
      </p>

      <div className="mw-stat-grid" style={{ marginTop: 28 }}>
        {statCells.map((cell) => (
          <Link key={cell.label} href={cell.href} className="mw-card mw-stat-cell">
            <div className="mw-stat-label">{cell.label}</div>
            <div className="mw-stat-value">{cell.value}</div>
          </Link>
        ))}
      </div>

      {stats.candles === null && (
        <div className="mw-card" style={{ marginTop: 14 }}>
          <p className="mw-empty">
            Database unavailable — <code>docker compose up -d db</code>, then{' '}
            <code>pnpm db:push</code> and <code>pnpm market:sync -- --refresh-universe</code>.
          </p>
        </div>
      )}

      <div className="mw-card" style={{ marginTop: 28 }}>
        <div className="mw-card-title">The gates</div>
        <ul className="mw-gate-list">
          {GATES.map((gate, i) => (
            <li key={gate}>
              <span className="mw-gate-num">{String(i + 1).padStart(2, '0')}</span>
              {gate}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
