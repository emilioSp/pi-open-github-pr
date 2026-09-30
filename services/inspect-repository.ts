/**
 * Objective: Inspect the current repository for the open-github-pr workflow.
 * Used: By the inspect-repository-before-pr tool and the publish workflow.
 */

import { GitCommandError, runGitCommand } from '#bash-commands/git-command.ts';
import {
  GitHubCommandError,
  runGitHubCommand,
} from '#bash-commands/github-command.ts';

export const OPEN_PR_CONTEXT_STATUS = {
  BLOCKED: 'blocked',
  READY: 'ready',
} as const;

export const OPEN_PR_BLOCK_REASONS = {
  BASE_REF_UNAVAILABLE: 'base-ref-unavailable',
  DETACHED_HEAD: 'detached-head',
  DIVERGED_BRANCH: 'diverged-branch',
  DIRTY_WORKTREE: 'dirty-worktree',
  EMPTY_DIFF: 'empty-diff',
  NO_ORIGIN: 'missing-origin',
  NOT_REPOSITORY: 'not-a-repository',
  REMOTE_AHEAD: 'remote-ahead',
  COMMAND_FAILED: 'command-failed',
} as const;

export type OpenPrBlockReason =
  (typeof OPEN_PR_BLOCK_REASONS)[keyof typeof OPEN_PR_BLOCK_REASONS];

export type PullRequestSummary = {
  number: number;
  title: string;
  url: string;
};

export const OPEN_PR_REMOTE_STATES = {
  AHEAD: 'ahead',
  DIVERGED: 'diverged',
  NO_UPSTREAM: 'no-upstream',
  BEHIND: 'behind',
  UP_TO_DATE: 'up-to-date',
} as const;

export type OpenPrRemoteState =
  (typeof OPEN_PR_REMOTE_STATES)[keyof typeof OPEN_PR_REMOTE_STATES];

export type OpenPrContext = {
  status: (typeof OPEN_PR_CONTEXT_STATUS)[keyof typeof OPEN_PR_CONTEXT_STATUS];
  reason?: OpenPrBlockReason;
  message?: string;
  repository?: string;
  branch?: string;
  baseBranch?: string;
  baseRef?: string;
  head?: string;
  worktreeClean: boolean;
  diffStat: string;
  diff: string;
  diffTruncated: boolean;
  openPullRequests: readonly PullRequestSummary[];
  upstream?: string;
  ahead: number;
  behind: number;
  remoteState: OpenPrRemoteState;
  pushRequired: boolean;
};

type RepositoryMetadata = {
  nameWithOwner: string;
  defaultBranch: string;
};

type RemoteDistance = {
  upstream: string | undefined;
  ahead: number;
  behind: number;
  remoteState: OpenPrRemoteState;
  pushRequired: boolean;
};

type DiffOutput = {
  text: string;
  truncated: boolean;
};

type FormatDiffOutputInput = DiffOutput & {
  truncationMarker: string;
};

// Keep model-facing diff output bounded to protect context and transcript size.
const MAX_DIFF_CHARS = 120_000;

const EMPTY_TEXT = '';

const formatDiffOutput = ({
  text,
  truncated,
  truncationMarker,
}: FormatDiffOutputInput): DiffOutput => ({
  text: truncated ? `${text}\n\n[${truncationMarker} truncated]` : text,
  truncated,
});

const isGitCommandFailure = (error: unknown): error is GitCommandError =>
  error instanceof GitCommandError && error.code === 'command-failed';

