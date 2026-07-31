import Link from 'next/link';
import { notFound } from 'next/navigation';

import { readDocument } from '@/server/research-workspace';

export const dynamic = 'force-dynamic';

export default async function ResearchDocumentPage({
  params,
}: {
  params: Promise<{ kind: string; slug: string }>;
}) {
  const { kind, slug } = await params;
  if (kind !== 'reports' && kind !== 'knowledge') notFound();
  const content = readDocument(kind, slug);
  if (content === null) notFound();

  return (
    <>
      <Link href="/research" className="mw-backlink">
        ← Research
      </Link>
      <span className="mw-badge" style={{ marginLeft: 12 }}>
        {kind === 'reports' ? 'report' : 'finding'}
      </span>
      <h1 className="mw-hero-title" style={{ fontSize: 22 }}>
        research/{kind}/{slug}.md
      </h1>
      <div className="mw-card mw-doc">
        <pre>{content}</pre>
      </div>
    </>
  );
}
