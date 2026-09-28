-- Phase 6B graph read model and partial unique indexes.
-- Prisma db push does not create views or partial indexes. Reapply this file
-- after every db push (scripts/apply-phase6b-sql.ts, and the test database helper).
--
-- CHECK constraints from the ontology are enforced in lib/entities/invariants.ts.
-- SQLite cannot add CHECK constraints without rebuilding tables, and the next
-- prisma db push would drop that rebuild.

DROP VIEW IF EXISTS graph_edge;

CREATE VIEW graph_edge AS
SELECT
  e."workspaceId" AS workspace_id,
  'PERSON' AS from_type,
  e."personId" AS from_id,
  'COMPANY' AS to_type,
  e."companyId" AS to_id,
  'WORKS_AT' AS predicate,
  NULL AS deal_id,
  e."id" AS assertion_id,
  e."validFrom" AS valid_from,
  e."validTo" AS valid_to
FROM "Employment" e
INNER JOIN "Person" p ON p."id" = e."personId"
INNER JOIN "Company" c ON c."id" = e."companyId"
WHERE e."status" = 'ASSERTED'
  AND p."status" != 'MERGED'
  AND c."status" != 'MERGED'
UNION ALL
SELECT
  s."workspaceId",
  'COMPANY',
  s."companyId",
  'PROPERTY',
  s."propertyId",
  s."predicate",
  NULL,
  s."id",
  s."validFrom",
  s."validTo"
FROM "PropertyStake" s
INNER JOIN "Company" c ON c."id" = s."companyId"
INNER JOIN "Property" pr ON pr."id" = s."propertyId"
WHERE s."status" = 'ASSERTED'
  AND c."status" != 'MERGED'
  AND pr."status" != 'MERGED'
UNION ALL
SELECT
  dp."workspaceId",
  'PERSON',
  dp."personId",
  'DEAL',
  dp."dealId",
  dp."role",
  dp."dealId",
  dp."id",
  dp."validFrom",
  dp."validTo"
FROM "DealParticipation" dp
INNER JOIN "Person" p ON p."id" = dp."personId"
WHERE dp."status" = 'ASSERTED'
  AND dp."personId" IS NOT NULL
  AND p."status" != 'MERGED'
UNION ALL
SELECT
  dp."workspaceId",
  'COMPANY',
  dp."companyId",
  'DEAL',
  dp."dealId",
  dp."role",
  dp."dealId",
  dp."id",
  dp."validFrom",
  dp."validTo"
FROM "DealParticipation" dp
INNER JOIN "Company" c ON c."id" = dp."companyId"
WHERE dp."status" = 'ASSERTED'
  AND dp."companyId" IS NOT NULL
  AND c."status" != 'MERGED'
UNION ALL
SELECT
  dp."workspaceId",
  'PERSON',
  dp."personId",
  'COMPANY',
  dp."representsCompanyId",
  'REPRESENTS_ON_DEAL',
  dp."dealId",
  dp."id",
  dp."validFrom",
  dp."validTo"
FROM "DealParticipation" dp
INNER JOIN "Person" p ON p."id" = dp."personId"
INNER JOIN "Company" principal ON principal."id" = dp."representsCompanyId"
WHERE dp."status" = 'ASSERTED'
  AND dp."personId" IS NOT NULL
  AND dp."representsCompanyId" IS NOT NULL
  AND p."status" != 'MERGED'
  AND principal."status" != 'MERGED'
UNION ALL
SELECT
  dp."workspaceId",
  'COMPANY',
  dp."companyId",
  'COMPANY',
  dp."representsCompanyId",
  'REPRESENTS_ON_DEAL',
  dp."dealId",
  dp."id",
  dp."validFrom",
  dp."validTo"
FROM "DealParticipation" dp
INNER JOIN "Company" actor ON actor."id" = dp."companyId"
INNER JOIN "Company" principal ON principal."id" = dp."representsCompanyId"
WHERE dp."status" = 'ASSERTED'
  AND dp."companyId" IS NOT NULL
  AND dp."representsCompanyId" IS NOT NULL
  AND actor."status" != 'MERGED'
  AND principal."status" != 'MERGED'
UNION ALL
SELECT
  d."workspaceId",
  'DEAL',
  d."id",
  'PROPERTY',
  d."propertyId",
  'CONCERNS_PROPERTY',
  d."id",
  d."id",
  NULL,
  NULL
FROM "Deal" d
INNER JOIN "Property" p ON p."id" = d."propertyId"
WHERE d."propertyId" IS NOT NULL
  AND p."status" != 'MERGED';

CREATE UNIQUE INDEX IF NOT EXISTS "Employment_open_edge"
ON "Employment" ("workspaceId", "personId", "companyId", "affiliationKind")
WHERE "status" = 'ASSERTED';

CREATE UNIQUE INDEX IF NOT EXISTS "PropertyStake_open_edge"
ON "PropertyStake" ("workspaceId", "companyId", "propertyId", "predicate")
WHERE "status" = 'ASSERTED';

CREATE UNIQUE INDEX IF NOT EXISTS "DealParticipation_open_person"
ON "DealParticipation" ("dealId", "role", "personId")
WHERE "status" = 'ASSERTED' AND "personId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "DealParticipation_open_company"
ON "DealParticipation" ("dealId", "role", "companyId")
WHERE "status" = 'ASSERTED' AND "companyId" IS NOT NULL;