const getErrorMessage = (error: unknown): string => {
  if (error instanceof GitCommandError || error instanceof GitHubCommandError) {
    return error.stderr.trim() || error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown command failure.';
};

const readRepositoryMetadata = async ({
  cwd,
}: {
  cwd: string;
}): Promise<RepositoryMetadata> => {
  const result = await runGitHubCommand({
    arguments: ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef'],
    cwd,
  });

  const metadata = JSON.parse(result.stdout) as {
    nameWithOwner?: unknown;
    defaultBranchRef?: { name?: unknown };
  };

  if (
    typeof metadata.nameWithOwner !== 'string' ||
    typeof metadata.defaultBranchRef?.name !== 'string'
  ) {
    throw new Error('GitHub repository metadata is incomplete.');
  }

  return {
    nameWithOwner: metadata.nameWithOwner,
    defaultBranch: metadata.defaultBranchRef.name,
  };
};

const readOpenPullRequests = async ({
  cwd,
  branch,
}: {
  cwd: string;
  branch: string;
}): Promise<PullRequestSummary[]> => {
  const result = await runGitHubCommand({
    arguments: [
      'pr',
      'list',
      '--head',
      branch,
      '--state',
      'open',
      '--json',
      'number,title,url',
    ],
    cwd,
  });

  const pullRequests = JSON.parse(result.stdout) as unknown;

  if (!Array.isArray(pullRequests)) {
    throw new Error('GitHub returned an invalid pull request list.');
  }

  return pullRequests.map((value) => {
    const pullRequest = value as {
      number?: unknown;
      title?: unknown;
      url?: unknown;
    };

    if (
      typeof pullRequest.number !== 'number' ||
      typeof pullRequest.title !== 'string' ||
      typeof pullRequest.url !== 'string'
    ) {
      throw new Error('GitHub returned an invalid pull request.');
    }

    return {
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
    };
  });
};

const readOptionalUpstream = async ({
  cwd,
}: {
  cwd: string;
}): Promise<string | undefined> => {
  try {
    const result = await runGitCommand({
      arguments: ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      cwd,
    });

    const upstream = result.stdout.trim();

    return upstream || undefined;
  } catch (error) {
    if (isGitCommandFailure(error)) {
      return undefined;
    }

    throw error;
  }
};

const readRemoteDistance = async ({
  cwd,
}: {
  cwd: string;
}): Promise<RemoteDistance> => {
  const upstream = await readOptionalUpstream({ cwd });

  if (!upstream) {
    return {
      upstream: undefined,
      ahead: 0,
      behind: 0,
      remoteState: OPEN_PR_REMOTE_STATES.NO_UPSTREAM,
      pushRequired: true,
    };
  }

  const result = await runGitCommand({
    arguments: ['rev-list', '--left-right', '--count', 'HEAD...@{u}'],
    cwd,
  });

  const [aheadText, behindText] = result.stdout.trim().split(/\s+/);
  const ahead = Number(aheadText);
  const behind = Number(behindText);

  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) {
    throw new Error('Git returned an invalid upstream distance.');
  }

  const remoteState =
    ahead > 0 && behind > 0
      ? OPEN_PR_REMOTE_STATES.DIVERGED
      : behind > 0
        ? OPEN_PR_REMOTE_STATES.BEHIND
        : ahead > 0
          ? OPEN_PR_REMOTE_STATES.AHEAD
          : OPEN_PR_REMOTE_STATES.UP_TO_DATE;

  return {
    upstream,
    ahead,
    behind,
    remoteState,
    pushRequired: ahead > 0,
  };
};

const hasRef = async ({
  cwd,
  ref,
}: {
  cwd: string;
  ref: string;
}): Promise<boolean> => {
  try {
    await runGitCommand({
      arguments: ['rev-parse', '--verify', '--quiet', ref],
      cwd,
    });

    return true;
  } catch (error) {
    if (isGitCommandFailure(error)) {
      return false;
    }

    throw error;
  }
};

const resolveBaseRef = async ({
  cwd,
  baseBranch,
}: {
  cwd: string;
  baseBranch: string;
}): Promise<string | undefined> => {
  const remoteRef = `refs/remotes/origin/${baseBranch}`;

  if (await hasRef({ cwd, ref: remoteRef })) {
    return `origin/${baseBranch}`;
  }

  const localRef = `refs/heads/${baseBranch}`;

  if (await hasRef({ cwd, ref: localRef })) {
    return baseBranch;
  }

  return undefined;
};

type OpenPrBlockedErrorInput = {
  reason: OpenPrBlockReason;
  message: string;
};

class OpenPrBlockedError extends Error {
  readonly reason: OpenPrBlockReason;

  constructor({ reason, message }: OpenPrBlockedErrorInput) {
    super(message);
    this.name = 'OpenPrBlockedError';
    this.reason = reason;
  }
}

