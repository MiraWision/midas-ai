import { readBuildInfo, readDatasetRows } from '@/db/repositories/datasets';
import { DATASETS } from '@/datasets';

export const dynamic = 'force-dynamic';

export default async function DatasetsPage() {
  let info = new Map<string, Awaited<ReturnType<typeof readBuildInfo>> extends Map<string, infer V> ? V : never>();
  let dbError = false;
  try {
    info = await readBuildInfo();
  } catch {
    dbError = true;
  }

  const previews = new Map<string, Awaited<ReturnType<typeof readDatasetRows>>>();
  if (!dbError) {
    for (const dataset of DATASETS) {
      if (info.has(dataset.id)) {
        previews.set(dataset.id, await readDatasetRows(dataset.id, { limit: 12 }));
      }
    }
  }

  return (
    <>
      <h1 className="mw-hero-title">Datasets</h1>
      <p className="mw-hero-sub">
        Derived tables your research keeps re-deriving — declared once in <code>src/datasets/</code>,
        built with <code>midas dataset build &lt;id&gt;</code>, materialized in Postgres, readable by
        strategies, scripts and this page.
      </p>

      {dbError && (
        <div className="mw-card" style={{ marginTop: 24 }}>
          <p className="mw-empty">
            Database unavailable — <code>docker compose up -d db</code>.
          </p>
        </div>
      )}

      {DATASETS.map((dataset) => {
        const built = info.get(dataset.id);
        const rows = previews.get(dataset.id) ?? [];
        return (
          <div key={dataset.id} className="mw-card" style={{ marginTop: 24 }}>
            <div className="mw-card-title">
              {dataset.id} · {built ? `${built.rowCount} rows` : 'not built'}
            </div>
            <p style={{ marginTop: 0, color: 'var(--text-secondary)', fontSize: 14 }}>{dataset.description}</p>
            {!built && (
              <pre className="mw-mono mw-snippet">midas dataset build {dataset.id}</pre>
            )}
            {rows.length > 0 && (
              <div className="mw-table-wrap">
                <table className="mw-table">
                  <thead>
                    <tr>
                      {dataset.columns.map((column) => (
                        <th key={column.name} title={column.description}>
                          {column.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={`${row.key}-${row.timestampMs}-${i}`}>
                        {dataset.columns.map((column) => {
                          const value = row.values[column.name];
                          return (
                            <td key={column.name} className="mw-mono">
                              {typeof value === 'number'
                                ? Number.isInteger(value)
                                  ? value
                                  : value.toFixed(4)
                                : String(value ?? '')}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {built && built.rowCount > rows.length && (
                  <p className="mw-empty" style={{ marginTop: 8 }}>
                    first {rows.length} of {built.rowCount} rows — full table via{' '}
                    <code>midas dataset show {dataset.id}</code>
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
