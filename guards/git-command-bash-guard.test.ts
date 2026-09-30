/**
 * Objective: Verify that the open-github-pr guard blocks agent Bash commands.
 * Used: By the test suite.
 */

import type {
  ExtensionAPI,
  ToolCallEvent,
  ToolCallEventResult,
} from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';

import { gitCommandBashGuard } from '#guards/git-command-bash-guard.ts';

type ToolCallHandler = (
  event: ToolCallEvent,
) => ToolCallEventResult | undefined;

describe('Bash guard', () => {
  it('blocks all Bash commands', async () => {
    let handler: ToolCallHandler | undefined;

    const pi = {
      on: (_event: 'tool_call', callback: ToolCallHandler) => {
        handler = callback;

        return () => undefined;
      },
    };

    // JUSTIFICATION: The test mock implements the ExtensionAPI method used by the guard.
    gitCommandBashGuard.activate(pi as ExtensionAPI);

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
    let handler: ToolCallHandler | undefined;

    const pi = {
      on: (_event: 'tool_call', callback: ToolCallHandler) => {
        handler = callback;

        return () => undefined;
      },
    };

    // JUSTIFICATION: The test mock implements the ExtensionAPI method used by the guard.
    gitCommandBashGuard.activate(pi as ExtensionAPI);

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
