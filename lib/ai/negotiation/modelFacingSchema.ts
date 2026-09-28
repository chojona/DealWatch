/**
 * OpenAI Structured Outputs projection of CREStructuredPayloadSchema.
 *
 * The post-validation schema stays authoritative. This projection only changes
 * the model-facing JSON Schema:
 * - optional fields become required and nullable (Structured Outputs has no
 *   optional keys)
 * - unions that would nest as an untyped anyOf branch are flattened so every
 *   branch has a type
 * - literals and enums are rebuilt so discriminated unions stay extractable
 *
 * Numeric, string, and array constraints are preserved when Zod records them.
 * parseStructuredPayload still applies the strict schema, including checks
 * this projection cannot express.
 */

import { z } from "zod";
import { CREStructuredPayloadSchema } from "./payloads";

type ZodNode = z.ZodTypeAny;

function typeName(schema: ZodNode): string {
  return schema._def?.typeName ?? "";
}

function optionList(schema: ZodNode): ZodNode[] {
  const options = schema._def.options;
  return options instanceof Map ? [...options.values()] : [...options];
}

function unwrapLazy(schema: ZodNode): ZodNode {
  let current = schema;
  const seen = new Set<ZodNode>();
  while (typeName(current) === "ZodLazy" && !seen.has(current)) {
    seen.add(current);
    current = current._def.getter();
  }
  return current;
}

function cloneNumber(schema: ZodNode): z.ZodNumber {
  let next = z.number();
  for (const check of schema._def.checks ?? []) {
    if (check.kind === "int") next = next.int();
    else if (check.kind === "finite") next = next.finite();
    else if (check.kind === "multipleOf") next = next.multipleOf(check.value);
    else if (check.kind === "min") {
      next = check.inclusive === false ? next.gt(check.value) : next.min(check.value);
    } else if (check.kind === "max") {
      next = check.inclusive === false ? next.lt(check.value) : next.max(check.value);
    }
  }
  return next;
}

function cloneString(schema: ZodNode): z.ZodString {
  let next = z.string();
  for (const check of schema._def.checks ?? []) {
    if (check.kind === "min") next = next.min(check.value);
    else if (check.kind === "max") next = next.max(check.value);
  }
  return next;
}

function cloneArray(item: ZodNode, schema: ZodNode): z.ZodArray<ZodNode> {
  let next = z.array(item);
  const minLength = schema._def.minLength?.value;
  const maxLength = schema._def.maxLength?.value;
  if (typeof minLength === "number") next = next.min(minLength);
  if (typeof maxLength === "number") next = next.max(maxLength);
  return next;
}

const cache = new WeakMap<ZodNode, ZodNode>();

function toModelFacing(schema: ZodNode): ZodNode {
  const cached = cache.get(schema);
  if (cached) return cached;

  const name = typeName(schema);

  if (name === "ZodLazy") {
    const lazy = z.lazy(() => toModelFacing(schema._def.getter()));
    cache.set(schema, lazy);
    return lazy;
  }

  if (name === "ZodOptional" || name === "ZodNullable") {
    let inner: ZodNode = schema;
    let optional = false;
    while (typeName(inner) === "ZodOptional" || typeName(inner) === "ZodNullable") {
      if (typeName(inner) === "ZodOptional") optional = true;
      inner = inner._def.innerType;
    }
    const converted = unwrapLazy(toModelFacing(inner));
    const convertedName = typeName(converted);
    const unionOptions =
      convertedName === "ZodUnion" || convertedName === "ZodDiscriminatedUnion"
        ? optionList(converted)
        : null;
    let out: ZodNode = unionOptions
      ? z.union(
          [...unionOptions, z.null()] as unknown as [ZodNode, ZodNode, ...ZodNode[]]
        )
      : converted.nullable();
    if (optional) out = out.optional();
    cache.set(schema, out);
    return out;
  }

  if (name === "ZodDefault" || name === "ZodReadonly") {
    return toModelFacing(schema._def.innerType);
  }
  if (name === "ZodBranded") return toModelFacing(schema._def.type);
  if (name === "ZodEffects") return toModelFacing(schema._def.schema);

  if (name === "ZodObject") {
    const shape = schema._def.shape();
    const next: Record<string, ZodNode> = {};
    for (const [key, child] of Object.entries(shape)) {
      next[key] = toModelFacing(child as ZodNode);
    }
    const out = z.object(next);
    cache.set(schema, out);
    return out;
  }

  if (name === "ZodArray") {
    const out = cloneArray(toModelFacing(schema._def.type), schema);
    cache.set(schema, out);
    return out;
  }

  if (name === "ZodDiscriminatedUnion") {
    const options = optionList(schema).map((option) => toModelFacing(option));
    const out = z.discriminatedUnion(
      schema._def.discriminator,
      options as [
        z.ZodObject<z.ZodRawShape>,
        z.ZodObject<z.ZodRawShape>,
        ...z.ZodObject<z.ZodRawShape>[],
      ]
    );
    cache.set(schema, out);
    return out;
  }

  if (name === "ZodUnion") {
    const options = optionList(schema).map((option) => toModelFacing(option));
    const out = z.union(options as [ZodNode, ZodNode, ...ZodNode[]]);
    cache.set(schema, out);
    return out;
  }

  if (name === "ZodLiteral") {
    const out = z.literal(schema._def.value);
    cache.set(schema, out);
    return out;
  }
  if (name === "ZodEnum") {
    const out = z.enum(schema._def.values);
    cache.set(schema, out);
    return out;
  }
  if (name === "ZodString") {
    const out = cloneString(schema);
    cache.set(schema, out);
    return out;
  }
  if (name === "ZodNumber") {
    const out = cloneNumber(schema);
    cache.set(schema, out);
    return out;
  }
  if (name === "ZodBoolean") {
    const out = z.boolean();
    cache.set(schema, out);
    return out;
  }

  cache.set(schema, schema);
  return schema;
}

const modelPayload = toModelFacing(CREStructuredPayloadSchema);
const modelPayloadBranches = optionList(unwrapLazy(modelPayload));

/**
 * Null or one of the ten CRE payload objects. Union branches are flat so the
 * generated JSON Schema does not wrap the payload in an untyped anyOf member.
 */
export const ModelFacingStructuredPayloadSchema = z.union(
  [...modelPayloadBranches, z.null()] as unknown as [ZodNode, ZodNode, ...ZodNode[]]
);
