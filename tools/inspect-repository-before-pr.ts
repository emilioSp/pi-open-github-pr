/**
 * Objective: Expose the repository inspection service as a Pi tool.
 * Used: By the open-github-pr command before any publishing operation.
 */

import { Type } from '@earendil-works/pi-ai';
import { defineTool } from '@earendil-works/pi-coding-agent';

import {
  inspectRepository,
  type OpenPrContext,
} from '#services/inspect-repository.ts';
import { openGithubPrWorkflow } from '#workflow/open-github-pr-workflow.ts';

const INACTIVE_CONTEXT: OpenPrContext = {
  status: 'blocked',
  message: 'Start the workflow with /open-github-pr.',
  worktreeClean: false,
  diffStat: '',
  diff: '',
  diffTruncated: false,
  openPullRequests: [],
  ahead: 0,
  behind: 0,
  remoteState: 'no-upstream',
  pushRequired: false,
};

const formatContext = (context: OpenPrContext): string => {
  const lines = [
    `Status: ${context.status}`,
    context.message ? `Message: ${context.message}` : undefined,
    context.repository ? `Repository: ${context.repository}` : undefined,
    context.branch ? `Branch: ${context.branch}` : undefined,
    context.baseBranch ? `Base branch: ${context.baseBranch}` : undefined,
    context.worktreeClean ? 'Worktree: clean' : 'Worktree: dirty',
    `Push required: ${context.pushRequired ? 'yes' : 'no'}`,
    `Open pull requests: ${context.openPullRequests.length}`,
    context.diffStat ? `Committed changes:\n${context.diffStat}` : undefined,
    context.diff ? `Diff:\n${context.diff}` : undefined,
  ];

  return lines.filter((line): line is string => Boolean(line)).join('\n');
};

export const defineInspectRepositoryBeforePrTool = () =>
  defineTool({
    name: 'inspect-repository-before-pr',
    label: 'Inspect repository before PR',
    description:
      'Inspect the current checkout before opening a pull request. Call this before publishing. This tool never changes Git or GitHub state.',
    promptSnippet:
      'Inspect the current repository before opening a pull request',
    promptGuidelines: [
      'Call inspect-repository-before-pr before publish_pull_request.',
      'If the result is blocked, stop and explain the reason to the user.',
    ],
    parameters: Type.Object({}),
    executionMode: 'sequential',
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const context = openGithubPrWorkflow.isWorkflowActive()
        ? await inspectRepository({ cwd: ctx.cwd })
        : INACTIVE_CONTEXT;

      return {
        content: [{ type: 'text', text: formatContext(context) }],
        details: context,
      };
    },
  });
