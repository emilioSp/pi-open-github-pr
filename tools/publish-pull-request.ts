/**
 * Objective: Expose the pull request publishing service as a Pi tool.
 * Used: By the open-github-pr command after repository inspection.
 */

import { Type } from '@earendil-works/pi-ai';
import { defineTool } from '@earendil-works/pi-coding-agent';

import {
  PUBLISH_PULL_REQUEST_STATUS,
  type PublishPullRequestResult,
  publishPullRequest,
} from '#services/publish-pull-request.ts';
import { openGithubPrWorkflow } from '#workflow/open-github-pr-workflow.ts';

const formatPublishResult = (result: PublishPullRequestResult): string => {
  const lines = [
    `Status: ${result.status}`,
    `Message: ${result.message}`,
    `Git push executed: ${result.gitPushExecuted ? 'yes' : 'no'}`,
    result.number ? `Pull request: #${result.number}` : undefined,
    result.url ? `URL: ${result.url}` : undefined,
  ];

  return lines.filter((line): line is string => Boolean(line)).join('\n');
};

export const definePublishPullRequestTool = () =>
  defineTool({
    name: 'publish_pull_request',
    label: 'Publish pull request',
    description:
      'Push existing commits when necessary, then create or update the open pull request. Use only after inspect-repository-before-pr. This tool never creates commits or changes repository files.',
    promptSnippet: 'Create or update the current branch pull request',
    promptGuidelines: [
      'Use concise English text by default.',
      'The title must start with feat:, fix:, or chore:.',
      'Fill all fields in the pull request description template.',
    ],
    parameters: Type.Object({
      title: Type.String({
        description: 'A concise PR title with feat:, fix:, or chore:.',
      }),
      description: Type.Object({
        problem: Type.Array(Type.String(), {
          description: 'Problem section bullet text.',
          minItems: 1,
        }),
        solution: Type.Array(Type.String(), {
          description: 'Solution section bullet text.',
          minItems: 1,
        }),
        pr_type: Type.String({
          description:
            'PR type: bugfix, feature, refactor, docs, chore, or performance.',
        }),
        scope: Type.Array(Type.String(), {
          description: 'Free-form scope labels.',
          minItems: 1,
        }),
        breaking_changes: Type.Object({
          has_breaking_changes: Type.Boolean(),
          description: Type.String({
            description: 'Migration or compatibility notes, or None.',
          }),
        }),
        modified_components: Type.Array(
          Type.Object({
            name: Type.String(),
            files: Type.Array(Type.String(), { minItems: 1 }),
            nature_of_change: Type.String(),
          }),
        ),
        environment_variables: Type.Object({
          added: Type.Array(Type.String()),
          modified: Type.Array(Type.String()),
          removed: Type.Array(Type.String()),
        }),
        agent_instructions: Type.Object({
          review_focus: Type.String(),
          dependencies_changed: Type.Boolean(),
          db_migration_required: Type.Boolean(),
          post_merge_actions: Type.Array(Type.String()),
        }),
      }),
    }),
    executionMode: 'sequential',
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!openGithubPrWorkflow.isWorkflowActive()) {
        const result: PublishPullRequestResult = {
          status: PUBLISH_PULL_REQUEST_STATUS.BLOCKED,
          message: 'The /open-github-pr workflow is not active.',
          gitPushExecuted: false,
        };

        return {
          content: [{ type: 'text', text: formatPublishResult(result) }],
          details: result,
        };
      }

      const result = await publishPullRequest({
        cwd: ctx.cwd,
        title: params.title,
        description: {
          problem: params.description.problem,
          solution: params.description.solution,
          prType: params.description.pr_type,
          scope: params.description.scope,
          breakingChanges: {
            hasBreakingChanges:
              params.description.breaking_changes.has_breaking_changes,
            description: params.description.breaking_changes.description,
          },
          modifiedComponents: params.description.modified_components.map(
            (component) => ({
              name: component.name,
              files: component.files,
              natureOfChange: component.nature_of_change,
            }),
          ),
          environmentVariables: {
            added: params.description.environment_variables.added,
            modified: params.description.environment_variables.modified,
            removed: params.description.environment_variables.removed,
          },
          agentInstructions: {
            reviewFocus: params.description.agent_instructions.review_focus,
            dependenciesChanged:
              params.description.agent_instructions.dependencies_changed,
            dbMigrationRequired:
              params.description.agent_instructions.db_migration_required,
            postMergeActions:
              params.description.agent_instructions.post_merge_actions,
          },
        },
      });

      return {
        content: [{ type: 'text', text: formatPublishResult(result) }],
        details: result,
      };
    },
  });
