/**
 * The research agent's permission profile — "hands with boundaries".
 *
 * In headless mode the allow-list IS the capability surface: everything not
 * allowed is denied by default, and the explicit deny-list wins over allows.
 * The profile encodes the trust model from docs/agent-setup.md:
 * write research/** only, run the research toolchain only, never touch git
 * state, the database schema, source code, or environment files.
 */

import type { AgentPermissionProfile } from './types';

export const RESEARCH_AGENT_PROFILE: AgentPermissionProfile = {
  allowedTools: [
    'Write(research/**)',
    'Edit(research/**)',
    'Bash(pnpm tsx scripts/:*)',
    'Bash(pnpm tsx research/scripts/:*)',
    'Bash(pnpm strategy:run:*)',
    'Bash(pnpm vitest:*)',
    'Bash(pnpm lint:*)',
    'Bash(npx tsc --noEmit:*)',
  ],
  disallowedTools: [
    'Bash(git push:*)',
    'Bash(git commit:*)',
    'Bash(git reset:*)',
    'Bash(rm:*)',
    'Bash(pnpm db:*)',
    'Bash(npx drizzle-kit:*)',
    'Write(src/**)',
    'Edit(src/**)',
    'Write(drizzle/**)',
    'Edit(drizzle/**)',
    'Write(.env*)',
    'Edit(.env*)',
  ],
};

/** CLI arguments for `claude` encoding the profile. */
export function buildPermissionArgs(profile: AgentPermissionProfile): string[] {
  return [
    '--allowedTools',
    profile.allowedTools.join(','),
    '--disallowedTools',
    profile.disallowedTools.join(','),
  ];
}
