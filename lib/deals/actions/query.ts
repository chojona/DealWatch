export class DealActionQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DealActionQueryError";
  }
}

export function parseDealActionQuery(searchParams: { get(name: string): string | null }): Record<string, never> {
  if (searchParams.get("workspaceId")) {
    throw new DealActionQueryError("workspaceId is server-controlled");
  }
  return {};
}
