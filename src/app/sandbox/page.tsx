import { readSandboxAccounts } from '@/server/sandbox-view';

export const dynamic = 'force-dynamic';

function fmt(value: number, digits = 2): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${fmt(value)}`;
}

export default async function SandboxPage() {
  let views: Awaited<ReturnType<typeof readSandboxAccounts>> = [];
  let dbError = false;
  try {
    views = await readSandboxAccounts();
  } catch {
    dbError = true;
  }

  return (
    <>
      <h1 className="mw-hero-title">Sandbox</h1>
      <p className="mw-hero-sub">
        Paper trading with pessimistic fills — the mandatory step between a surviving hypothesis
        and real keys. Positions are marked to the latest stored candle close, not live tickers.
      </p>

      {dbError && (
        <div className="mw-card" style={{ marginTop: 24 }}>
          <p className="mw-empty">
            Database unavailable — start it with <code>docker compose up -d db</code>.
          </p>
        </div>
      )}

      {!dbError && views.length === 0 && (
        <div className="mw-card" style={{ marginTop: 24 }}>
          <div className="mw-card-title">No accounts yet</div>
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
            Create one and trade on paper against live Kraken prices:
          </p>
          <pre className="mw-mono mw-snippet">{`pnpm sandbox -- create --name my-test --cash 10000
pnpm sandbox -- order --account <id> --symbol BTCUSDC --side BUY --quote-amount 500
pnpm sandbox -- status --account <id>`}</pre>
        </div>
      )}

      {views.map(({ account, snapshot, realizedPnl, tradeCount, recentTrades, markedAsOfMs }) => {
        const totalPnl = snapshot.equity - account.startingCash;
        return (
          <div key={account.id} className="mw-card" style={{ marginTop: 24 }}>
            <div className="mw-card-title">
              {account.name} · <span className="mw-mono">{account.id}</span> · {tradeCount} trades
            </div>
            <div className="mw-stat-row">
              <div className="mw-stat">
                <div className="mw-stat-label">equity</div>
                <div className="mw-stat-value">
                  {fmt(snapshot.equity)} {account.quote}
                </div>
              </div>
              <div className="mw-stat">
                <div className="mw-stat-label">cash</div>
                <div className="mw-stat-value">{fmt(snapshot.cash)}</div>
              </div>
              <div className="mw-stat">
                <div className="mw-stat-label">total PnL</div>
                <div className="mw-stat-value" data-tone={totalPnl >= 0 ? 'green' : 'red'}>
                  {signed(totalPnl)}
                </div>
              </div>
              <div className="mw-stat">
                <div className="mw-stat-label">realized</div>
                <div className="mw-stat-value" data-tone={realizedPnl >= 0 ? 'green' : 'red'}>
                  {signed(realizedPnl)}
                </div>
              </div>
            </div>

            {snapshot.positions.length > 0 && (
              <div className="mw-table-wrap" style={{ marginTop: 14 }}>
                <table className="mw-table">
                  <thead>
                    <tr>
                      <th>position</th>
                      <th>qty</th>
                      <th>avg entry</th>
                      <th>mark</th>
                      <th>value</th>
                      <th>uPnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.positions
                      .filter((p) => p.marketValue >= 0.01)
                      .map((p) => (
                        <tr key={p.symbol}>
                          <td className="mw-mono">{p.symbol}</td>
                          <td className="mw-mono">{p.quantity.toFixed(8)}</td>
                          <td className="mw-mono">{fmt(p.avgEntryPrice, 4)}</td>
                          <td className="mw-mono">{fmt(p.lastPrice, 4)}</td>
                          <td className="mw-mono">{fmt(p.marketValue)}</td>
                          <td className="mw-mono" data-tone={p.unrealizedPnl >= 0 ? 'green' : 'red'}>
                            {signed(p.unrealizedPnl)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {markedAsOfMs !== null && (
                  <p className="mw-empty" style={{ marginTop: 8 }}>
                    marked as of {new Date(markedAsOfMs).toISOString().replace('T', ' ').slice(0, 16)} UTC
                    (latest stored 1h candle)
                  </p>
                )}
              </div>
            )}

            {recentTrades.length > 0 && (
              <div className="mw-table-wrap" style={{ marginTop: 14 }}>
                <table className="mw-table">
                  <thead>
                    <tr>
                      <th>time (UTC)</th>
                      <th>side</th>
                      <th>symbol</th>
                      <th>qty</th>
                      <th>fill</th>
                      <th>fee</th>
                      <th>realized</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTrades.map((t, i) => (
                      <tr key={`${t.timestampMs}-${i}`}>
                        <td className="mw-mono">{new Date(t.timestampMs).toISOString().replace('T', ' ').slice(0, 16)}</td>
                        <td>
                          <span className="mw-status" data-tone={t.side === 'BUY' ? 'green' : 'red'}>
                            {t.side}
                          </span>
                        </td>
                        <td className="mw-mono">{t.symbol}</td>
                        <td className="mw-mono">{t.quantity.toFixed(8)}</td>
                        <td className="mw-mono">{fmt(t.fillPrice, 4)}</td>
                        <td className="mw-mono">{fmt(t.fee, 4)}</td>
                        <td className="mw-mono" data-tone={t.realizedPnl > 0 ? 'green' : t.realizedPnl < 0 ? 'red' : undefined}>
                          {t.side === 'SELL' ? signed(t.realizedPnl) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
