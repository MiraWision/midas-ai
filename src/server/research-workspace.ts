/**
 * Read-only view over the research/ workspace. The FILESYSTEM is the source
 * of truth — agents and humans edit the same markdown files; the UI only
 * renders them. Server-side only (node:fs).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'research');

export interface QueueRow {
  id: string;
  status: string;
  source: string;
  hypothesis: string;
  plan: string;
  result: string;
}

export interface LedgerRow {
  family: string;
  tests: string;
  experiments: string;
  notes: string;
}

export interface Finding {
  slug: string;
  id: string;
  type: string;
  confidence: string;
  body: string;
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** Rows of the first markdown table in the text (header + separator skipped). */
function parseTable(markdown: string): string[][] {
  const lines = markdown.split('\n').filter((line) => line.trim().startsWith('|'));
  return lines
    .slice(2) // header + separator
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim())
    )
    .filter((cells) => cells.length > 1);
}

/** Strip [label](target) down to label — the UI links files itself. */
function stripLinks(cell: string): string {
  return cell.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

export function readQueue(): QueueRow[] {
  const markdown = safeRead(join(ROOT, 'hypotheses', 'queue.md'));
  if (!markdown) return [];
  return parseTable(markdown).map((cells) => ({
    id: cells[0] ?? '',
    status: cells[1] ?? '',
    source: cells[2] ?? '',
    hypothesis: stripLinks(cells[3] ?? ''),
    plan: stripLinks(cells[4] ?? ''),
    result: stripLinks(cells[5] ?? ''),
  }));
}

export function readLedger(): LedgerRow[] {
  const markdown = safeRead(join(ROOT, 'hypotheses', 'ledger.md'));
  if (!markdown) return [];
  return parseTable(markdown).map((cells) => ({
    family: cells[0] ?? '',
    tests: cells[1] ?? '',
    experiments: stripLinks(cells[2] ?? ''),
    notes: stripLinks(cells[3] ?? ''),
  }));
}

function listMarkdown(dir: string): string[] {
  try {
    return readdirSync(join(ROOT, dir))
      .filter((name) => name.endsWith('.md') && name !== 'FORMAT.md')
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export function readFindings(): Finding[] {
  return listMarkdown('knowledge').map((name) => {
    const raw = safeRead(join(ROOT, 'knowledge', name)) ?? '';
    const frontmatter: Record<string, string> = {};
    let body = raw;
    const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
    if (match) {
      body = raw.slice(match[0].length);
      for (const line of match[1]!.split('\n')) {
        const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
        if (kv) frontmatter[kv[1]!] = kv[2]!.trim();
      }
    }
    return {
      slug: name.replace(/\.md$/, ''),
      id: frontmatter.id ?? name.replace(/\.md$/, ''),
      type: frontmatter.type ?? 'INSIGHT',
      confidence: frontmatter.confidence ?? '',
      body: body.trim(),
    };
  });
}

export interface ReportRef {
  slug: string;
  title: string;
}

export function readReports(): ReportRef[] {
  return listMarkdown('reports').map((name) => {
    const raw = safeRead(join(ROOT, 'reports', name)) ?? '';
    const heading = raw.split('\n').find((line) => line.startsWith('# '));
    return { slug: name.replace(/\.md$/, ''), title: heading?.replace(/^#\s*/, '') ?? name };
  });
}

/** Raw markdown of one report/finding, or null. Slug is filename-safe only. */
export function readDocument(kind: 'reports' | 'knowledge', slug: string): string | null {
  if (!/^[\w.-]+$/.test(slug)) return null;
  return safeRead(join(ROOT, kind, `${slug}.md`));
}
