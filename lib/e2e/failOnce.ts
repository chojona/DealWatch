import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

function stateFile(): string {
  return path.join(process.cwd(), "e2e/.state/fail-once.json");
}

function readState(): Record<string, number> {
  try {
    return JSON.parse(readFileSync(stateFile(), "utf8")) as Record<string, number>;
  } catch {
    return {};
  }
}

/** First call for a key fails. Later calls succeed. No-op storage outside the test process. */
export function shouldFailOnce(key: string): boolean {
  const hash = createHash("sha256").update(key).digest("hex");
  const state = readState();
  const count = state[hash] ?? 0;
  state[hash] = count + 1;
  mkdirSync(path.dirname(stateFile()), { recursive: true });
  writeFileSync(stateFile(), JSON.stringify(state));
  return count === 0;
}

export function clearE2EFailOnceState(): void {
  rmSync(stateFile(), { force: true });
}
