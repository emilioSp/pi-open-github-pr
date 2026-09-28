/**
 * Objective: Verify that invalid pull request drafts are rejected before commands run.
 * Used: By the test suite.
 */

import { describe, expect, it } from 'vitest';

import {
  PUBLISH_PULL_REQUEST_STATUS,
  publishPullRequest,
} from '#services/publish-pull-request.ts';

describe('publish pull request', () => {
  it('rejects a title without an allowed prefix', async () => {
    const result = await publishPullRequest({
      cwd: process.cwd(),
      title: 'docs: update the guide',
      description: {
        problem: ['The guide is incomplete.'],
        solution: ['The guide is updated.'],
        prType: 'docs',
        scope: ['core'],
        breakingChanges: {
          hasBreakingChanges: false,
          description: 'None',
        },
        modifiedComponents: [],
        environmentVariables: {
          added: [],
          modified: [],
          removed: [],
        },
        agentInstructions: {
          reviewFocus: 'Review the guide wording.',
          dependenciesChanged: false,
          dbMigrationRequired: false,
          postMergeActions: [],
        },
      },
    });

    expect(result.status).toBe(PUBLISH_PULL_REQUEST_STATUS.BLOCKED);
    expect(result.gitPushExecuted).toBe(false);
  });

  it('rejects Markdown headings inside problem bullet text', async () => {
    const result = await publishPullRequest({
      cwd: process.cwd(),
      title: 'chore: update the guide',
      description: {
        problem: ['## Extra section'],
        solution: ['The guide is updated.'],
        prType: 'chore',
        scope: ['core'],
        breakingChanges: {
          hasBreakingChanges: false,
          description: 'None',
        },
        modifiedComponents: [],
        environmentVariables: {
          added: [],
          modified: [],
          removed: [],
        },
        agentInstructions: {
          reviewFocus: 'Review the guide wording.',
          dependenciesChanged: false,
          dbMigrationRequired: false,
          postMergeActions: [],
        },
      },
    });

    expect(result.status).toBe(PUBLISH_PULL_REQUEST_STATUS.BLOCKED);
    expect(result.gitPushExecuted).toBe(false);
  });
});