const assertGitRepository = async ({ cwd }: { cwd: string }): Promise<void> => {
  await runGitCommand({
    arguments: ['rev-parse', '--show-toplevel'],
    cwd,
  });
};

const assertBranch = async ({ cwd }: { cwd: string }): Promise<void> => {
  const result = await runGitCommand({
    arguments: ['branch', '--show-current'],
    cwd,
  });

  const branch = result.stdout.trim();

  if (branch) return;

  throw new OpenPrBlockedError({
    reason: OPEN_PR_BLOCK_REASONS.DETACHED_HEAD,
    message: 'The current checkout is in detached HEAD state.',
  });
};

const assertOrigin = async ({ cwd }: { cwd: string }): Promise<void> => {
  const remoteResult = await runGitCommand({
    arguments: ['remote', '-v'],
    cwd,
  });

  const hasOrigin = remoteResult.stdout
    .split('\n')
    .some((line) => line.startsWith('origin\t'));

  if (hasOrigin) return;

  throw new OpenPrBlockedError({
    reason: OPEN_PR_BLOCK_REASONS.NO_ORIGIN,
    message: 'The repository does not have an origin remote.',
  });
};

const assertWorktreeClean = async ({ cwd }: { cwd: string }): Promise<void> => {
  const porcelainStatus = await readPorcelainStatus({ cwd });
  const worktreeClean = porcelainStatus === EMPTY_TEXT;

  if (worktreeClean) return;

  throw new OpenPrBlockedError({
    reason: OPEN_PR_BLOCK_REASONS.DIRTY_WORKTREE,
    message: 'The worktree contains uncommitted changes.',
  });
};

const assertRemoteStateIsPublishable = async ({
  cwd,
}: {
  cwd: string;
}): Promise<void> => {
  const remoteDistance = await readRemoteDistance({ cwd });

  if (remoteDistance.remoteState === OPEN_PR_REMOTE_STATES.BEHIND) {
    throw new OpenPrBlockedError({
      reason: OPEN_PR_BLOCK_REASONS.REMOTE_AHEAD,
      message: 'The remote branch contains commits that are not local.',
    });
  }

  if (remoteDistance.remoteState === OPEN_PR_REMOTE_STATES.DIVERGED) {
    throw new OpenPrBlockedError({
      reason: OPEN_PR_BLOCK_REASONS.DIVERGED_BRANCH,
      message: 'The local and remote branches have diverged.',
    });
  }
};

const assertBaseRef = async ({ cwd }: { cwd: string }): Promise<void> => {
  const metadata = await readRepositoryMetadata({ cwd });

  const baseRef = await resolveBaseRef({
    cwd,
    baseBranch: metadata.defaultBranch,
  });

  if (baseRef) return;

  throw new OpenPrBlockedError({
    reason: OPEN_PR_BLOCK_REASONS.BASE_REF_UNAVAILABLE,
    message: `The local base branch ${metadata.defaultBranch} is not available.`,
  });
};

type AssertDiffInput = {
  diffStat: string;
  diff: string;
};

const assertDiffExists = ({ diffStat, diff }: AssertDiffInput): void => {
  if (diffStat.trim() || diff.trim()) return;

  throw new OpenPrBlockedError({
    reason: OPEN_PR_BLOCK_REASONS.EMPTY_DIFF,
    message:
      'The current branch has no committed changes against the base branch.',
  });
};

const isCommandError = (
  error: unknown,
): error is GitCommandError | GitHubCommandError =>
  error instanceof GitCommandError || error instanceof GitHubCommandError;

const isNotRepositoryError = (error: unknown): error is GitCommandError =>
  error instanceof GitCommandError &&
  error.arguments.includes('rev-parse') &&
  error.stderr.includes('not a git repository');

const buildBlockedContext = ({
  reason,
  message,
}: {
  reason: OpenPrBlockReason;
  message: string;
}): OpenPrContext => ({
  status: OPEN_PR_CONTEXT_STATUS.BLOCKED,
  reason,
  message,
  worktreeClean: false,
  diffStat: EMPTY_TEXT,
  diff: EMPTY_TEXT,
  diffTruncated: false,
  openPullRequests: [],
  ahead: 0,
  behind: 0,
  remoteState: OPEN_PR_REMOTE_STATES.NO_UPSTREAM,
  pushRequired: false,
});

