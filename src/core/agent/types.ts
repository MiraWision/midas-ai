/**
 * Agent-on-rails contracts.
 *
 * The platform can run a coding agent (e.g. Claude Code) as an autonomous
 * researcher. The design premise: an agent's honesty is enforced by the
 * HARNESS, not by trusting the model — write access is scoped to the research
 * workspace, runnable commands are allow-listed, spend is capped, and every
 * number in a finding must come from re-runnable script output.
 *
 * The runner implementation lands in a later release; these types are the
 * stable contract adapters should build against.
 */

export interface AgentPermissionProfile {
  /** Tool rules the agent may use, e.g. "Write(research/**)". */
  allowedTools: string[];
  /** Explicit denials that win over allows, e.g. "Bash(git push:*)". */
  disallowedTools: string[];
}

export interface AgentRunOptions {
  /** Conversation id — stable across resumes. */
  sessionId: string;
  message: string;
  model: string;
  /** Working directory (the self-hosted project root). */
  cwd: string;
  isFirst: boolean;
  systemPrompt?: string;
  permissions: AgentPermissionProfile;
  /** Hard USD spend cap for a headless run. */
  maxBudgetUsd?: number;
  /** Wall-clock ceiling; research iterations legitimately run long. */
  timeoutMs?: number;
  onEvent?: (event: AgentStreamEvent) => void;
}

export interface AgentStreamEvent {
  type: 'text' | 'status';
  text?: string;
  status?: string;
}

export interface AgentRunResult {
  content: string;
  durationMs: number;
  exitCode: number | null;
}

export interface AgentRunner {
  readonly id: string;
  run(options: AgentRunOptions): Promise<AgentRunResult>;
}
