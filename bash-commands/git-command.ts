/**
 * Objective: Run Git commands with consistent errors and timeouts.
 * Used: By open-github-pr modules for every Git operation.
 */

import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_GIT_TIMEOUT_MS = 60_000;

export type GitCommandResult = {
  arguments: readonly string[];
  cwd: string;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  exitCode: number;
};

export const GIT_COMMAND_ERROR_CODES = {
  COMMAND_FAILED: 'command-failed',
  EXECUTION_FAILED: 'execution-failed',
  NOT_FOUND: 'not-found',
  TIMEOUT: 'timeout',
} as const;

export type GitCommandErrorCode =
  (typeof GIT_COMMAND_ERROR_CODES)[keyof typeof GIT_COMMAND_ERROR_CODES];

export class GitCommandError extends Error {
  readonly code: GitCommandErrorCode;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor({
    code,
    message,
    arguments: gitArguments,
    cwd,
    stdout,
    stderr,
    exitCode = null,
    cause,
  }: {
    code: GitCommandErrorCode;
    message: string;
    arguments: readonly string[];
    cwd: string;
    stdout: string;
    stderr: string;
    exitCode?: number | null;
    cause: unknown;
  }) {
    super(message, { cause });
    this.name = 'GitCommandError';
    this.code = code;
    this.arguments = gitArguments;
    this.cwd = cwd;
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

type RunGitCommandInput = {
  arguments: readonly string[];
  cwd?: string;
  timeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
  maxOutputChars?: number;
};

type StreamOutput = {
  text: string;
  truncated: boolean;
};

type AppendStreamChunkInput = {
  current: StreamOutput;
  chunk: string;
  maxChars?: number;
};

const appendStreamChunk = ({
  current,
  chunk,
  maxChars,
}: AppendStreamChunkInput): StreamOutput => {
  if (maxChars === undefined) {
    return {
      text: `${current.text}${chunk}`,
      truncated: current.truncated,
    };
  }

  const remainingChars = maxChars - current.text.length;

  return {
    text:
      remainingChars > 0
        ? `${current.text}${chunk.slice(0, remainingChars)}`
        : current.text,
    truncated: current.truncated || chunk.length > Math.max(remainingChars, 0),
  };
};

type ReadStreamOutputInput = {
  stream: Readable;
  maxChars?: number;
};

const readStreamOutput = async ({
  stream,
  maxChars,
}: ReadStreamOutputInput): Promise<StreamOutput> => {
  const decoder = new StringDecoder('utf8');
  let output: StreamOutput = { text: '', truncated: false };

  for await (const chunk of stream) {
    output = appendStreamChunk({
      current: output,
      chunk: decoder.write(chunk),
      maxChars,
    });
  }

  return appendStreamChunk({
    current: output,
    chunk: decoder.end(),
    maxChars,
  });
};

type ChildProcessError = Error & {
  code?: string | number;
};

type RunGitCommandWithLimitedOutputInput = {
  arguments: readonly string[];
  cwd: string;
  timeoutMs: number;
  environment?: NodeJS.ProcessEnv;
  maxOutputChars: number;
};

// Stream bounded output because execFile buffers the complete stdout before it
// resolves. Keep reading after reaching the limit so the child process cannot
// block on a full pipe.
const runGitCommandWithLimitedOutput = async ({
  arguments: gitArguments,
  cwd,
  timeoutMs,
  environment,
  maxOutputChars,
}: RunGitCommandWithLimitedOutputInput): Promise<GitCommandResult> => {
  let child: ReturnType<typeof spawn>;

  try {
    child = spawn('git', [...gitArguments], {
      cwd,
      env: environment,
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (cause) {
    const error = cause as ChildProcessError;

    throw new GitCommandError({
      code:
        error.code === 'ENOENT'
          ? GIT_COMMAND_ERROR_CODES.NOT_FOUND
          : GIT_COMMAND_ERROR_CODES.EXECUTION_FAILED,
      message:
        error.code === 'ENOENT'
          ? 'Git executable was not found.'
          : `Git command failed: ${error.message}`,
      arguments: gitArguments,
      cwd,
      stdout: '',
      stderr: '',
      cause,
    });
  }

  if (!child.stdout || !child.stderr) {
    throw new GitCommandError({
      code: GIT_COMMAND_ERROR_CODES.EXECUTION_FAILED,
      message: 'Git command did not expose output streams.',
      arguments: gitArguments,
      cwd,
      stdout: '',
      stderr: '',
      cause: undefined,
    });
  }

  let timedOut = false;
  let processError: ChildProcessError | undefined;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, timeoutMs);

  child.once('error', (cause) => {
    processError = cause as ChildProcessError;
  });

  try {
    const stdoutPromise = readStreamOutput({
      stream: child.stdout,
      maxChars: maxOutputChars,
    });

    const stderrPromise = readStreamOutput({
      stream: child.stderr,
      maxChars: maxOutputChars,
    });

    const closeResult = await once(child, 'close');
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

    const [exitCode, signal] = closeResult as [
      number | null,
      NodeJS.Signals | null,
    ];

    if (timedOut) {
      throw new GitCommandError({
        code: GIT_COMMAND_ERROR_CODES.TIMEOUT,
        message: `Git command timed out after ${timeoutMs} ms.`,
        arguments: gitArguments,
        cwd,
        stdout: stdout.text,
        stderr: stderr.text,
        cause: processError,
      });
    }

    if (processError?.code === 'ENOENT') {
      throw new GitCommandError({
        code: GIT_COMMAND_ERROR_CODES.NOT_FOUND,
        message: 'Git executable was not found.',
        arguments: gitArguments,
        cwd,
        stdout: stdout.text,
        stderr: stderr.text,
        cause: processError,
      });
    }

    if (processError || exitCode !== 0) {
      const normalizedExitCode = typeof exitCode === 'number' ? exitCode : null;

      const message = processError
        ? `Git command failed: ${processError.message}`
        : signal
          ? `Git command was terminated by ${signal}.`
          : `Git command failed with exit code ${normalizedExitCode}.`;

      throw new GitCommandError({
        code:
          normalizedExitCode === null
            ? GIT_COMMAND_ERROR_CODES.EXECUTION_FAILED
            : GIT_COMMAND_ERROR_CODES.COMMAND_FAILED,
        message,
        arguments: gitArguments,
        cwd,
        stdout: stdout.text,
        stderr: stderr.text,
        exitCode: normalizedExitCode,
        cause: processError,
      });
    }

    return {
      arguments: gitArguments,
      cwd,
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
      exitCode: 0,
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

// git <arguments>
export const runGitCommand = async ({
  arguments: gitArguments,
  cwd = process.cwd(),
  timeoutMs = DEFAULT_GIT_TIMEOUT_MS,
  environment,
  maxOutputChars,
}: RunGitCommandInput): Promise<GitCommandResult> => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('Git command timeout must be a positive integer.');
  }

  if (
    maxOutputChars !== undefined &&
    (!Number.isSafeInteger(maxOutputChars) || maxOutputChars <= 0)
  ) {
    throw new RangeError(
      'Git command output limit must be a positive integer.',
    );
  }

  if (maxOutputChars !== undefined) {
    return runGitCommandWithLimitedOutput({
      arguments: gitArguments,
      cwd,
      timeoutMs,
      environment,
      maxOutputChars,
    });
  }

  try {
    const { stdout, stderr } = await execFileAsync('git', [...gitArguments], {
      cwd,
      encoding: 'utf8',
      env: environment,
      killSignal: 'SIGKILL',
      timeout: timeoutMs,
      windowsHide: true,
    });

    return {
      arguments: gitArguments,
      cwd,
      stdout,
      stderr,
      stdoutTruncated: false,
      stderrTruncated: false,
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
      throw new GitCommandError({
        code: GIT_COMMAND_ERROR_CODES.TIMEOUT,
        message: `Git command timed out after ${timeoutMs} ms.`,
        arguments: gitArguments,
        cwd,
        stdout,
        stderr,
        cause,
      });
    }

    if (error.code === 'ENOENT') {
      throw new GitCommandError({
        code: GIT_COMMAND_ERROR_CODES.NOT_FOUND,
        message: 'Git executable was not found.',
        arguments: gitArguments,
        cwd,
        stdout,
        stderr,
        cause,
      });
    }

    const exitCode = typeof error.code === 'number' ? error.code : null;

    throw new GitCommandError({
      code:
        exitCode === null
          ? GIT_COMMAND_ERROR_CODES.EXECUTION_FAILED
          : GIT_COMMAND_ERROR_CODES.COMMAND_FAILED,
      message: `Git command failed: ${error.message}`,
      arguments: gitArguments,
      cwd,
      stdout,
      stderr,
      exitCode,
      cause,
    });
  }
};
