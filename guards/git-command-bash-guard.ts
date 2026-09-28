/**
 * Objective: Block all agent Bash commands during the open-github-pr workflow.
 * Used: Only while the /open-github-pr workflow is running.
 */

import {
  type ExtensionAPI,
  isToolCallEventType,
  type ToolCallEvent,
} from '@earendil-works/pi-coding-agent';

const blockBashCommand = (event: ToolCallEvent) => {
  if (!isToolCallEventType('bash', event)) {
    return undefined;
  }

  return {
    block: true,
    terminate: true,
    reason:
      'Bash is blocked by the open-github-pr workflow. Use the dedicated open-github-pr tools.',
  };
};

class GitCommandBashGuard {
  private unsubscribe: (() => void) | undefined;

  public activate(pi: ExtensionAPI): void {
    this.deactivate();
    this.unsubscribe = pi.on('tool_call', blockBashCommand);
  }

  public deactivate(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}

export const gitCommandBashGuard = new GitCommandBashGuard();
