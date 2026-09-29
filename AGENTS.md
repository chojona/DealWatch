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

# Track bugs in Linear

This section is an explicit standing request. When you encounter a bug, error, or unexpected problem, create a Linear issue on the DealWatch team before moving on. Do not ask for confirmation.

Search open DealWatch issues first. If the same problem already has an open issue, add a comment with the new context instead of creating a second issue.

Each issue includes:

- What went wrong
- Where it showed up (file, command, page, or step)
- How to reproduce it, if known
- What was already tried, if anything

File the issue even when you fix the problem in the same change, and mention the fix or pull request on the issue. Skip this only when no defect occurred.

## Cursor Cloud specific instructions

Dealwatch is a Next.js app backed by a local SQLite database through Prisma. Node.js 22 and the `sqlite3` CLI are required. `scripts/prepare-phase6b-workspace.ts` shells out to `sqlite3` during `npm run db:push`.

- Bootstrap with `bash scripts/cloud-agent-install.sh`. It creates `.env` when missing (`DATABASE_URL="file:./dev.db"`, resolved to `prisma/dev.db`), runs `npm ci`, `npx prisma generate`, and `npm run db:push`, then runs `npm run db:seed` only when the `Deal` table is empty. Seeding replaces existing deal rows, so do not run `npm run db:seed` against a database you need to keep.
- `OPENAI_API_KEY` and `GEMINI_API_KEY` are optional for the dashboard, deal pages, and `npm test`. Live thread extraction on `/analyze` and the negotiation eval CLIs read those keys.
- Dev server: `npm run dev -- --hostname 0.0.0.0 --port 3000`. The app redirects `/` to `/dashboard`.
- Checks: `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
