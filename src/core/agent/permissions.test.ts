import { describe, expect, it } from 'vitest';

import { buildPermissionArgs, RESEARCH_AGENT_PROFILE } from './permissions';
import { RESEARCH_AGENT_SYSTEM_PROMPT } from './system-prompt';

describe('research agent permission profile', () => {
  it('grants write access only inside research/', () => {
    const writeRules = RESEARCH_AGENT_PROFILE.allowedTools.filter((rule) => /^(Write|Edit)\(/.test(rule));
    expect(writeRules.length).toBeGreaterThan(0);
    for (const rule of writeRules) {
      expect(rule).toMatch(/^(Write|Edit)\(research\//);
    }
  });

  it('keeps the sensitive surface explicitly denied', () => {
    for (const rule of ['Bash(git push:*)', 'Bash(pnpm db:*)', 'Write(src/**)', 'Edit(.env*)']) {
      expect(RESEARCH_AGENT_PROFILE.disallowedTools).toContain(rule);
    }
  });

  it('never allows a Bash rule outside the research toolchain', () => {
    const bashRules = RESEARCH_AGENT_PROFILE.allowedTools.filter((rule) => rule.startsWith('Bash('));
    for (const rule of bashRules) {
      expect(rule).toMatch(
        /^Bash\((pnpm (tsx scripts\/|tsx research\/scripts\/|strategy:run|vitest|lint)|npx tsc --noEmit)/
      );
    }
  });

  it('builds --allowedTools/--disallowedTools CLI args', () => {
    const args = buildPermissionArgs(RESEARCH_AGENT_PROFILE);
    expect(args[0]).toBe('--allowedTools');
    expect(args[1]).toContain('Write(research/**)');
    expect(args[2]).toBe('--disallowedTools');
    expect(args[3]).toContain('Bash(git push:*)');
  });
});

describe('research agent system prompt', () => {
  it('states the methodology gates and boundaries', () => {
    expect(RESEARCH_AGENT_SYSTEM_PROMPT).toMatch(/kill criteria/i);
    expect(RESEARCH_AGENT_SYSTEM_PROMPT).toMatch(/permutation/i);
    expect(RESEARCH_AGENT_SYSTEM_PROMPT).toMatch(/net of costs/i);
    expect(RESEARCH_AGENT_SYSTEM_PROMPT).toMatch(/write only inside research/i);
    expect(RESEARCH_AGENT_SYSTEM_PROMPT).toMatch(/never place real trades/i);
    expect(RESEARCH_AGENT_SYSTEM_PROMPT).toMatch(/two-stage gate/i);
    expect(RESEARCH_AGENT_SYSTEM_PROMPT).toMatch(/never author numbers/i);
    expect(RESEARCH_AGENT_SYSTEM_PROMPT).toMatch(/ledger/i);
  });

  it('references only public codebase paths', () => {
    expect(RESEARCH_AGENT_SYSTEM_PROMPT).toContain('src/core/research/event-study.ts');
    expect(RESEARCH_AGENT_SYSTEM_PROMPT).not.toMatch(/echo|aurora|vers|glider/i);
  });
});
