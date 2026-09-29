<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Session workflow

Every coding session starts on a new branch and ends with a pull request. GitHub deletes the branch when the pull request is merged.

## Cursor Cloud specific instructions

Dealwatch is a Next.js app backed by a local SQLite database through Prisma. Node.js 22 and the `sqlite3` CLI are required. `scripts/prepare-phase6b-workspace.ts` shells out to `sqlite3` during `npm run db:push`.

- Bootstrap with `bash scripts/cloud-agent-install.sh`. It creates `.env` when missing (`DATABASE_URL="file:./dev.db"`, resolved to `prisma/dev.db`), runs `npm ci`, `npx prisma generate`, and `npm run db:push`, then runs `npm run db:seed` only when the `Deal` table is empty. Seeding replaces existing deal rows, so do not run `npm run db:seed` against a database you need to keep.
- `OPENAI_API_KEY` and `GEMINI_API_KEY` are optional for the dashboard, deal pages, and `npm test`. Live thread extraction on `/analyze` and the negotiation eval CLIs read those keys.
- Dev server: `npm run dev -- --hostname 0.0.0.0 --port 3000`. The app redirects `/` to `/dashboard`.
- Checks: `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
