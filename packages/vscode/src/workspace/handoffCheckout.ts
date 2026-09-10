import type { FeatureSummary } from '@workflow-extension/shared';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

import {
  codingApiConfig,
  type CodingApiContext,
  getFeatureHandoff,
} from '../navigator/workflow-api.js';
import { getWorkspaceFolder } from './folderManager.js';
import { gitErrorMessage, listLinkedRepos, resolveLinkedRepoPath } from './repoLinker.js';
import { readRepoLinkManifest } from './repoLinkManifest.js';

const execFile = promisify(execFileCb);

/** GitHub lets a PR be fetched by number alone — `refs/pull/<N>/head` exists
 * on every GitHub repo for every PR, regardless of whether the PR is from a
 * fork or the same repo, and regardless of push access. This is why "Checkout
 * PR for review" needs no branch-name lookup at all: the PR number, parsed
 * straight out of the pr_url already shown on the Handoff tab (as "#324"),
 * is the only thing required. */
const PR_NUMBER_RE = /\/pull\/(\d+)(?:[/?#]|$)/;

function parsePrNumber(prUrl: string): string | undefined {
  return prUrl.match(PR_NUMBER_RE)?.[1];
}

/** GitHub's `pull/<N>/head` ref only carries the PR's tip commit, not its
 * source branch name — so the fetch alone can't tell us the branch was
 * really called (e.g. `feature/skills-registry`), only its number. Ask
 * the `gh` CLI first, since it reuses whatever GitHub auth the user already
 * has (works for private repos); if `gh` isn't installed or isn't logged
 * in, fall back to the unauthenticated REST API, which only works for
 * public repos. Either failing just means the caller falls back to naming
 * the local branch `pr-<N>` — checkout still succeeds either way. */
async function resolvePrBranchName(
  repoPath: string,
  prNumber: string,
): Promise<string | undefined> {
  try {
    const { stdout } = await execFile(
      'gh',
      ['pr', 'view', prNumber, '--json', 'headRefName', '-q', '.headRefName'],
      { cwd: repoPath },
    );
    const name = stdout.trim();
    if (name) return name;
  } catch {
    // fall through to the REST API
  }

  try {
    const { stdout: remoteUrl } = await execFile('git', ['remote', 'get-url', 'origin'], {
      cwd: repoPath,
    });
    const match = remoteUrl.trim().match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
    if (!match) return undefined;
    const [, owner, repo] = match;
    const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return undefined;
    const body = (await resp.json()) as { head?: { ref?: string } };
    return body.head?.ref || undefined;
  } catch {
    return undefined;
  }
}

/**
 * `git fetch origin pull/<N>/head` then `git checkout -B <branch> FETCH_HEAD`
 * — idempotent (`-B` creates-or-resets the local branch), so re-running this
 * on a repo already checked out to that branch from a previous run just
 * re-syncs it rather than erroring on "branch already exists". `<branch>` is
 * the PR's real source branch name when it could be resolved (see
 * resolvePrBranchName above), falling back to `pr-<N>` otherwise.
 */
async function checkoutPrByNumber(
  repoPath: string,
  prNumber: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const [, resolvedName] = await Promise.all([
      execFile('git', ['fetch', 'origin', `pull/${prNumber}/head`], { cwd: repoPath }),
      resolvePrBranchName(repoPath, prNumber),
    ]);
    const branch = resolvedName ?? `pr-${prNumber}`;
    await execFile('git', ['checkout', '-B', branch, 'FETCH_HEAD'], { cwd: repoPath });
    return { ok: true, message: `Checked out "${branch}".` };
  } catch (err) {
    return { ok: false, message: gitErrorMessage(err) };
  }
}

/**
 * "Checkout PR for review" — for every repo in `feature`'s handoff PR table
 * that has an open PR, fetches and checks out that PR's branch (as `pr-<N>`)
 * in the matching locally-linked repo. Repos with no PR for this handoff, or
 * with a PR that isn't locally linked, are skipped and named up front rather
 * than erroring the whole action. Confirms once, naming every repo/PR it's
 * about to check out, before touching anything.
 */
export async function checkoutHandoffPRs(
  context: vscode.ExtensionContext,
  codingApiCtx: CodingApiContext,
  feature: FeatureSummary,
): Promise<void> {
  const workspaceId = codingApiCtx.getWorkspaceId();
  if (!workspaceId) {
    vscode.window.showWarningMessage('Actorium: Connect a workspace first.');
    return;
  }

  const folder = getWorkspaceFolder(context, codingApiCtx.getBffUrl(), workspaceId);
  if (!folder) {
    vscode.window.showWarningMessage('Actorium: Link a local workspace folder first.');
    return;
  }

  const handoff = await getFeatureHandoff(codingApiConfig(codingApiCtx), workspaceId, feature.id);
  const openPrs = (handoff?.prs ?? []).filter((pr) => !!pr.pr_url);
  if (openPrs.length === 0) {
    vscode.window.showInformationMessage(
      `Actorium: "${feature.feature_name || feature.title}" has no handoff PRs yet.`,
    );
    return;
  }

  const [linked, manifest] = await Promise.all([
    listLinkedRepos(folder),
    readRepoLinkManifest(folder),
  ]);

  // Resolve everything up front so the confirmation can say exactly what's
  // about to happen (which repos, which PR numbers) rather than a generic
  // "are you sure" — same reasoning as _unlinkRepo's confirm dialog, which
  // names the specific repo it's about to unlink.
  const toCheckout: { repo: string; prNumber: string; repoPath: string }[] = [];
  const skipped: string[] = [];
  for (const pr of openPrs) {
    const prNumber = pr.pr_url ? parsePrNumber(pr.pr_url) : undefined;
    const repoPath = prNumber ? resolveLinkedRepoPath(linked, manifest, pr.repo) : undefined;
    if (!prNumber) {
      skipped.push(`${pr.repo} (couldn't parse a PR number from its URL)`);
    } else if (!repoPath) {
      skipped.push(`${pr.repo} (not linked locally)`);
    } else {
      toCheckout.push({ repo: pr.repo, prNumber, repoPath });
    }
  }

  if (toCheckout.length === 0) {
    vscode.window.showWarningMessage(
      `Actorium: Nothing to check out for "${feature.feature_name || feature.title}" — ${skipped.join(', ')}.`,
    );
    return;
  }

  const summaryList = toCheckout.map((c) => `${c.repo} (#${c.prNumber})`).join(', ');
  const confirmed = await vscode.window.showWarningMessage(
    `Checkout PR for review for "${feature.feature_name || feature.title}"? This checks out a new local branch in ${toCheckout.length === 1 ? '1 repo' : `${toCheckout.length} repos`}: ${summaryList}.`,
    { modal: true },
    'Checkout',
  );
  if (confirmed !== 'Checkout') return;

  const checkedOut: string[] = [];

  await Promise.all(
    toCheckout.map(async ({ repo, prNumber, repoPath }) => {
      const result = await checkoutPrByNumber(repoPath, prNumber);
      if (result.ok) {
        checkedOut.push(`${repo} (#${prNumber})`);
      } else {
        skipped.push(`${repo} (#${prNumber} — ${result.message})`);
      }
    }),
  );

  const parts: string[] = [];
  if (checkedOut.length > 0) parts.push(`Checked out: ${checkedOut.join(', ')}.`);
  if (skipped.length > 0) parts.push(`Skipped: ${skipped.join(', ')}.`);
  const summary = parts.join(' ') || 'Nothing to check out.';

  if (checkedOut.length > 0) {
    vscode.window.showInformationMessage(`Actorium: ${summary}`);
  } else {
    vscode.window.showWarningMessage(`Actorium: ${summary}`);
  }
}
