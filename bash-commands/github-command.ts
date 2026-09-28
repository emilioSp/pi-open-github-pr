/**
 * Objective: Run GitHub CLI commands with consistent errors and timeouts.
 * Used: By open-github-pr modules for every GitHub CLI operation.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_GITHUB_TIMEOUT_MS = 60_000;

export type GitHubCommandResult = {
  arguments: readonly string[];
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};

export const GITHUB_COMMAND_ERROR_CODES = {
  COMMAND_FAILED: 'command-failed',
  EXECUTION_FAILED: 'execution-failed',
  NOT_FOUND: 'not-found',
  TIMEOUT: 'timeout',
} as const;

export type GitHubCommandErrorCode =
  (typeof GITHUB_COMMAND_ERROR_CODES)[keyof typeof GITHUB_COMMAND_ERROR_CODES];

export class GitHubCommandError extends Error {
  readonly code: GitHubCommandErrorCode;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor({
    code,
    message,
    arguments: githubArguments,
    cwd,
    stdout,
    stderr,
    exitCode = null,
    cause,
  }: {
    code: GitHubCommandErrorCode;
    message: string;
    arguments: readonly string[];
    cwd: string;
    stdout: string;
    stderr: string;
    exitCode?: number | null;
    cause: unknown;
  }) {
    super(message, { cause });
    this.name = 'GitHubCommandError';
    this.code = code;
    this.arguments = githubArguments;
    this.cwd = cwd;
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

type RunGitHubCommandInput = {
  arguments: readonly string[];
  cwd?: string;
  timeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
};

// gh <arguments>
export const runGitHubCommand = async ({
  arguments: githubArguments,
  cwd = process.cwd(),
  timeoutMs = DEFAULT_GITHUB_TIMEOUT_MS,
  environment,
}: RunGitHubCommandInput): Promise<GitHubCommandResult> => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(
      'GitHub CLI command timeout must be a positive integer.',
    );
  }

  try {
    const { stdout, stderr } = await execFileAsync('gh', [...githubArguments], {
      cwd,
      encoding: 'utf8',
      env: environment,
      killSignal: 'SIGKILL',
      timeout: timeoutMs,
      windowsHide: true,
    });

    return {
      arguments: githubArguments,
      cwd,
      stdout,
      stderr,
      exitCode: 0,
    };
  } catch (cause) {
    const error = cause as Error & {
      code?: string | number;
      killed?: boolean;
      stdout?: string;
      stderr?: string;
    };
    const stdout = error.stdout ?? '';
    const stderr = error.stderr ?? '';

    if (error.killed) {
      throw new GitHubCommandError({
        code: GITHUB_COMMAND_ERROR_CODES.TIMEOUT,
        message: `GitHub CLI command timed out after ${timeoutMs} ms.`,
        arguments: githubArguments,
        cwd,
        stdout,
        stderr,
        cause,
      });
    }

    if (error.code === 'ENOENT') {
      throw new GitHubCommandError({
        code: GITHUB_COMMAND_ERROR_CODES.NOT_FOUND,
        message: 'GitHub CLI executable was not found.',
        arguments: githubArguments,
        cwd,
        stdout,
        stderr,
        cause,
      });
    }

    const exitCode = typeof error.code === 'number' ? error.code : null;

    throw new GitHubCommandError({
      code:
        exitCode === null
          ? GITHUB_COMMAND_ERROR_CODES.EXECUTION_FAILED
          : GITHUB_COMMAND_ERROR_CODES.COMMAND_FAILED,
      message: `GitHub CLI command failed: ${error.message}`,
      arguments: githubArguments,
      cwd,
      stdout,
      stderr,
      exitCode,
      cause,
    });
  }
};
