import Link from 'next/link';

import { readFindings, readLedger, readQueue, readReports } from '@/server/research-workspace';

export const dynamic = 'force-dynamic';

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'KILLED' ? 'red' : status === 'DONE' ? 'green' : status === 'TESTING' ? 'blue' : status === 'BLOCKED' ? 'gray' : 'amber';
  return (
    <span className="mw-status" data-tone={tone}>
      {status}
    </span>
  );
}

export default function ResearchPage() {
  const queue = readQueue();
  const ledger = readLedger();
  const findings = readFindings();
  const reports = readReports();

  return (
    <>
      <h1 className="mw-hero-title">Research</h1>
      <p className="mw-hero-sub">
        The <code>research/</code> workspace, rendered. The filesystem is the source of truth —
        you and the agent edit the same files; this page only reads them.
      </p>

      <div className="mw-card" style={{ marginTop: 24 }}>
        <div className="mw-card-title">Hypothesis queue</div>
        {queue.length === 0 ? (
          <p className="mw-empty">Queue is empty — add a hypothesis with a kill criterion to research/hypotheses/queue.md.</p>
        ) : (
          <div className="mw-table-wrap">
            <table className="mw-table">
              <thead>
                <tr>
                  <th>id</th>
                  <th>status</th>
                  <th>source</th>
                  <th>hypothesis</th>
                  <th>result</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((row) => (
                  <tr key={row.id}>
                    <td className="mw-mono">{row.id}</td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="mw-mono">{row.source}</td>
                    <td>{row.hypothesis}</td>
                    <td>{row.result || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mw-card">
        <div className="mw-card-title">Test ledger — multiple-comparisons accounting</div>
        {ledger.length === 0 ? (
          <p className="mw-empty">No ledger yet.</p>
        ) : (
          <div className="mw-table-wrap">
            <table className="mw-table">
              <thead>
                <tr>
                  <th>family</th>
                  <th>tests</th>
                  <th>experiments</th>
                  <th>notes</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((row) => (
                  <tr key={row.family}>
                    <td className="mw-mono">{row.family}</td>
                    <td className="mw-mono">{row.tests}</td>
                    <td>{row.experiments}</td>
                    <td>{row.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mw-grid-2" style={{ marginTop: 14 }}>
        <div className="mw-card" style={{ margin: 0 }}>
          <div className="mw-card-title">Findings ({findings.length})</div>
          {findings.length === 0 ? (
            <p className="mw-empty">No findings yet. The first killed hypothesis will land here.</p>
          ) : (
            findings.map((finding) => (
              <div key={finding.slug} className="mw-doc-row">
                <span className="mw-status" data-tone={finding.type === 'WORKS' ? 'green' : finding.type === 'DOESNT_WORK' ? 'red' : 'blue'}>
                  {finding.type}
                </span>
                <Link href={`/research/knowledge/${finding.slug}`}>{finding.id}</Link>
              </div>
            ))
          )}
        </div>
        <div className="mw-card" style={{ margin: 0 }}>
          <div className="mw-card-title">Reports ({reports.length})</div>
          {reports.length === 0 ? (
            <p className="mw-empty">No reports yet.</p>
          ) : (
            reports.map((report) => (
              <div key={report.slug} className="mw-doc-row">
                <Link href={`/research/reports/${report.slug}`}>{report.title}</Link>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
