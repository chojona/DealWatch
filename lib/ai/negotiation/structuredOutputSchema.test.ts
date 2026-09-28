/**
 * Regression: the production OpenAI response_format schema must not contain
 * an untyped anyOf branch. z.unknown().nullable() generated
 * structuredPayload.anyOf[0] === {} and OpenAI rejected every document with
 * "schema must have a 'type' key".
 */

import assert from "node:assert/strict";
import test from "node:test";
import { negotiationTermsResponseFormat } from "./extractTerms";
import {
  coerceModelStructuredPayload,
  parseStructuredPayload,
} from "./payloads";
import { validateExtractedTerms } from "./validateTerms";

const TERM_TYPES = [
  "BASE_RENT",
  "FREE_RENT",
  "TI_ALLOWANCE",
  "RENEWAL_OPTIONS",
  "TERMINATION_RIGHTS",
  "OPERATING_EXPENSES",
  "ANNUAL_ESCALATION",
  "PARKING",
  "COMMENCEMENT_DATE",
  "EXPANSION_RIGHTS",
] as const;

const UNSUPPORTED_KEYWORDS = new Set([
  "allOf",
  "oneOf",
  "not",
  "patternProperties",
  "unevaluatedProperties",
  "additionalItems",
  "prefixItems",
]);

type JsonSchema = Record<string, unknown>;

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function productionSchema(): JsonSchema {
  const responseFormat = negotiationTermsResponseFormat();
  const schema = responseFormat.json_schema.schema;
  assert.equal(responseFormat.json_schema.name, "dealwatch_negotiation_terms");
  assert.equal(responseFormat.json_schema.strict, true);
  assert.ok(isRecord(schema));
  return schema;
}

function walk(node: unknown, visit: (schema: JsonSchema, path: string) => void, path = "#") {
  if (Array.isArray(node)) {
    node.forEach((child, index) => walk(child, visit, path + "/" + index));
    return;
  }
  if (!isRecord(node)) return;
  const looksLikeSchema =
    "type" in node ||
    "anyOf" in node ||
    "$ref" in node ||
    "properties" in node ||
    "items" in node ||
    "enum" in node ||
    "const" in node;
  if (looksLikeSchema) visit(node, path);
  for (const [key, child] of Object.entries(node)) {
    if (key === "enum" || key === "const" || key === "required") continue;
    walk(child, visit, path + "/" + key);
  }
}

test("production response schema gives every anyOf branch a type", () => {
  const schema = productionSchema();
  const violations: string[] = [];
  let propertyCount = 0;
  let maxObjectDepth = 0;

  walk(schema, (node, path) => {
    for (const keyword of UNSUPPORTED_KEYWORDS) {
      if (keyword in node) violations.push(path + " uses " + keyword);
    }

    if (isRecord(node.properties)) {
      propertyCount += Object.keys(node.properties).length;
      const depth = path.split("/properties/").length - 1;
      maxObjectDepth = Math.max(maxObjectDepth, depth);
      if (node.additionalProperties !== false) {
        violations.push(path + " object is not closed");
      }
      const required = new Set(Array.isArray(node.required) ? node.required : []);
      for (const key of Object.keys(node.properties)) {
        if (!required.has(key)) violations.push(path + " missing required " + key);
      }
    }

    if (node.type === "array" && node.items === undefined && node.$ref === undefined) {
      violations.push(path + " array has no items");
    }

    if (!Array.isArray(node.anyOf)) return;
    node.anyOf.forEach((branch, index) => {
      if (!isRecord(branch)) {
        violations.push(path + "/anyOf/" + index + " is not an object schema");
        return;
      }
      const typed =
        branch.type !== undefined ||
        branch.$ref !== undefined ||
        branch.enum !== undefined ||
        branch.const !== undefined;
      if (!typed || Object.keys(branch).length === 0) {
        violations.push(
          path + "/anyOf/" + index + " missing type keys=" + Object.keys(branch).join(",")
        );
      }
    });
  });

  assert.deepEqual(violations, []);
  assert.ok(propertyCount > 0 && propertyCount <= 5000, "property count " + propertyCount);
  assert.ok(maxObjectDepth <= 10, "object depth " + maxObjectDepth);

  const encoded = JSON.stringify(schema);
  assert.equal(encoded.includes('"anyOf":[{}]'), false);
  assert.equal(encoded.includes('"anyOf":[{},{"type":"null"}]'), false);
  for (const termType of TERM_TYPES) {
    assert.equal(encoded.includes(termType), true, termType);
  }

  const terms = schema.properties;
  assert.ok(isRecord(terms));
  const termsSchema = terms.terms;
  assert.ok(isRecord(termsSchema) && isRecord(termsSchema.items));
  const item = termsSchema.items;
  assert.ok(isRecord(item.properties));
  const payload = item.properties.structuredPayload;
  assert.ok(isRecord(payload) && Array.isArray(payload.anyOf));
  const first = payload.anyOf[0];
  assert.ok(isRecord(first));
  assert.equal(first.type, "object");
  assert.notEqual(Object.keys(first).length, 0);
});