const readPorcelainStatus = async ({
  cwd,
}: {
  cwd: string;
}): Promise<string> => {
  // Only emptiness matters here: keep one character and drain the stream so a
  // repository with many changed files cannot exceed the command output limit.
  const result = await runGitCommand({
    arguments: ['status', '--porcelain=v1'],
    cwd,
    maxOutputChars: 1,
  });

  return result.stdout;
};

export const inspectRepository = async ({
  cwd,
}: {
  cwd: string;
}): Promise<OpenPrContext> => {
  try {
    await assertGitRepository({ cwd });

    await Promise.all([
      assertBranch({ cwd }),
      assertOrigin({ cwd }),
      assertWorktreeClean({ cwd }),
      assertRemoteStateIsPublishable({ cwd }),
      assertBaseRef({ cwd }),
    ]);

    const branchResult = await runGitCommand({
      arguments: ['branch', '--show-current'],
      cwd,
    });

    const headResult = await runGitCommand({
      arguments: ['rev-parse', 'HEAD'],
      cwd,
    });

    const metadata = await readRepositoryMetadata({ cwd });

    const branch = branchResult.stdout.trim();

    const baseRef = await resolveBaseRef({
      cwd,
      baseBranch: metadata.defaultBranch,
    });

    const [diffStatResult, diffResult, openPullRequests] = await Promise.all([
      runGitCommand({
        arguments: ['diff', `${baseRef}...HEAD`, '--stat'],
        cwd,
        maxOutputChars: MAX_DIFF_CHARS,
      }),
      runGitCommand({
        arguments: ['diff', `${baseRef}...HEAD`],
        cwd,
        maxOutputChars: MAX_DIFF_CHARS,
      }),
      readOpenPullRequests({ cwd, branch }),
    ]);

    const diffStat = formatDiffOutput({
      text: diffStatResult.stdout.trim(),
      truncated: diffStatResult.stdoutTruncated,
      truncationMarker: 'diff stat',
    });

    const diff = formatDiffOutput({
      text: diffResult.stdout,
      truncated: diffResult.stdoutTruncated,
      truncationMarker: 'diff',
    });

    assertDiffExists({
      diffStat: diffStatResult.stdout,
      diff: diffResult.stdout,
    });

    const remoteDistance = await readRemoteDistance({ cwd });

    return {
      status: OPEN_PR_CONTEXT_STATUS.READY,
      repository: metadata.nameWithOwner,
      branch,
      baseBranch: metadata.defaultBranch,
      baseRef,
      head: headResult.stdout.trim(),
      worktreeClean: true,
      diffStat: diffStat.text,
      diff: diff.text,
      diffTruncated: diff.truncated,
      openPullRequests,
      upstream: remoteDistance.upstream,
      ahead: remoteDistance.ahead,
      behind: remoteDistance.behind,
      remoteState: remoteDistance.remoteState,
      pushRequired: remoteDistance.pushRequired,
    };
  } catch (error) {
    if (error instanceof OpenPrBlockedError) {
      return buildBlockedContext({
        reason: error.reason,
        message: error.message,
      });
    }

    if (!isCommandError(error)) {
      throw error;
    }

    return buildBlockedContext({
      reason: isNotRepositoryError(error)
        ? OPEN_PR_BLOCK_REASONS.NOT_REPOSITORY
        : OPEN_PR_BLOCK_REASONS.COMMAND_FAILED,
      message: getErrorMessage(error),
    });
  }
};

export const isOpenPrContextReady = (
  context: OpenPrContext,
): context is OpenPrContext & {
  status: typeof OPEN_PR_CONTEXT_STATUS.READY;
  branch: string;
  baseBranch: string;
  baseRef: string;
  head: string;
  repository: string;
} =>
  context.status === OPEN_PR_CONTEXT_STATUS.READY &&
  typeof context.branch === 'string' &&
  typeof context.baseBranch === 'string' &&
  typeof context.baseRef === 'string' &&
  typeof context.head === 'string' &&
  typeof context.repository === 'string';
