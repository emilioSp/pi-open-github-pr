/**
 * Objective: Verify that the open-github-pr guard blocks agent Bash commands.
 * Used: By the test suite.
 */

import { describe, expect, it } from 'vitest';

import { gitCommandBashGuard } from '#guards/git-command-bash-guard.ts';

describe('Bash guard', () => {
  it('blocks all Bash commands', async () => {
    let handler: ((event: unknown) => unknown) | undefined;
    const pi = {
      on: (_event: string, callback: (event: unknown) => unknown) => {
        handler = callback;
        return () => undefined;
      },
    };

    gitCommandBashGuard.activate(pi as never);

    const result = await handler?.({
      type: 'tool_call',
      toolCallId: 'test',
      toolName: 'bash',
      input: { command: 'git status --short --branch' },
    });

    gitCommandBashGuard.deactivate();

    expect(result).toMatchObject({ block: true, terminate: true });
  });

  it('allows non-Bash tool calls', async () => {
    let handler: ((event: unknown) => unknown) | undefined;
    const pi = {
      on: (_event: string, callback: (event: unknown) => unknown) => {
        handler = callback;
        return () => undefined;
      },
    };

    gitCommandBashGuard.activate(pi as never);

    const result = await handler?.({
      type: 'tool_call',
      toolCallId: 'test',
      toolName: 'read',
      input: { path: 'README.md', offset: 1, limit: 10 },
    });

    gitCommandBashGuard.deactivate();

    expect(result).toBeUndefined();
  });
});
