const GATES = [
  'Kill criteria are fixed before the experiment',
  'Permutation nulls, not eyeballs',
  'All returns are net of costs',
  'IS/OOS split is mandatory',
  'Multiple comparisons are counted in a ledger',
  'Negative results are results',
];

export default function DashboardPage() {
  return (
    <>
      <span className="mw-badge">foundation release</span>
      <h1 className="mw-hero-title">An honest research environment for algorithmic trading</h1>
      <p className="mw-hero-sub">
        Bring your hypotheses, your exchange keys, and optionally your own AI agent. MidasAI brings
        the rails: pre-registered experiments, permutation-tested claims, and a sandbox between
        every idea and real money.
      </p>

      <div className="mw-grid-3" style={{ marginTop: 28 }}>
        <div className="mw-card">
          <div className="mw-card-title">Statistical core</div>
          Event-study harness with random-timing and feature-shuffle nulls — tested, deterministic,
          and ready: <code>src/core/research</code>.
        </div>
        <div className="mw-card">
          <div className="mw-card-title">Methodology as law</div>
          A research workspace with a hypothesis queue, kill criteria, a knowledge journal, and a
          test-count ledger: <code>research/</code>.
        </div>
        <div className="mw-card">
          <div className="mw-card-title">Open contracts</div>
          Pluggable strategy, exchange, and agent interfaces: <code>src/core</code>. Kraken market
          data ships first; adapters are small.
        </div>
      </div>

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
