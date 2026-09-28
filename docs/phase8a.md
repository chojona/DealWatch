# Phase 8A: Canonical entity intelligence

DealWatch exposes confirmed workspace-scoped `Person`, `Company`, `Property`, and `Deal` records through global search and server-backed intelligence pages. Entity observations are never search results or confirmed relationship rows. Pending observations are shown only as a count with a link to Deal Knowledge review.

## Current workspace limitation

The application does not yet have authenticated session/workspace context. Global shell search therefore follows the existing Phase 7E safety convention and searches the `Default` workspace. Connection-map search derives its workspace from the canonical root entity. API callers cannot supply `workspaceId`; requests that attempt to do so are rejected. Entity intelligence reads also derive the workspace from the active, unmerged canonical root and apply that workspace to every related query.

Authenticated workspace selection should replace the `Default` fallback in a later phase. Until then, the fallback is intentionally server-controlled and must not be treated as user authorization.

## Truth and evidence

Only asserted canonical `Employment`, `PropertyStake`, `DealParticipation`, and Deal-to-Property links appear as confirmed knowledge. Deal participants shown on a Property page are explicitly labeled as indirect through a Deal. Unsupported manual assertions display: “No documentary support is currently linked to this canonical assertion.”
