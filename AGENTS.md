<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Session workflow

This section is an explicit standing request. For every task that changes files, do these steps without asking for confirmation:

1. If the current branch is `main`, fetch and fast-forward it from `origin/main`, then create a new branch before the first edit. Do not commit task work on `main`.
2. Do the work on that branch.
3. Commit the finished work. This section is the explicit request to commit. Do not commit secrets.
4. Push the branch to `origin`. This section is the explicit request to push.
5. Open a pull request. This section is the explicit request to open a pull request.

One task is one branch and one pull request. Questions and reviews that do not change files skip this sequence. Do not force-push. Do not skip git hooks. GitHub deletes the branch when the pull request is merged.

# Git worktree workflow

This section is an explicit standing request. File-changing work runs in a linked git worktree so the checkout you started from stays untouched.

1. Detect isolation before creating anything. Resolve `git rev-parse --git-dir` and `git rev-parse --git-common-dir`. If those paths differ, and `git rev-parse --show-superproject-working-tree` is empty, this directory is already a linked worktree. Stay in it. Do not create a second worktree for the same task.
2. When the directory is the primary checkout, fetch `origin/main` and add a worktree from `origin/main` before the first edit. Do this when the checkout is on another branch or has uncommitted work. Leave that checkout's files alone.
3. Place the worktree outside the repository at `/private/tmp/dealwatch-<task-slug>`. Do not put it in `.worktrees/` or `worktrees/` inside the repo unless that directory is already gitignored. An unignored worktree path can be committed by accident.
4. Create the task branch with the worktree:

   ```bash
   git fetch origin main
   git worktree add -b <branch> /private/tmp/dealwatch-<task-slug> origin/main
   ```

   The worktree is already on the task branch. Do not create a second branch for the same task.
5. One task is one worktree, one branch, and one pull request. Do not reuse a worktree or branch for a second task.
6. Install dependencies in the new worktree with `npm ci` before running the app or tests. `node_modules` is not shared with the primary checkout. Copy or create `.env` in the worktree when the task needs the local database (`DATABASE_URL="file:./dev.db"`, resolved to `prisma/dev.db`).
7. Move the agent workspace to the worktree path before editing. If that move fetches `origin/<branch>`, push the new branch once before the move.
8. Do the work only inside the worktree, then follow the session workflow: commit, push, and open a pull request. Do not force-push. Do not skip git hooks.
9. Leave the worktree in place until the pull request is merged. Remove it afterward with `git worktree remove /private/tmp/dealwatch-<task-slug>`.

Questions and reviews that do not change files stay in the current checkout and skip this sequence.

# Track bugs in Linear

This section is an explicit standing request. When you encounter a bug, error, or unexpected problem, create a Linear issue on the DealWatch team before moving on. Do not ask for confirmation.

Search open DealWatch issues first. If the same problem already has an open issue, add a comment with the new context instead of creating a second issue.

Each issue includes:

- What went wrong
- Where it showed up (file, command, page, or step)
- How to reproduce it, if known
- What was already tried, if anything

File the issue even when you fix the problem in the same change, and mention the fix or pull request on the issue. Skip this only when no defect occurred.

When work for a DealWatch Linear issue is finished, update that issue's status. The Linear tools can change status: pass `state` as `In Progress` or `Done` when updating the issue. Do not ask for confirmation.

- Set the issue to In Progress when you start the fix.
- Set the issue to Done when the fix is merged, or when the requested change is otherwise complete.
- Mention the pull request on the issue when one exists.

Do not leave a completed issue in Backlog, Todo, or In Progress.

## Cursor Cloud specific instructions

Dealwatch is a Next.js app backed by a local SQLite database through Prisma. Node.js 22 and the `sqlite3` CLI are required. `scripts/prepare-phase6b-workspace.ts` shells out to `sqlite3` during `npm run db:push`.

- Bootstrap with `bash scripts/cloud-agent-install.sh`. It creates `.env` when missing (`DATABASE_URL="file:./dev.db"`, resolved to `prisma/dev.db`), runs `npm ci`, `npx prisma generate`, and `npm run db:push`, then runs `npm run db:seed` only when the `Deal` table is empty. Seeding replaces existing deal rows, so do not run `npm run db:seed` against a database you need to keep.
- `OPENAI_API_KEY` and `GEMINI_API_KEY` are optional for the dashboard, deal pages, and `npm test`. Live thread extraction on `/analyze` and the negotiation eval CLIs read those keys.
- Dev server: `npm run dev -- --hostname 0.0.0.0 --port 3000`. The app redirects `/` to `/dashboard`.
- Checks: `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
