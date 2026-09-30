/**
 * Objective: Push existing commits and create or update one open pull request.
 * Used: By the publish_pull_request tool.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitCommandError, runGitCommand } from '#bash-commands/git-command.ts';
import {
  GitHubCommandError,
  runGitHubCommand,
} from '#bash-commands/github-command.ts';
import {
  inspectRepository,
  isOpenPrContextReady,
  type OpenPrContext,
  type PullRequestSummary,
} from '#services/inspect-repository.ts';

export const PUBLISH_PULL_REQUEST_STATUS = {
  BLOCKED: 'blocked',
  CREATED: 'created',
  ERROR: 'error',
  PARTIAL: 'partial',
  UNCHANGED: 'unchanged',
  UPDATED: 'updated',
} as const;

export type PublishPullRequestStatus =
  (typeof PUBLISH_PULL_REQUEST_STATUS)[keyof typeof PUBLISH_PULL_REQUEST_STATUS];

export const PULL_REQUEST_TYPES = {
  BUGFIX: 'bugfix',
  FEATURE: 'feature',
  REFACTOR: 'refactor',
  DOCS: 'docs',
  CHORE: 'chore',
  PERFORMANCE: 'performance',
} as const;

export type ModifiedComponent = {
  name: string;
  files: readonly string[];
  natureOfChange: string;
};

export type PullRequestDescription = {
  problem: readonly string[];
  solution: readonly string[];
  prType: string;
  scope: readonly string[];
  breakingChanges: {
    hasBreakingChanges: boolean;
    description: string;
  };
  modifiedComponents: readonly ModifiedComponent[];
  environmentVariables: {
    added: readonly string[];
    modified: readonly string[];
    removed: readonly string[];
  };
  agentInstructions: {
    reviewFocus: string;
    dependenciesChanged: boolean;
    dbMigrationRequired: boolean;
    postMergeActions: readonly string[];
  };
};

export type PublishPullRequestInput = {
  cwd: string;
  title: string;
  description: PullRequestDescription;
};

export type PublishPullRequestResult = {
  status: PublishPullRequestStatus;
  message: string;
  gitPushExecuted: boolean;
  number?: number;
  url?: string;
};

type PullRequestDetails = PullRequestSummary & {
  body: string;
  state: string;
};

type PullRequestResponse = {
  number: number;
  title: string;
  state: string;
  url: string;
  body: string;
};

const isString = (value: unknown): value is string => String(value) === value;

type PullRequestResponseCandidate = {
  number?: unknown;
  title?: unknown;
  state?: unknown;
  url?: unknown;
  body?: unknown;
};

const isPullRequestResponseCandidate = (
  value: unknown,
): value is PullRequestResponseCandidate =>
  value instanceof Object && !Array.isArray(value);

function assertPullRequestResponse(
  value: unknown,
): asserts value is PullRequestResponse {
  if (
    !isPullRequestResponseCandidate(value) ||
    !Number.isFinite(value.number) ||
    !isString(value.title) ||
    !isString(value.state) ||
    !isString(value.url) ||
    !isString(value.body)
  ) {
    throw new Error('GitHub returned an invalid pull request.');
  }
}

type CreateTemporaryBodyFileInput = {
  body: string;
};

type TemporaryBodyFile = {
  directory: string;
  bodyPath: string;
};

const TITLE_PREFIXES = ['feat:', 'fix:', 'chore:'] as const;

const PULL_REQUEST_STATE = 'OPEN';

const SECTION_MARKER = '##';

const BULLET_MARKERS = ['- ', '* ', '+ '] as const;

const PULL_REQUEST_TEMPLATE_URL = new URL(
  '../templates/pull-request_template.md',
  import.meta.url,
);

const getCommandErrorMessage = (cause: unknown): string => {
  if (cause instanceof GitCommandError || cause instanceof GitHubCommandError) {
    return cause.stderr.trim() || cause.message;
  }

  if (cause instanceof Error) {
    return cause.message;
  }

  return 'Unknown command failure.';
};

function assertValidTitle(title: string): void {
  const prefix = TITLE_PREFIXES.find((candidate) =>
    title.startsWith(candidate),
  );

  if (!prefix || title.slice(prefix.length).trim() === '') {
    throw new Error(
      'The pull request title must start with feat:, fix:, or chore:.',
    );
  }
}

function assertValidBulletItems(
  section: string,
  items: readonly string[],
): void {
  if (items.length === 0) {
    throw new Error(`The ${section} section must contain at least one bullet.`);
  }

  for (const item of items) {
    if (!item.trim() || item !== item.trim()) {
      throw new Error(
        `The ${section} section contains an empty or padded bullet.`,
      );
    }

    if (
      item.includes('\n') ||
      item.includes('\r') ||
      item.includes(SECTION_MARKER)
    ) {
      throw new Error(`The ${section} section contains unsupported Markdown.`);
    }

    if (BULLET_MARKERS.some((marker) => item.startsWith(marker))) {
      throw new Error(`The ${section} section must contain plain bullet text.`);
    }
  }
}

type AssertStringListInput = {
  field: string;
  items: readonly string[];
  requireItems?: boolean;
};

function assertSingleLine(field: string, value: string): void {
  if (!value.trim() || value !== value.trim()) {
    throw new Error(`${field} must contain non-empty plain text.`);
  }

  if (value.includes('\n') || value.includes('\r')) {
    throw new Error(`${field} must contain a single line.`);
  }
}

function assertAllowedValue(
  field: string,
  value: string,
  allowedValues: readonly string[],
): void {
  if (!allowedValues.includes(value)) {
    throw new Error(`${field} contains an unsupported value: ${value}.`);
  }
}

function assertValidStringList({
  field,
  items,
  requireItems = false,
}: AssertStringListInput): void {
  if (requireItems && items.length === 0) {
    throw new Error(`${field} must contain at least one item.`);
  }

  for (const item of items) {
    assertSingleLine(field, item);
  }
}

const quoteYamlString = (value: string): string =>
  JSON.stringify(value) ?? '""';

const formatMarkdownBullets = (items: readonly string[]): string =>
  items.map((item) => `- ${item}`).join('\n');

type FormatYamlListInput = {
  items: readonly string[];
  indent: string;
};

const formatYamlListItems = ({ items, indent }: FormatYamlListInput): string =>
  items.length
    ? items.map((item) => `${indent}- ${quoteYamlString(item)}`).join('\n')
    : `${indent}[]`;

const formatYamlList = ({ items, indent }: FormatYamlListInput): string =>
  items.length ? `\n${formatYamlListItems({ items, indent })}` : ' []';

const formatModifiedComponents = (
  components: readonly ModifiedComponent[],
): string => {
  if (components.length === 0) {
    return ' []';
  }

  return `\n${components
    .map((component) =>
      [
        `  - name: ${quoteYamlString(component.name)}`,
        '    files:',
        formatYamlListItems({ items: component.files, indent: '      ' }),
        `    nature_of_change: ${quoteYamlString(component.natureOfChange)}`,
      ].join('\n'),
    )
    .join('\n')}`;
};

function assertValidDescription(description: PullRequestDescription): void {
  assertValidBulletItems('Problem', description.problem);
  assertValidBulletItems('Solution', description.solution);
  assertAllowedValue(
    'pr_type',
    description.prType,
    Object.values(PULL_REQUEST_TYPES),
  );
  assertValidStringList({
    field: 'scope',
    items: description.scope,
    requireItems: true,
  });
  assertSingleLine(
    'breaking_changes.description',
    description.breakingChanges.description,
  );

  for (const component of description.modifiedComponents) {
    assertSingleLine('modified_components.name', component.name);
    assertValidStringList({
      field: 'modified_components.files',
      items: component.files,
      requireItems: true,
    });
    assertSingleLine(
      'modified_components.nature_of_change',
      component.natureOfChange,
    );
  }

  assertValidStringList({
    field: 'environment_variables.added',
    items: description.environmentVariables.added,
  });
  assertValidStringList({
    field: 'environment_variables.modified',
    items: description.environmentVariables.modified,
  });
  assertValidStringList({
    field: 'environment_variables.removed',
    items: description.environmentVariables.removed,
  });
  assertSingleLine(
    'agent_instructions.review_focus',
    description.agentInstructions.reviewFocus,
  );
  assertValidStringList({
    field: 'agent_instructions.post_merge_actions',
    items: description.agentInstructions.postMergeActions,
  });
}

const buildPullRequestBody = async ({
  description,
}: Pick<PublishPullRequestInput, 'description'>): Promise<string> => {
  const template = await readFile(PULL_REQUEST_TEMPLATE_URL, 'utf8');

  const replacements = {
    problem: formatMarkdownBullets(description.problem),
    solution: formatMarkdownBullets(description.solution),
    pr_type: description.prType,
    scope: formatYamlList({
      items: description.scope,
      indent: '  ',
    }),
    has_breaking_changes: String(
      description.breakingChanges.hasBreakingChanges,
    ),
    breaking_changes_description: quoteYamlString(
      description.breakingChanges.description,
    ),
    modified_components: formatModifiedComponents(
      description.modifiedComponents,
    ),
    environment_variables_added: formatYamlList({
      items: description.environmentVariables.added,
      indent: '    ',
    }),
    environment_variables_modified: formatYamlList({
      items: description.environmentVariables.modified,
      indent: '    ',
    }),
    environment_variables_removed: formatYamlList({
      items: description.environmentVariables.removed,
      indent: '    ',
    }),
    review_focus: quoteYamlString(description.agentInstructions.reviewFocus),
    dependencies_changed: String(
      description.agentInstructions.dependenciesChanged,
    ),
    db_migration_required: String(
      description.agentInstructions.dbMigrationRequired,
    ),
    post_merge_actions: formatYamlList({
      items: description.agentInstructions.postMergeActions,
      indent: '    ',
    }),
  };

  const renderedTemplate = Object.entries(replacements).reduce(
    (body, [token, value]) => body.replaceAll(`{{${token}}}`, value),
    template,
  );

  if (renderedTemplate.includes('{{')) {
    throw new Error(
      'The pull request template contains unresolved placeholders.',
    );
  }

  return renderedTemplate;
};

const assertValidDraft = ({
  title,
  description,
}: Pick<PublishPullRequestInput, 'title' | 'description'>): void => {
  assertValidTitle(title);
  assertValidDescription(description);
};

const readPullRequest = async ({
  cwd,
  number,
}: {
  cwd: string;
  number?: number;
}): Promise<PullRequestDetails> => {
  const argumentsList = number
    ? ['pr', 'view', String(number), '--json', 'number,title,state,url,body']
    : ['pr', 'view', '--json', 'number,title,state,url,body'];

  const result = await runGitHubCommand({ arguments: argumentsList, cwd });

  const pullRequest: unknown = JSON.parse(result.stdout);
  assertPullRequestResponse(pullRequest);

  return {
    number: pullRequest.number,
    title: pullRequest.title,
    state: pullRequest.state,
    url: pullRequest.url,
    body: pullRequest.body,
  };
};

const createTemporaryBodyFile = async ({
  body,
}: CreateTemporaryBodyFileInput): Promise<TemporaryBodyFile> => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-open-github-pr-'));
  const bodyPath = join(directory, 'body.md');

  try {
    await writeFile(bodyPath, body, 'utf8');
  } catch (error) {
    await rm(directory, { force: true, recursive: true });
    throw error;
  }

  return {
    directory,
    bodyPath,
  };
};

const pushExistingCommits = async ({
  cwd,
  context,
}: {
  cwd: string;
  context: OpenPrContext & {
    branch: string;
    head: string;
  };
}): Promise<void> => {
  const pushArguments = context.upstream
    ? ['push']
    : ['push', '--set-upstream', 'origin', context.branch];

  await runGitCommand({ arguments: pushArguments, cwd });

  const [headResult, statusResult] = await Promise.all([
    runGitCommand({ arguments: ['rev-parse', 'HEAD'], cwd }),
    runGitCommand({
      arguments: ['status', '--porcelain=v1'],
      cwd,
      maxOutputChars: 1,
    }),
  ]);

  if (headResult.stdout.trim() !== context.head) {
    throw new Error('HEAD changed while pushing existing commits.');
  }

  if (statusResult.stdout !== '') {
    throw new Error('The worktree changed while pushing existing commits.');
  }
};

const createPullRequest = async ({
  cwd,
  context,
  title,
  bodyPath,
}: {
  cwd: string;
  context: OpenPrContext & { branch: string; baseBranch: string };
  title: string;
  bodyPath: string;
}): Promise<PullRequestDetails> => {
  await runGitHubCommand({
    arguments: [
      'pr',
      'create',
      '--base',
      context.baseBranch,
      '--head',
      context.branch,
      '--title',
      title,
      '--body-file',
      bodyPath,
    ],
    cwd,
  });

  return readPullRequest({ cwd });
};

const updatePullRequest = async ({
  cwd,
  number,
  title,
  bodyPath,
}: {
  cwd: string;
  number: number;
  title: string;
  bodyPath: string;
}): Promise<PullRequestDetails> => {
  await runGitHubCommand({
    arguments: [
      'pr',
      'edit',
      String(number),
      '--title',
      title,
      '--body-file',
      bodyPath,
    ],
    cwd,
  });

  return readPullRequest({ cwd, number });
};

const verifyPullRequest = async ({
  cwd,
  context,
  pullRequest,
  title,
  body,
}: {
  cwd: string;
  context: OpenPrContext & { head: string };
  pullRequest: PullRequestDetails;
  title: string;
  body: string;
}): Promise<void> => {
  if (pullRequest.state !== PULL_REQUEST_STATE) {
    throw new Error('The pull request is not open after the operation.');
  }

  if (pullRequest.title !== title || pullRequest.body !== body) {
    throw new Error(
      'The pull request content does not match the requested content.',
    );
  }

  const [headResult, statusResult] = await Promise.all([
    runGitCommand({ arguments: ['rev-parse', 'HEAD'], cwd }),
    runGitCommand({
      arguments: ['status', '--porcelain=v1'],
      cwd,
      maxOutputChars: 1,
    }),
  ]);

  if (headResult.stdout.trim() !== context.head) {
    throw new Error('HEAD changed while opening the pull request.');
  }

  if (statusResult.stdout !== '') {
    throw new Error(
      'The worktree is not clean after opening the pull request.',
    );
  }
};

const buildResult = ({
  status,
  message,
  gitPushExecuted,
  pullRequest,
}: {
  status: PublishPullRequestStatus;
  message: string;
  gitPushExecuted: boolean;
  pullRequest?: PullRequestDetails;
}): PublishPullRequestResult => ({
  status,
  message,
  gitPushExecuted,
  number: pullRequest?.number,
  url: pullRequest?.url,
});

type PublishPullRequestContentInput = {
  cwd: string;
  context: OpenPrContext & {
    branch: string;
    baseBranch: string;
    head: string;
  };
  title: string;
  body: string;
};

const publishPullRequestContent = async ({
  cwd,
  context,
  title,
  body,
}: PublishPullRequestContentInput): Promise<PublishPullRequestResult> => {
  try {
    const existingPullRequest = context.openPullRequests[0]
      ? await readPullRequest({
          cwd,
          number: context.openPullRequests[0].number,
        })
      : undefined;

    if (
      existingPullRequest &&
      existingPullRequest.title === title &&
      existingPullRequest.body === body &&
      existingPullRequest.state === PULL_REQUEST_STATE
    ) {
      await verifyPullRequest({
        cwd,
        context,
        pullRequest: existingPullRequest,
        title,
        body,
      });

      return buildResult({
        status: PUBLISH_PULL_REQUEST_STATUS.UNCHANGED,
        message: 'The pull request already has the requested content.',
        gitPushExecuted: context.pushRequired,
        pullRequest: existingPullRequest,
      });
    }

    const temporaryBodyFile = await createTemporaryBodyFile({ body });

    try {
      const pullRequest = existingPullRequest
        ? await updatePullRequest({
            cwd,
            number: existingPullRequest.number,
            title,
            bodyPath: temporaryBodyFile.bodyPath,
          })
        : await createPullRequest({
            cwd,
            context,
            title,
            bodyPath: temporaryBodyFile.bodyPath,
          });

      await verifyPullRequest({
        cwd,
        context,
        pullRequest,
        title,
        body,
      });

      return buildResult({
        status: existingPullRequest
          ? PUBLISH_PULL_REQUEST_STATUS.UPDATED
          : PUBLISH_PULL_REQUEST_STATUS.CREATED,
        message: existingPullRequest
          ? 'The pull request was updated.'
          : 'The pull request was created.',
        gitPushExecuted: context.pushRequired,
        pullRequest,
      });
    } finally {
      await rm(temporaryBodyFile.directory, {
        force: true,
        recursive: true,
      });
    }
  } catch (error) {
    return buildResult({
      status: context.pushRequired
        ? PUBLISH_PULL_REQUEST_STATUS.PARTIAL
        : PUBLISH_PULL_REQUEST_STATUS.ERROR,
      message: getCommandErrorMessage(error),
      gitPushExecuted: context.pushRequired,
    });
  }
};

export const publishPullRequest = async ({
  cwd,
  title,
  description,
}: PublishPullRequestInput): Promise<PublishPullRequestResult> => {
  try {
    assertValidDraft({ title, description });
  } catch (error) {
    return buildResult({
      status: PUBLISH_PULL_REQUEST_STATUS.BLOCKED,
      message:
        error instanceof Error
          ? error.message
          : 'The pull request draft is invalid.',
      gitPushExecuted: false,
    });
  }

  const context = await inspectRepository({ cwd });

  if (!isOpenPrContextReady(context)) {
    return buildResult({
      status: PUBLISH_PULL_REQUEST_STATUS.BLOCKED,
      message:
        context.message ??
        'The repository is not ready for an open pull request.',
      gitPushExecuted: false,
    });
  }

  try {
    const body = await buildPullRequestBody({ description });

    if (context.pushRequired) {
      await pushExistingCommits({ cwd, context });
    }

    return await publishPullRequestContent({
      cwd,
      context,
      title,
      body,
    });
  } catch (error) {
    return buildResult({
      status: PUBLISH_PULL_REQUEST_STATUS.ERROR,
      message: getCommandErrorMessage(error),
      gitPushExecuted: false,
    });
  }
};
