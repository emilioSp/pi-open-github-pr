/**
 * Objective: Register the open-github-pr command, tools, status, and workflow guard.
 * Used: As the Pi extension entry point for the open-github-pr package.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { defineInspectRepositoryBeforePrTool } from '#tools/inspect-repository-before-pr.ts';
import { definePublishPullRequestTool } from '#tools/publish-pull-request.ts';
import { openGithubPrWorkflow } from '#workflow/open-github-pr-workflow.ts';

export default function openGithubPrExtension(pi: ExtensionAPI): void {
  pi.registerTool(defineInspectRepositoryBeforePrTool());
  pi.registerTool(definePublishPullRequestTool());

  pi.registerCommand('open-github-pr', {
    description: 'Open or update a pull request for the current branch',
    handler: async (args, ctx) => {
      const active = openGithubPrWorkflow.activate(pi, ctx);
      if (!active) return;

      const workflowPrompt = `Run the open-github-pr workflow for the current checkout.
First call inspect-repository-before-pr.
If it is blocked, stop and explain the exact reason.
Read the returned committed diff and prepare a concise English title and description.
Choose the appropriate feat:, fix:, or chore: title prefix from the committed diff.
After the draft is ready, fill the template and call publish_pull_request.
Use the dedicated open-github-pr tools for the workflow operations.
After this workflow ends, normal Git and GitHub operations are allowed again.${args.trim() ? `\nAdditional user context:\n${args.trim()}` : ''}`;

      pi.sendUserMessage(workflowPrompt, { expandPromptTemplates: false });
    },
  });

  // Keep the workflow guard active until Pi has fully settled the agent run.
  // `agent_settled` is the final lifecycle event, so cleanup here protects the complete
  // workflow without keeping the guard active after Pi has finished.
  pi.on('agent_settled', (_event, ctx) => {
    openGithubPrWorkflow.deactivate(ctx);
  });

  pi.on('session_shutdown', (_event, ctx) => {
    openGithubPrWorkflow.deactivate(ctx);
  });
}
