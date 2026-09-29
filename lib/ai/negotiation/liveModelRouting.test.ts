import assert from "node:assert/strict";
import test from "node:test";
import {
  NegotiationExtractionConfigurationError,
  extractTerms,
} from "./extractTerms";

const input = {
  documentText: "Base Rent: $61.00 per RSF.",
  documentName: "Acme LOI",
  side: "TENANT" as const,
  roundNumber: 1,
  documentDate: new Date("2026-09-01T12:00:00.000Z"),
};

async function captureRequestUrl(
  env: Record<string, string | undefined>,
  run: () => Promise<unknown>
) {
  const previous = {
    DEALWATCH_NEGOTIATION_MODEL: process.env.DEALWATCH_NEGOTIATION_MODEL,
    DEALWATCH_ANALYSIS_MODEL: process.env.DEALWATCH_ANALYSIS_MODEL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  const originalFetch = globalThis.fetch;
  let requested = "";
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    requested = String(url);
    return new Response("{}", {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await run().catch((error: unknown) => {
      if (error instanceof NegotiationExtractionConfigurationError) throw error;
    });
    return requested;
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("live document analysis sends gpt-5.4-mini to OpenAI", async () => {
  const requested = await captureRequestUrl(
    {
      DEALWATCH_NEGOTIATION_MODEL: "gpt-5.4-mini",
      DEALWATCH_ANALYSIS_MODEL: undefined,
      GEMINI_API_KEY: undefined,
      OPENAI_API_KEY: "sk-test",
    },
    () => extractTerms(input)
  );
  assert.match(requested, /^https:\/\/api\.openai\.com\//);
  assert.doesNotMatch(requested, /generativelanguage\.googleapis\.com/);
});

test("live document analysis keeps Gemini model ids on Gemini", async () => {
  const requested = await captureRequestUrl(
    {
      DEALWATCH_NEGOTIATION_MODEL: "gemini-3.8-flash",
      DEALWATCH_ANALYSIS_MODEL: undefined,
      GEMINI_API_KEY: "gemini-test",
      OPENAI_API_KEY: undefined,
    },
    () => extractTerms(input)
  );
  assert.match(
    requested,
    /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/openai\//
  );
});
