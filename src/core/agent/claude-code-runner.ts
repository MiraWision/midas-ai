/**
 * Claude Code adapter for the AgentRunner contract.
 *
 * Spawns the `claude` CLI headless (--print, stream-json) with the permission
 * profile encoded as --allowedTools/--disallowedTools. Requires Claude Code
 * to be installed and authenticated on the host (see docs/agent-setup.md);
 * nothing here handles credentials.
 */

import { spawn } from 'node:child_process';

import { buildPermissionArgs } from './permissions';
import type { AgentRunOptions, AgentRunResult, AgentRunner, AgentStreamEvent } from './types';

/** Generous default — only exists to reap a genuinely hung process. */
const DEFAULT_TIMEOUT_MS = 600_000;

interface SpawnOutcome {
  result: string;
  accumulated: string;
  stderr: string;
  code: number | null;
  isError: boolean;
}

function toolStatus(name: string, input: Record<string, unknown> | undefined): string {
  const file = typeof input?.file_path === 'string' ? String(input.file_path).split('/').pop() : undefined;
  switch (name) {
    case 'Read':
      return file ? `Reading ${file}` : 'Reading a file';
    case 'Edit':
    case 'Write':
      return file ? `Editing ${file}` : 'Editing a file';
    case 'Bash':
      return 'Running command';
    case 'Grep':
    case 'Glob':
      return 'Searching code';
    default:
      return `Working… (${name})`;
  }
}

function handleEvent(
  evt: Record<string, unknown>,
  onEvent: (event: AgentStreamEvent) => void,
  onText: (text: string) => void
): { result?: string; isError?: boolean } {
  const type = evt.type;

  if (type === 'stream_event') {
    const inner = evt.event as Record<string, unknown> | undefined;
    if (inner?.type === 'content_block_delta') {
      const delta = inner.delta as Record<string, unknown> | undefined;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        onText(delta.text);
        onEvent({ type: 'text', text: delta.text });
      }
    }
    return {};
  }

  if (type === 'assistant') {
    const message = evt.message as Record<string, unknown> | undefined;
    const content = Array.isArray(message?.content) ? (message.content as Array<Record<string, unknown>>) : [];
    for (const block of content) {
      if (block.type === 'tool_use' && typeof block.name === 'string') {
        onEvent({ type: 'status', status: toolStatus(block.name, block.input as Record<string, unknown>) });
      }
    }
    return {};
  }

  if (type === 'result') {
    return {
      result: typeof evt.result === 'string' ? evt.result : '',
      isError: evt.is_error === true,
    };
  }

  return {};
}

function spawnClaude(
  args: string[],
  cwd: string,
  message: string,
  timeoutMs: number,
  onEvent: (event: AgentStreamEvent) => void
): Promise<SpawnOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    });

    let buffer = '';
    let accumulated = '';
    let result = '';
    let stderr = '';
    let isError = false;

    const processLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let evt: Record<string, unknown>;
      try {
        evt = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        return;
      }
      const out = handleEvent(evt, onEvent, (text) => {
        accumulated += text;
      });
      if (out.result !== undefined) result = out.result;
      if (out.isError !== undefined) isError = out.isError;
    };

    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        processLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (buffer.trim()) processLine(buffer);
      resolve({ result, accumulated, stderr, code, isError });
    });

    child.stdin?.write(message);
    child.stdin?.end();
  });
}

export class ClaudeCodeRunner implements AgentRunner {
  readonly id = 'claude-code';

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const onEvent = options.onEvent ?? (() => {});

    const buildArgs = (flag: '--session-id' | '--resume'): string[] => {
      const args = [
        '--print',
        '--model',
        options.model,
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
        ...buildPermissionArgs(options.permissions),
      ];
      if (options.maxBudgetUsd && options.maxBudgetUsd > 0) {
        args.push('--max-budget-usd', String(options.maxBudgetUsd));
      }
      if (options.systemPrompt?.trim()) args.push('--append-system-prompt', options.systemPrompt);
      args.push(flag, options.sessionId);
      return args;
    };

    let outcome = await spawnClaude(
      buildArgs(options.isFirst ? '--session-id' : '--resume'),
      options.cwd,
      options.message,
      timeoutMs,
      onEvent
    );

    // Resume fallback: session unknown to this claude install → start fresh.
    if (!options.isFirst && outcome.code !== 0 && /No conversation found/i.test(outcome.stderr)) {
      outcome = await spawnClaude(buildArgs('--session-id'), options.cwd, options.message, timeoutMs, onEvent);
    }

    const content = outcome.result || outcome.accumulated;
    if (outcome.isError || (outcome.code !== 0 && !content.trim())) {
      const detail = outcome.result.trim() || outcome.stderr.trim() || `claude exited with code ${outcome.code}`;
      throw new Error(detail);
    }

    return { content, durationMs: Date.now() - startTime, exitCode: outcome.code };
  }
}
