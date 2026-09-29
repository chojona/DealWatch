import type { PrismaClient } from "@prisma/client";
import { ensureDefaultWorkspace } from "@/lib/entities/workspace";

const NAME_MAX = 200;
const TEXT_MAX = 200;

export class DealCreateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DealCreateError";
  }
}

export interface CreatedDeal {
  id: string;
  name: string;
  company: string;
  property: string;
  stage: string;
  status: string;
  workspaceId: string;
  href: string;
}

function optionalText(value: unknown, max: number): string {
  if (value == null) return "";
  if (typeof value !== "string") {
    throw new DealCreateError("Deal fields must be text");
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new DealCreateError("A deal field is too long");
  }
  return trimmed;
}

/**
 * Creates one modern Deal in the default workspace.
 * Name is the only required product field. Company, property, and stage
 * stay on the existing schema and default when omitted.
 */
export async function createModernDeal(
  db: PrismaClient,
  input: {
    name?: unknown;
    company?: unknown;
    property?: unknown;
    stage?: unknown;
  }
): Promise<CreatedDeal> {
  const name = optionalText(input.name, NAME_MAX);
  if (!name) throw new DealCreateError("Deal name is required");
  const company = optionalText(input.company, TEXT_MAX);
  const property = optionalText(input.property, TEXT_MAX);
  const stage = optionalText(input.stage, 80) || "Prospect";
  const workspace = await ensureDefaultWorkspace(db);
  const deal = await db.deal.create({
    data: {
      name,
      company,
      property,
      stage,
      status: "ACTIVE",
      workspaceId: workspace.id,
    },
  });
  return {
    id: deal.id,
    name: deal.name,
    company: deal.company,
    property: deal.property,
    stage: deal.stage,
    status: deal.status,
    workspaceId: deal.workspaceId,
    href: `/deals/${deal.id}`,
  };
}
