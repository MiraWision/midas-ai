'use client';

import Link from 'next/link';
import { IconPin, IconPinFilled } from '@tabler/icons-react';

import { usePinnedStrategies } from '@/components/shell/use-pinned-strategies';
import { STRATEGIES } from '@/strategies';

export default function StrategiesPage() {
  const { isPinned, toggle } = usePinnedStrategies();

  return (
    <>
      <h1 className="mw-hero-title">Strategies</h1>
      <p className="mw-hero-sub">
        Every registered <code>StrategyModule</code>. Pin the ones you&apos;re working with — they
        stay in the sidebar. Add your own in <code>src/strategies/</code>.
      </p>

      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {STRATEGIES.map((strategy) => {
          const pinned = isPinned(strategy.id);
          return (
            <div key={strategy.id} className="mw-card mw-strategy-row">
              <div>
                <Link href={`/strategies/${strategy.id}`} className="mw-strategy-name">
                  {strategy.name}
                </Link>
                <div className="mw-strategy-meta">
                  <code>{strategy.id}</code> · params:{' '}
                  {Object.entries(strategy.defaultParams)
                    .map(([k, v]) => `${k}=${String(v)}`)
                    .join(', ') || '—'}
                </div>
              </div>
              <button
                type="button"
                className="mw-pin-button"
                data-pinned={pinned}
                onClick={() => toggle(strategy.id)}
                title={pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
              >
                {pinned ? <IconPinFilled size={16} /> : <IconPin size={16} />}
                {pinned ? 'Pinned' : 'Pin'}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
