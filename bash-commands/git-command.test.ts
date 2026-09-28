/**
 * Objective: Verify that large Git output is streamed and bounded.
 * Used: By the test suite.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runGitCommand } from '#bash-commands/git-command.ts';

describe('Git command output', () => {
  it('truncates large stdout without failing the Git command', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pi-open-github-pr-git-command-'));
    const filePath = join(cwd, 'large.txt');

    try {
      await runGitCommand({ arguments: ['init', '--quiet'], cwd });
      await runGitCommand({
        arguments: ['config', 'user.email', 'test@example.com'],
        cwd,
      });
      await runGitCommand({ arguments: ['config', 'user.name', 'Test'], cwd });

      await writeFile(filePath, 'initial\n', 'utf8');
      await runGitCommand({ arguments: ['add', 'large.txt'], cwd });
      await runGitCommand({
        arguments: ['commit', '--quiet', '-m', 'initial'],
        cwd,
      });

      await writeFile(filePath, `${'x'.repeat(2_000_000)}\n`, 'utf8');

      const result = await runGitCommand({
        arguments: ['diff'],
        cwd,
        maxOutputChars: 1_000,
      });

      expect(result.stdout).toHaveLength(1_000);
      expect(result.stdoutTruncated).toBe(true);
      expect(result.exitCode).toBe(0);
    } finally {
      await rm(cwd, { force: true, recursive: true });
    }
  });
});
