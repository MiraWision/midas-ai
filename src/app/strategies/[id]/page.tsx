import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getStrategy, STRATEGIES } from '@/strategies';

export function generateStaticParams() {
  return STRATEGIES.map((s) => ({ id: s.id }));
}

export default async function StrategyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const strategy = getStrategy(id);
  if (!strategy) notFound();

  return (
    <>
      <span className="mw-badge">strategy</span>
      <h1 className="mw-hero-title">{strategy.name}</h1>
      <p className="mw-hero-sub">
        <code>{strategy.id}</code> — a pure <code>analyze()</code> module: closed bars in, signals
        out, no lookahead, deterministic under its params.
      </p>

      <div className="mw-card" style={{ marginTop: 24 }}>
        <div className="mw-card-title">Default params</div>
        <pre className="mw-mono" style={{ margin: 0 }}>
          {JSON.stringify(strategy.defaultParams, null, 2)}
        </pre>
      </div>

      <div className="mw-card">
        <div className="mw-card-title">Validate before you trust</div>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
          Signals from this module are hypotheses, not edge. Pre-register kill criteria (see{' '}
          <code>examples/hypotheses/</code>), run the signal-level event study, and only then the
          walk-forward. The runner lands with{' '}
          <Link href="https://github.com/MiraWision/midas-ai/issues/3" style={{ color: 'var(--green)' }}>
            issue #3
          </Link>
          .
        </p>
      </div>
    </>
  );
}
