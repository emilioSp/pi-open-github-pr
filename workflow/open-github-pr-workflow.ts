/**
 * Objective: Own the open-github-pr workflow, guard, and TUI status.
 * Used: By the open-github-pr extension during workflow activation and cleanup.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';

import { gitCommandBashGuard } from '#guards/git-command-bash-guard.ts';

const OPEN_GITHUB_PR_STATUS_KEY = 'open-github-pr';
const OPEN_GITHUB_PR_STATUS_TEXT = '● open-github-pr: active';

class OpenGithubPrWorkflow {
  private workflowActive = false;

  public isWorkflowActive(): boolean {
    return this.workflowActive;
  }

  public activate(pi: ExtensionAPI, ctx: ExtensionContext): boolean {
    if (this.isWorkflowActive()) {
      ctx.ui.notify('An open-github-pr workflow is already active.', 'warning');
      return false; // We don't activate it, because it's already active
    }

    if (!ctx.isIdle()) {
      ctx.ui.notify(
        'Wait for the current agent turn to finish before starting open-github-pr.',
        'warning',
      );
      return this.workflowActive;
    }

    this.workflowActive = true;
    gitCommandBashGuard.activate(pi);
    this.setTuiStatusBar(ctx);
    return this.workflowActive;
  }

  public deactivate(ctx: ExtensionContext): boolean {
    if (!this.isWorkflowActive()) return this.isWorkflowActive();

    this.workflowActive = false;
    gitCommandBashGuard.deactivate();
    this.setTuiStatusBar(ctx);
    return this.workflowActive;
  }

  public setTuiStatusBar(ctx: ExtensionContext): void {
    if (ctx.mode !== 'tui') {
      return;
    }

    const text = this.workflowActive ? OPEN_GITHUB_PR_STATUS_TEXT : undefined;
    const styledText = text ? ctx.ui.theme.fg('accent', text) : undefined;
    ctx.ui.setStatus(OPEN_GITHUB_PR_STATUS_KEY, styledText);
  }
}

export const openGithubPrWorkflow = new OpenGithubPrWorkflow();