test("strict schema still rejects nulls on optional payload fields", () => {
  const rejected = parseStructuredPayload({
    termType: "BASE_RENT",
    rent: { kind: "simple", amountPerRSFYear: 48, rentStructure: null },
  });
  assert.equal(rejected, null);
});

test("model nulls for optional fields validate after the extraction boundary", () => {
  const documentText =
    "Base Rent shall be $48.00/RSF/year for months 1-24, $51.00/RSF/year for months 25-60, and $55.50/RSF/year for months 61-120; there are no annual percentage increases between those steps.";
  const modelPayload = {
    termType: "BASE_RENT" as const,
    rent: {
      kind: "stepped" as const,
      steps: [
        {
          startMonth: 1,
          endMonth: 24,
          amountPerRSFYear: 48,
          observationRef: null,
        },
        {
          startMonth: 25,
          endMonth: 60,
          amountPerRSFYear: 51,
          observationRef: { observationId: "pending", evidenceSpan: null },
        },
        {
          startMonth: 61,
          endMonth: 120,
          amountPerRSFYear: 55.5,
          observationRef: null,
        },
      ],
      rentStructure: null,
    },
    inlineEscalation: null,
  };

  assert.equal(parseStructuredPayload(modelPayload), null);
  const coerced = coerceModelStructuredPayload(modelPayload);
  const parsed = parseStructuredPayload(coerced, "BASE_RENT");
  assert.ok(parsed && parsed.termType === "BASE_RENT");
  if (parsed?.termType === "BASE_RENT") {
    assert.equal(parsed.rent.kind, "stepped");
    assert.equal("inlineEscalation" in parsed, false);
  }

  const result = validateExtractedTerms({
    documentText,
    extraction: {
      overallConfidence: 0.95,
      terms: [
        {
          canonicalType: "BASE_RENT",
          normalizedValue: "$48.00/RSF/year for months 1-24",
          normalizedNumeric: 48,
          normalizedUnit: "USD_PER_RSF_YEAR",
          rawValue: "$48.00/RSF/year for months 1-24",
          status: "PROPOSED",
          confidence: 0.95,
          evidenceQuote: "Base Rent shall be $48.00/RSF/year for months 1-24,",
          sourceLocation: null,
          structuredPayload: modelPayload,
        },
      ],
    },
    model: "schema-test",
    extractedAt: new Date("2026-09-28T16:00:00.000Z"),
    latencyMs: 1,
  });

  assert.equal(result.terms.length, 1);
  assert.equal(result.terms[0]?.structuredPayload?.termType, "BASE_RENT");
  const rent = result.terms[0]?.structuredPayload;
  if (rent?.termType === "BASE_RENT" && rent.rent.kind === "stepped") {
    assert.equal(rent.rent.steps.length, 3);
    assert.equal(rent.rent.steps[2]?.amountPerRSFYear, 55.5);
  } else {
    assert.fail("expected stepped base rent");
  }
});
