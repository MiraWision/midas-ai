import { readQueue } from '@/server/research-workspace';

export const dynamic = 'force-dynamic';

export default function AgentPage() {
  const queue = readQueue();
  const queued = queue.filter((row) => row.status === 'QUEUED').length;

  return (
    <>
      <h1 className="mw-hero-title">Agent</h1>
      <p className="mw-hero-sub">
        Run a coding agent as an autonomous researcher — on rails. Write access is scoped to{' '}
        <code>research/**</code>, commands are allow-listed, spend is budget-capped, and every
        number in a finding must come from re-runnable script output.
      </p>

      <div className="mw-grid-2" style={{ marginTop: 24 }}>
        <div className="mw-card" style={{ margin: 0 }}>
          <div className="mw-card-title">Run an iteration</div>
          <p style={{ marginTop: 0, color: 'var(--text-secondary)' }}>
            {queued > 0
              ? `${queued} hypothesis${queued === 1 ? '' : 'es'} queued. One iteration = one hypothesis, end to end:`
              : 'The queue has no QUEUED hypotheses — add one to research/hypotheses/queue.md first, then:'}
          </p>
          <pre className="mw-mono mw-snippet">pnpm research:iterate -- --model sonnet --budget-usd 5</pre>
          <p style={{ marginBottom: 0, color: 'var(--text-secondary)', fontSize: 13 }}>
            Requires <a href="https://claude.com/claude-code" style={{ color: 'var(--green)' }}>Claude Code</a>{' '}
            installed and authenticated. <code>--resume &lt;sessionId&gt;</code> continues a run cut
            off by the wall clock; <code>--dry-run</code> just inspects the queue.
          </p>
        </div>
        <div className="mw-card" style={{ margin: 0 }}>
          <div className="mw-card-title">The trust model</div>
          <ul className="mw-gate-list">
            <li>
              <span className="mw-gate-num">01</span> Writes only inside <code>research/**</code>
            </li>
            <li>
              <span className="mw-gate-num">02</span> Allow-listed toolchain (runners, tests, typecheck)
            </li>
            <li>
              <span className="mw-gate-num">03</span> Hard USD budget + wall-clock ceiling per run
            </li>
            <li>
              <span className="mw-gate-num">04</span> Numbers come from the harness, never the model
            </li>
            <li>
              <span className="mw-gate-num">05</span> A killed hypothesis is a successful iteration
            </li>
          </ul>
        </div>
      </div>
    </>
  );
}
