import type {
  CREStructuredPayload,
  EscalationSpec,
  PricingMethod,
} from "@/lib/ai/negotiation/payloads";
import type { NegotiationTermRecord } from "@/lib/negotiation/types";
import type { FormattedTermValue } from "./types";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function dollars(value: number): string {
  return money.format(value);
}

function sentence(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function months(value: number): string {
  return `${value} ${value === 1 ? "month" : "months"}`;
}

function periodLabel(startMonth: number, endMonth: number): string {
  if ((startMonth - 1) % 12 === 0 && endMonth % 12 === 0) {
    const startYear = (startMonth - 1) / 12 + 1;
    const endYear = endMonth / 12;
    return startYear === endYear
      ? `Year ${startYear}`
      : `Years ${startYear}–${endYear}`;
  }
  return startMonth === endMonth
    ? `Month ${startMonth}`
    : `Months ${startMonth}–${endMonth}`;
}

function pricing(method: PricingMethod, value?: number): string {
  if (method === "FAIR_MARKET_RENT") return "Fair Market Rent";
  if (method === "FIXED_RATE") {
    return value === undefined ? "Fixed rate" : `${dollars(value)} / RSF / yr`;
  }
  if (method === "PERCENT_OF_THEN_CURRENT") {
    return value === undefined ? "% of then-current rent" : `${value}% of then-current rent`;
  }
  if (method === "LESSER_OF_FMR_AND_FIXED") return "Lesser of FMR and fixed rate";
  return "Other pricing method";
}

function escalation(spec: EscalationSpec): string {
  if (spec.kind === "percent") return `${spec.pct}% annually`;
  if (spec.kind === "fixed_amount_per_rsf") {
    return `${dollars(spec.amount)} / RSF annually`;
  }
  if (spec.kind === "cpi") {
    const bounds = [
      spec.floorPct !== undefined ? `${spec.floorPct}% floor` : null,
      spec.capPct !== undefined ? `${spec.capPct}% cap` : null,
    ].filter(Boolean);
    return `CPI${bounds.length ? ` · ${bounds.join(" · ")}` : ""}`;
  }
  if (spec.kind === "greater_of") {
    return `Greater of ${spec.options.map(escalation).join(" or ")}`;
  }
  return spec.description;
}

function optionalRows(
  values: Array<{ label: string; value: string | null | undefined }>
): Array<{ label: string; value: string }> {
  return values.filter(
    (row): row is { label: string; value: string } => Boolean(row.value)
  );
}

export function formatStructuredPayload(
  payload: CREStructuredPayload
): FormattedTermValue {
  switch (payload.termType) {
    case "BASE_RENT": {
      const rent = payload.rent;
      if (rent.kind === "simple") {
        const summary = `${dollars(rent.amountPerRSFYear)} / RSF / yr`;
        return {
          summary,
          details: optionalRows([
            { label: "Base rent", value: summary },
            {
              label: "Structure",
              value: rent.rentStructure ? sentence(rent.rentStructure) : null,
            },
            {
              label: "Escalation",
              value: payload.inlineEscalation
                ? escalation(payload.inlineEscalation)
                : null,
            },
          ]),
        };
      }
      return {
        summary: `Stepped rent · ${rent.steps.length} ${rent.steps.length === 1 ? "period" : "periods"}`,
        details: [
          ...rent.steps.map((step) => ({
            label: periodLabel(step.startMonth, step.endMonth),
            value: `${dollars(step.amountPerRSFYear)} / RSF / yr`,
          })),
          ...optionalRows([
            {
              label: "Structure",
              value: rent.rentStructure ? sentence(rent.rentStructure) : null,
            },
            {
              label: "Escalation",
              value: payload.inlineEscalation
                ? escalation(payload.inlineEscalation)
                : null,
            },
          ]),
        ],
      };
    }
    case "FREE_RENT": {
      const abatement = payload.abatement;
      if (abatement.kind === "contiguous") {
        const percent =
          abatement.abatementType === "FULL"
            ? "100% abatement"
            : `${abatement.partialPct ?? 0}% abatement`;
        return {
          summary: `${months(abatement.months)} · ${percent}`,
          details: optionalRows([
            { label: periodLabel(1, abatement.months), value: percent },
            {
              label: "Scope",
              value: payload.scope ? sentence(payload.scope) : null,
            },
          ]),
        };
      }
      return {
        summary: `${abatement.equivalentFullMonths} equivalent full ${abatement.equivalentFullMonths === 1 ? "month" : "months"}`,
        details: [
          ...abatement.periods.map((period) => ({
            label:
              period.abatementType === "FULL"
                ? "100% abatement"
                : `${period.partialPct ?? 0}% abatement`,
            value: periodLabel(period.startMonth, period.endMonth),
          })),
          ...optionalRows([
            {
              label: "Scope",
              value: payload.scope ? sentence(payload.scope) : null,
            },
          ]),
        ],
      };
    }
    case "TI_ALLOWANCE": {
      const amount =
        payload.amount.unit === "USD_PER_RSF_YEAR"
          ? `${dollars(payload.amount.amount)} / RSF`
          : dollars(payload.amount.amount);
      return {
        summary: amount,
        details: [
          { label: "Allowance", value: amount },
          ...payload.conditions.map((value, index) => ({
            label: `Condition ${index + 1}`,
            value,
          })),
          ...optionalRows([
            { label: "Draw deadline", value: payload.drawDeadline },
            {
              label: "Unused allowance",
              value: payload.unusedConversion
                ? sentence(payload.unusedConversion)
                : null,
            },
          ]),
        ],
      };
    }
    case "RENEWAL_OPTIONS": {
      const first = payload.options[0]!;
      const samePackage = payload.options.every(
        (option) =>
          option.durationMonths === first.durationMonths &&
          option.pricingMethod === first.pricingMethod &&
          option.pricingValue === first.pricingValue
      );
      const summary = samePackage
        ? `${payload.options.length} × ${first.durationMonths / 12}-year ${payload.options.length === 1 ? "option" : "options"} · ${pricing(first.pricingMethod, first.pricingValue)}`
        : `${payload.options.length} renewal ${payload.options.length === 1 ? "option" : "options"}`;
      return {
        summary,
        details: [
          ...payload.options.flatMap((option) => [
            {
              label: `Option ${option.optionNumber}`,
              value: `${months(option.durationMonths)} · ${pricing(option.pricingMethod, option.pricingValue)}`,
            },
            ...optionalRows([
              {
                label: `Option ${option.optionNumber} notice`,
                value:
                  option.noticeLatestMonths !== undefined
                    ? `${option.noticeLatestMonths} months before expiry${option.noticeEarliestMonths !== undefined ? ` (window opens at ${option.noticeEarliestMonths} months)` : ""}`
                    : null,
              },
            ]),
            ...option.conditions.map((value, index) => ({
              label: `Option ${option.optionNumber} condition ${index + 1}`,
              value,
            })),
          ]),
          ...optionalRows([
            {
              label: "Personal to tenant",
              value:
                payload.personal === null
                  ? null
                  : payload.personal
                    ? "Yes"
                    : "No",
            },
          ]),
        ],
      };
    }
    case "TERMINATION_RIGHTS": {
      const right = payload.right;
      if (!right) {
        return {
          summary: "No termination right",
          details: [{ label: "Termination right", value: "None" }],
        };
      }
      const eligible = right.eligibleAfterYear
        ? `After Year ${right.eligibleAfterYear}`
        : right.eligibleAfterMonth
          ? `After Month ${right.eligibleAfterMonth}`
          : "Eligibility not stated";
      let fee: string | null = null;
      if (right.terminationFee?.kind === "unamortized_costs") {
        fee = right.terminationFee.description;
      } else if (right.terminationFee?.kind === "fixed_amount") {
        fee = dollars(right.terminationFee.amount.amount);
      } else if (right.terminationFee?.kind === "months_rent") {
        fee = `${months(right.terminationFee.months)} rent`;
      }
      return {
        summary: `Eligible ${eligible.toLowerCase()}${right.noticeMonths ? ` · ${right.noticeMonths}-month notice` : ""}`,
        details: [
          { label: "Eligible", value: eligible },
          ...optionalRows([
            {
              label: "Notice",
              value: right.noticeMonths ? months(right.noticeMonths) : null,
            },
            { label: "Fee", value: fee },
          ]),
          ...right.conditions.map((value, index) => ({
            label: `Condition ${index + 1}`,
            value,
          })),
        ],
      };
    }
    case "OPERATING_EXPENSES": {
      const structure = sentence(payload.structure);
      return {
        summary: [
          structure,
          payload.baseYear ? `${payload.baseYear} base year` : null,
          payload.controllableCapPct !== null
            ? `${payload.controllableCapPct}% controllable cap`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
        details: [
          { label: "Structure", value: structure },
          ...optionalRows([
            {
              label: "Base year",
              value: payload.baseYear ? String(payload.baseYear) : null,
            },
            {
              label: "Controllable cap",
              value:
                payload.controllableCapPct !== null
                  ? `${payload.controllableCapPct}%`
                  : null,
            },
            {
              label: "Taxes / insurance uncapped",
              value:
                payload.taxesInsuranceUncapped === null
                  ? null
                  : payload.taxesInsuranceUncapped
                    ? "Yes"
                    : "No",
            },
            {
              label: "Management fee",
              value:
                payload.managementFeePct !== null
                  ? `${payload.managementFeePct}%`
                  : null,
            },
          ]),
          ...payload.exclusions.map((value, index) => ({
            label: `Exclusion ${index + 1}`,
            value,
          })),
        ],
      };
    }
    case "ANNUAL_ESCALATION": {
      const value = escalation(payload.escalation);
      return {
        summary: value,
        details: optionalRows([
          { label: "Escalation", value },
          { label: "Frequency", value: sentence(payload.frequency) },
          {
            label: "First escalation",
            value: payload.firstEscalationMonth
              ? `Month ${payload.firstEscalationMonth}`
              : null,
          },
        ]),
      };
    }
    case "PARKING": {
      const rate =
        payload.ratePerSpacePerMonth !== null
          ? `${dollars(payload.ratePerSpacePerMonth)} / space / month`
          : payload.rateType
            ? sentence(payload.rateType)
            : null;
      const amount = payload.spacesCount
        ? `${payload.spacesCount} ${payload.spacesCount === 1 ? "space" : "spaces"}`
        : payload.spacesRatio;
      return {
        summary: [amount, rate].filter(Boolean).join(" · ") || "Parking terms",
        details: [
          ...optionalRows([
            {
              label: "Spaces",
              value: payload.spacesCount ? String(payload.spacesCount) : null,
            },
            { label: "Ratio", value: payload.spacesRatio },
            { label: "Rate", value: rate },
            {
              label: "Reserved",
              value:
                payload.reserved === null
                  ? null
                  : payload.reserved
                    ? "Yes"
                    : "No",
            },
          ]),
          ...payload.conditions.map((value, index) => ({
            label: `Condition ${index + 1}`,
            value,
          })),
        ],
      };
    }
    case "COMMENCEMENT_DATE": {
      const fixedDate = payload.fixedDate
        ? new Intl.DateTimeFormat("en-US", {
            dateStyle: "medium",
            timeZone: "UTC",
          }).format(new Date(`${payload.fixedDate}T00:00:00Z`))
        : null;
      const summary = fixedDate ?? "Conditional commencement";
      return {
        summary,
        details: [
          ...optionalRows([
            { label: "Commencement", value: fixedDate },
            {
              label: "Delivery guaranty",
              value: sentence(payload.deliveryGuaranty),
            },
          ]),
          ...payload.conditions.map((value, index) => ({
            label: `Condition ${index + 1}`,
            value,
          })),
        ],
      };
    }
    case "EXPANSION_RIGHTS": {
      const kind = sentence(payload.rightKind);
      return {
        summary: [kind, payload.applicableSpace].filter(Boolean).join(" · "),
        details: [
          { label: "Right", value: kind },
          ...optionalRows([
            { label: "Space", value: payload.applicableSpace },
            { label: "Trigger", value: payload.trigger },
            {
              label: "Notice",
              value: payload.noticeMonths ? months(payload.noticeMonths) : null,
            },
            {
              label: "Pricing",
              value: payload.pricingMethod
                ? pricing(payload.pricingMethod)
                : null,
            },
          ]),
          ...payload.conditions.map((value, index) => ({
            label: `Condition ${index + 1}`,
            value,
          })),
        ],
      };
    }
  }
}

export function formatLegacyTerm(
  term: Pick<
    NegotiationTermRecord,
    "normalizedValue" | "normalizedNumeric" | "normalizedUnit" | "rawValue"
  >
): FormattedTermValue {
  return {
    summary: term.normalizedValue?.trim() || term.rawValue,
    details: [
      {
        label: "Stored value",
        value: term.normalizedValue?.trim() || term.rawValue,
      },
    ],
  };
}

export function formatNumericValue(value: number, unit: string): string {
  const number = Number.isInteger(value) ? value.toString() : value.toFixed(2);
  if (unit === "USD_PER_RSF_YEAR") return `${dollars(value)} / RSF / yr`;
  if (unit === "USD") return dollars(value);
  if (unit === "PERCENT_ANNUAL") return `${number}%`;
  if (unit === "MONTHS") return months(value);
  if (unit === "MONTHS_RENT") return `${number} ${value === 1 ? "month" : "months"} rent`;
  if (unit === "RSF") return `${value.toLocaleString("en-US")} RSF`;
  if (unit === "SPACES") return `${number} ${value === 1 ? "space" : "spaces"}`;
  return number;
}
