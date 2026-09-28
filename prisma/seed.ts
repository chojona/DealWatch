import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Helper: dates relative to "now" (Sep 28, 2026)
const NOW = new Date("2026-09-28T08:00:00Z");
function daysAgo(n: number) {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}
function daysFromNow(n: number) {
  return new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);
}

async function main() {
  await prisma.negotiationTerm.deleteMany();
  await prisma.negotiationRound.deleteMany();
  await prisma.dealEvent.deleteMany();
  await prisma.obligation.deleteMany();
  await prisma.message.deleteMany();
  await prisma.thread.deleteMany();
  await prisma.deal.deleteMany();

  // ─────────────────────────────────────────────────────────────
  // DEAL 1: Landlord counterproposal received 6 days ago — no response
  // ─────────────────────────────────────────────────────────────
  const deal1 = await prisma.deal.create({
    data: {
      name: "200 Clarendon Lease — Acme Corp",
      company: "Acme Corp",
      property: "200 Clarendon Street, Boston MA",
      estimatedValue: 4_200_000,
      stage: "Negotiation",
      status: "ACTIVE",
    },
  });

  const thread1 = await prisma.thread.create({
    data: {
      dealId: deal1.id,
      subject: "Re: 200 Clarendon — Revised Economics / Counter Proposal",
      participants: JSON.stringify([
        "Sarah Chen <s.chen@jllboston.com>",
        "Marcus Webb <m.webb@acmecorp.com>",
        "Derek Hollis <d.hollis@bostonproperties.com>",
        "Amanda Torres <a.torres@acmecorp.com>",
      ]),
    },
  });

  const msg1a = await prisma.message.create({
    data: {
      threadId: thread1.id,
      sender: "Sarah Chen <s.chen@jllboston.com>",
      recipients: JSON.stringify([
        "Derek Hollis <d.hollis@bostonproperties.com>",
      ]),
      sentAt: daysAgo(12),
      body: `Derek,

Per our conversation yesterday, here is a summary of Acme Corp's proposal for 200 Clarendon:

- Term: 7 years
- Square footage: 22,400 RSF (floors 18-19)
- Base rent: $68.00/RSF NNN, with 3% annual escalations
- Free rent: 6 months
- TI allowance: $125/RSF
- Commencement: March 1, 2027

Please let me know if you need any additional information.

Best,
Sarah Chen
Senior VP, Tenant Representation | JLL Boston`,
    },
  });

  const msg1b = await prisma.message.create({
    data: {
      threadId: thread1.id,
      sender: "Derek Hollis <d.hollis@bostonproperties.com>",
      recipients: JSON.stringify([
        "Sarah Chen <s.chen@jllboston.com>",
        "Marcus Webb <m.webb@acmecorp.com>",
        "Amanda Torres <a.torres@acmecorp.com>",
      ]),
      sentAt: daysAgo(6),
      body: `Sarah, Marcus, Amanda,

Thank you for your proposal. Attached are our revised economics for the 200 Clarendon opportunity. Key changes from our last position:

- Base rent: $72.50/RSF, escalating 2.5% annually
- Free rent: 4 months (we cannot go above 4 months given our financing covenants)
- TI allowance: $110/RSF — we can revisit if the deal terms otherwise align
- We are agreeable to the 7-year term
- We need a lease execution by November 15, 2026 to fit our Q4 schedule

We believe this is a competitive offer for the submarket and hope we can align. Happy to schedule a call this week.

Derek Hollis
Director of Leasing | Boston Properties`,
    },
  });

  await prisma.obligation.create({
    data: {
      dealId: deal1.id,
      messageId: msg1b.id,
      owner: "Sarah Chen",
      counterparty: "Derek Hollis",
      description:
        "Review landlord's revised economics and respond with broker/client position",
      dueAt: daysAgo(3),
      status: "OVERDUE",
      confidence: 0.97,
      evidenceQuote:
        "Attached are our revised economics for the 200 Clarendon opportunity.",
    },
  });

  await prisma.obligation.create({
    data: {
      dealId: deal1.id,
      messageId: msg1b.id,
      owner: "Acme Corp",
      counterparty: "Boston Properties",
      description: "Execute lease by November 15, 2026 per landlord deadline",
      dueAt: new Date("2026-11-15T23:59:00Z"),
      status: "OPEN",
      confidence: 0.95,
      evidenceQuote:
        "We need a lease execution by November 15, 2026 to fit our Q4 schedule.",
    },
  });

  await prisma.dealEvent.createMany({
    data: [
      {
        dealId: deal1.id,
        messageId: msg1a.id,
        type: "PROPOSAL_SENT",
        description: "Tenant submitted initial proposal: $68/RSF, 7yr, $125 TI",
        occurredAt: daysAgo(12),
        confidence: 0.99,
        evidenceQuote:
          "Base rent: $68.00/RSF NNN, with 3% annual escalations",
      },
      {
        dealId: deal1.id,
        messageId: msg1b.id,
        type: "COUNTER_RECEIVED",
        description:
          "Landlord issued counter: $72.50/RSF, $110 TI, 4mo free rent. Nov 15 lease execution deadline.",
        occurredAt: daysAgo(6),
        confidence: 0.99,
        evidenceQuote:
          "Base rent: $72.50/RSF, escalating 2.5% annually",
      },
      {
        dealId: deal1.id,
        messageId: msg1b.id,
        type: "DEADLINE_SET",
        description: "Landlord requires lease execution by November 15, 2026",
        occurredAt: daysAgo(6),
        confidence: 0.95,
        evidenceQuote:
          "We need a lease execution by November 15, 2026 to fit our Q4 schedule.",
      },
    ],
  });

  // Four-round negotiation history for the transaction-intelligence demo.
  const tenantR1Text = `TENANT LETTER OF INTENT — SEPTEMBER 1, 2026
Premises: Approximately 22,400 rentable square feet on floors 18 and 19.
Lease Term: Ten (10) years.
Base Rent: $61.00 per rentable square foot per year, triple net, with 2.5% annual increases.
Tenant Improvement Allowance: $125.00 per rentable square foot.
Rent Abatement: Eight (8) months of base rent abatement.
Security Deposit: One (1) month of then-current base rent.
Renewal: Two (2) additional five-year renewal options at fair market rent.
Termination: Tenant may terminate after the fifth lease year upon nine months' notice and payment of unamortized transaction costs.
Commencement: March 1, 2027.
Delivery: Premises delivered broom-clean with building systems in good working order.`;

  await prisma.negotiationRound.create({
    data: {
      dealId: deal1.id,
      side: "TENANT",
      roundNumber: 1,
      documentName: "Tenant LOI — Initial Proposal",
      documentText: tenantR1Text,
      documentDate: daysAgo(28),
      terms: {
        create: [
          { canonicalType: "PREMISES_RSF", normalizedValue: "22,400 RSF", normalizedNumeric: 22400, normalizedUnit: "RSF", rawValue: "Approximately 22,400 rentable square feet", status: "PROPOSED", side: "TENANT", roundNumber: 1, confidence: 0.99, evidenceQuote: "Premises: Approximately 22,400 rentable square feet on floors 18 and 19.", sourceLocation: "Premises" },
          { canonicalType: "LEASE_TERM", normalizedValue: "120 months", normalizedNumeric: 120, normalizedUnit: "MONTHS", rawValue: "Ten (10) years", status: "PROPOSED", side: "TENANT", roundNumber: 1, confidence: 0.99, evidenceQuote: "Lease Term: Ten (10) years.", sourceLocation: "Lease Term" },
          { canonicalType: "BASE_RENT", normalizedValue: "$61.00/RSF/year", normalizedNumeric: 61, normalizedUnit: "USD_PER_RSF_YEAR", rawValue: "$61.00 per rentable square foot per year", status: "PROPOSED", side: "TENANT", roundNumber: 1, confidence: 0.99, evidenceQuote: "Base Rent: $61.00 per rentable square foot per year, triple net, with 2.5% annual increases.", sourceLocation: "Base Rent" },
          { canonicalType: "RENT_STRUCTURE", normalizedValue: "Triple net", rawValue: "triple net", status: "PROPOSED", side: "TENANT", roundNumber: 1, confidence: 0.98, evidenceQuote: "Base Rent: $61.00 per rentable square foot per year, triple net, with 2.5% annual increases.", sourceLocation: "Base Rent" },
          { canonicalType: "ANNUAL_ESCALATION", normalizedValue: "2.5% annually", normalizedNumeric: 2.5, normalizedUnit: "PERCENT_ANNUAL", rawValue: "2.5% annual increases", status: "PROPOSED", side: "TENANT", roundNumber: 1, confidence: 0.99, evidenceQuote: "Base Rent: $61.00 per rentable square foot per year, triple net, with 2.5% annual increases.", sourceLocation: "Base Rent" },
          { canonicalType: "TI_ALLOWANCE", normalizedValue: "$125.00/RSF", normalizedNumeric: 125, normalizedUnit: "USD_PER_RSF_YEAR", rawValue: "$125.00 per rentable square foot", status: "PROPOSED", side: "TENANT", roundNumber: 1, confidence: 0.99, evidenceQuote: "Tenant Improvement Allowance: $125.00 per rentable square foot.", sourceLocation: "Tenant Improvement Allowance" },
          { canonicalType: "FREE_RENT", normalizedValue: "8 months", normalizedNumeric: 8, normalizedUnit: "MONTHS", rawValue: "Eight (8) months", status: "PROPOSED", side: "TENANT", roundNumber: 1, confidence: 0.99, evidenceQuote: "Rent Abatement: Eight (8) months of base rent abatement.", sourceLocation: "Rent Abatement" },
          { canonicalType: "SECURITY_DEPOSIT", normalizedValue: "1 month rent", normalizedNumeric: 1, normalizedUnit: "MONTHS_RENT", rawValue: "One (1) month of then-current base rent", status: "PROPOSED", side: "TENANT", roundNumber: 1, confidence: 0.98, evidenceQuote: "Security Deposit: One (1) month of then-current base rent.", sourceLocation: "Security Deposit" },
          { canonicalType: "RENEWAL_OPTIONS", normalizedValue: "Two 5-year options at FMR", rawValue: "Two (2) additional five-year renewal options at fair market rent", status: "PROPOSED", side: "TENANT", roundNumber: 1, confidence: 0.98, evidenceQuote: "Renewal: Two (2) additional five-year renewal options at fair market rent.", sourceLocation: "Renewal" },
          { canonicalType: "TERMINATION_RIGHTS", normalizedValue: "Tenant option after year 5", rawValue: "terminate after the fifth lease year", status: "PROPOSED", side: "TENANT", roundNumber: 1, confidence: 0.98, evidenceQuote: "Termination: Tenant may terminate after the fifth lease year upon nine months' notice and payment of unamortized transaction costs.", sourceLocation: "Termination" },
          { canonicalType: "COMMENCEMENT_DATE", normalizedValue: "2027-03-01", normalizedUnit: "DATE", rawValue: "March 1, 2027", status: "PROPOSED", side: "TENANT", roundNumber: 1, confidence: 0.99, evidenceQuote: "Commencement: March 1, 2027.", sourceLocation: "Commencement" },
          { canonicalType: "DELIVERY_CONDITION", normalizedValue: "Broom-clean; systems operational", rawValue: "broom-clean with building systems in good working order", status: "PROPOSED", side: "TENANT", roundNumber: 1, confidence: 0.97, evidenceQuote: "Delivery: Premises delivered broom-clean with building systems in good working order.", sourceLocation: "Delivery" },
        ],
      },
    },
  });

  const landlordR1Text = `LANDLORD COUNTERPROPOSAL — SEPTEMBER 8, 2026
Landlord accepts the proposed 22,400 RSF premises.
Lease Term: Seven (7) years.
Base Rent: $72.00 per RSF per year, NNN, increasing 3.0% each year.
TI Allowance: $80.00 per RSF.
Free Rent: Four (4) months.
Security: Three (3) months of base rent.
Renewal: One five-year option at 100% of fair market rent.
Termination: Tenant's requested early termination right is rejected.
Commencement: April 1, 2027, subject to existing tenant surrender.
Delivery: As-is, where-is, with Landlord maintaining base building systems.`;

  await prisma.negotiationRound.create({
    data: {
      dealId: deal1.id,
      side: "LANDLORD",
      roundNumber: 1,
      documentName: "Landlord Counter — Round 1",
      documentText: landlordR1Text,
      documentDate: daysAgo(21),
      terms: { create: [
        { canonicalType: "PREMISES_RSF", normalizedValue: "22,400 RSF", normalizedNumeric: 22400, normalizedUnit: "RSF", rawValue: "22,400 RSF", status: "AGREED", side: "LANDLORD", roundNumber: 1, confidence: 0.99, evidenceQuote: "Landlord accepts the proposed 22,400 RSF premises.", sourceLocation: "Opening" },
        { canonicalType: "LEASE_TERM", normalizedValue: "84 months", normalizedNumeric: 84, normalizedUnit: "MONTHS", rawValue: "Seven (7) years", status: "PROPOSED", side: "LANDLORD", roundNumber: 1, confidence: 0.99, evidenceQuote: "Lease Term: Seven (7) years.", sourceLocation: "Lease Term" },
        { canonicalType: "BASE_RENT", normalizedValue: "$72.00/RSF/year", normalizedNumeric: 72, normalizedUnit: "USD_PER_RSF_YEAR", rawValue: "$72.00 per RSF per year", status: "PROPOSED", side: "LANDLORD", roundNumber: 1, confidence: 0.99, evidenceQuote: "Base Rent: $72.00 per RSF per year, NNN, increasing 3.0% each year.", sourceLocation: "Base Rent" },
        { canonicalType: "RENT_STRUCTURE", normalizedValue: "Triple net", rawValue: "NNN", status: "PROPOSED", side: "LANDLORD", roundNumber: 1, confidence: 0.99, evidenceQuote: "Base Rent: $72.00 per RSF per year, NNN, increasing 3.0% each year.", sourceLocation: "Base Rent" },
        { canonicalType: "ANNUAL_ESCALATION", normalizedValue: "3.0% annually", normalizedNumeric: 3, normalizedUnit: "PERCENT_ANNUAL", rawValue: "increasing 3.0% each year", status: "PROPOSED", side: "LANDLORD", roundNumber: 1, confidence: 0.99, evidenceQuote: "Base Rent: $72.00 per RSF per year, NNN, increasing 3.0% each year.", sourceLocation: "Base Rent" },
        { canonicalType: "TI_ALLOWANCE", normalizedValue: "$80.00/RSF", normalizedNumeric: 80, normalizedUnit: "USD_PER_RSF_YEAR", rawValue: "$80.00 per RSF", status: "PROPOSED", side: "LANDLORD", roundNumber: 1, confidence: 0.99, evidenceQuote: "TI Allowance: $80.00 per RSF.", sourceLocation: "TI Allowance" },
        { canonicalType: "FREE_RENT", normalizedValue: "4 months", normalizedNumeric: 4, normalizedUnit: "MONTHS", rawValue: "Four (4) months", status: "PROPOSED", side: "LANDLORD", roundNumber: 1, confidence: 0.99, evidenceQuote: "Free Rent: Four (4) months.", sourceLocation: "Free Rent" },
        { canonicalType: "SECURITY_DEPOSIT", normalizedValue: "3 months rent", normalizedNumeric: 3, normalizedUnit: "MONTHS_RENT", rawValue: "Three (3) months of base rent", status: "PROPOSED", side: "LANDLORD", roundNumber: 1, confidence: 0.99, evidenceQuote: "Security: Three (3) months of base rent.", sourceLocation: "Security" },
        { canonicalType: "RENEWAL_OPTIONS", normalizedValue: "One 5-year option at FMR", rawValue: "One five-year option at 100% of fair market rent", status: "PROPOSED", side: "LANDLORD", roundNumber: 1, confidence: 0.98, evidenceQuote: "Renewal: One five-year option at 100% of fair market rent.", sourceLocation: "Renewal" },
        { canonicalType: "TERMINATION_RIGHTS", normalizedValue: "No tenant termination right", rawValue: "early termination right is rejected", status: "REJECTED", side: "LANDLORD", roundNumber: 1, confidence: 0.99, evidenceQuote: "Termination: Tenant's requested early termination right is rejected.", sourceLocation: "Termination" },
        { canonicalType: "COMMENCEMENT_DATE", normalizedValue: "2027-04-01", normalizedUnit: "DATE", rawValue: "April 1, 2027", status: "UNRESOLVED", side: "LANDLORD", roundNumber: 1, confidence: 0.95, evidenceQuote: "Commencement: April 1, 2027, subject to existing tenant surrender.", sourceLocation: "Commencement" },
        { canonicalType: "DELIVERY_CONDITION", normalizedValue: "As-is; base systems operational", rawValue: "As-is, where-is", status: "PROPOSED", side: "LANDLORD", roundNumber: 1, confidence: 0.98, evidenceQuote: "Delivery: As-is, where-is, with Landlord maintaining base building systems.", sourceLocation: "Delivery" },
      ] },
    },
  });

  const tenantR2Text = `TENANT COUNTERPROPOSAL — SEPTEMBER 15, 2026
Tenant agrees to the 22,400 RSF premises and the seven-year lease term.
Base Rent: $64.00 per RSF per year with 2.75% annual increases.
TI Allowance: $115.00 per RSF.
Free Rent: Six (6) months.
Security Deposit: Two (2) months of base rent.
Renewal: Tenant accepts one five-year renewal option at fair market rent.
Termination: Tenant revises its request to a one-time termination option after lease year six with twelve months' notice.
Commencement: Tenant can accept April 1, 2027 if Landlord guarantees delivery.
Operating Expenses: Tenant requests a controllable expense cap of 5% annually.`;

  await prisma.negotiationRound.create({
    data: {
      dealId: deal1.id, side: "TENANT", roundNumber: 2,
      documentName: "Tenant Counter — Round 2", documentText: tenantR2Text, documentDate: daysAgo(14),
      terms: { create: [
        { canonicalType: "PREMISES_RSF", normalizedValue: "22,400 RSF", normalizedNumeric: 22400, normalizedUnit: "RSF", rawValue: "22,400 RSF premises", status: "AGREED", side: "TENANT", roundNumber: 2, confidence: 0.99, evidenceQuote: "Tenant agrees to the 22,400 RSF premises and the seven-year lease term.", sourceLocation: "Opening" },
        { canonicalType: "LEASE_TERM", normalizedValue: "84 months", normalizedNumeric: 84, normalizedUnit: "MONTHS", rawValue: "seven-year lease term", status: "AGREED", side: "TENANT", roundNumber: 2, confidence: 0.99, evidenceQuote: "Tenant agrees to the 22,400 RSF premises and the seven-year lease term.", sourceLocation: "Opening" },
        { canonicalType: "BASE_RENT", normalizedValue: "$64.00/RSF/year", normalizedNumeric: 64, normalizedUnit: "USD_PER_RSF_YEAR", rawValue: "$64.00 per RSF per year", status: "PROPOSED", side: "TENANT", roundNumber: 2, confidence: 0.99, evidenceQuote: "Base Rent: $64.00 per RSF per year with 2.75% annual increases.", sourceLocation: "Base Rent" },
        { canonicalType: "ANNUAL_ESCALATION", normalizedValue: "2.75% annually", normalizedNumeric: 2.75, normalizedUnit: "PERCENT_ANNUAL", rawValue: "2.75% annual increases", status: "PROPOSED", side: "TENANT", roundNumber: 2, confidence: 0.99, evidenceQuote: "Base Rent: $64.00 per RSF per year with 2.75% annual increases.", sourceLocation: "Base Rent" },
        { canonicalType: "TI_ALLOWANCE", normalizedValue: "$115.00/RSF", normalizedNumeric: 115, normalizedUnit: "USD_PER_RSF_YEAR", rawValue: "$115.00 per RSF", status: "PROPOSED", side: "TENANT", roundNumber: 2, confidence: 0.99, evidenceQuote: "TI Allowance: $115.00 per RSF.", sourceLocation: "TI Allowance" },
        { canonicalType: "FREE_RENT", normalizedValue: "6 months", normalizedNumeric: 6, normalizedUnit: "MONTHS", rawValue: "Six (6) months", status: "PROPOSED", side: "TENANT", roundNumber: 2, confidence: 0.99, evidenceQuote: "Free Rent: Six (6) months.", sourceLocation: "Free Rent" },
        { canonicalType: "SECURITY_DEPOSIT", normalizedValue: "2 months rent", normalizedNumeric: 2, normalizedUnit: "MONTHS_RENT", rawValue: "Two (2) months of base rent", status: "PROPOSED", side: "TENANT", roundNumber: 2, confidence: 0.99, evidenceQuote: "Security Deposit: Two (2) months of base rent.", sourceLocation: "Security Deposit" },
        { canonicalType: "RENEWAL_OPTIONS", normalizedValue: "One 5-year option at FMR", rawValue: "one five-year renewal option at fair market rent", status: "AGREED", side: "TENANT", roundNumber: 2, confidence: 0.99, evidenceQuote: "Renewal: Tenant accepts one five-year renewal option at fair market rent.", sourceLocation: "Renewal" },
        { canonicalType: "TERMINATION_RIGHTS", normalizedValue: "Tenant option after year 6", rawValue: "one-time termination option after lease year six with twelve months' notice", status: "PROPOSED", side: "TENANT", roundNumber: 2, confidence: 0.98, evidenceQuote: "Termination: Tenant revises its request to a one-time termination option after lease year six with twelve months' notice.", sourceLocation: "Termination" },
        { canonicalType: "COMMENCEMENT_DATE", normalizedValue: "2027-04-01", normalizedUnit: "DATE", rawValue: "April 1, 2027", status: "UNRESOLVED", side: "TENANT", roundNumber: 2, confidence: 0.96, evidenceQuote: "Commencement: Tenant can accept April 1, 2027 if Landlord guarantees delivery.", sourceLocation: "Commencement" },
        { canonicalType: "OPERATING_EXPENSES", normalizedValue: "5% controllable expense cap", normalizedNumeric: 5, normalizedUnit: "PERCENT_ANNUAL", rawValue: "controllable expense cap of 5% annually", status: "PROPOSED", side: "TENANT", roundNumber: 2, confidence: 0.98, evidenceQuote: "Operating Expenses: Tenant requests a controllable expense cap of 5% annually.", sourceLocation: "Operating Expenses" },
      ] },
    },
  });

  const landlordR2Text = `LANDLORD COUNTERPROPOSAL — SEPTEMBER 22, 2026
Agreed: 22,400 RSF, seven-year term, two months' security deposit, and one five-year renewal option at fair market rent.
Base Rent: $67.00 per RSF per year with 2.75% annual increases.
TI Allowance: $105.00 per RSF.
Free Rent: Five (5) months.
Commencement: April 1, 2027 remains subject to timely surrender by the existing tenant; delivery guaranty remains unresolved.
Termination: Landlord rejects any early termination option.
Operating Expenses: Landlord proposes no cap on taxes or insurance and a 7% cap on controllable expenses.
Agreed Delivery: Landlord will deliver broom-clean with base building systems in good working order.`;

  await prisma.negotiationRound.create({
    data: {
      dealId: deal1.id, side: "LANDLORD", roundNumber: 2,
      documentName: "Landlord Counter — Round 2", documentText: landlordR2Text, documentDate: daysAgo(7),
      terms: { create: [
        { canonicalType: "PREMISES_RSF", normalizedValue: "22,400 RSF", normalizedNumeric: 22400, normalizedUnit: "RSF", rawValue: "22,400 RSF", status: "AGREED", side: "LANDLORD", roundNumber: 2, confidence: 0.99, evidenceQuote: "Agreed: 22,400 RSF, seven-year term, two months' security deposit, and one five-year renewal option at fair market rent.", sourceLocation: "Agreed Terms" },
        { canonicalType: "LEASE_TERM", normalizedValue: "84 months", normalizedNumeric: 84, normalizedUnit: "MONTHS", rawValue: "seven-year term", status: "AGREED", side: "LANDLORD", roundNumber: 2, confidence: 0.99, evidenceQuote: "Agreed: 22,400 RSF, seven-year term, two months' security deposit, and one five-year renewal option at fair market rent.", sourceLocation: "Agreed Terms" },
        { canonicalType: "SECURITY_DEPOSIT", normalizedValue: "2 months rent", normalizedNumeric: 2, normalizedUnit: "MONTHS_RENT", rawValue: "two months' security deposit", status: "AGREED", side: "LANDLORD", roundNumber: 2, confidence: 0.99, evidenceQuote: "Agreed: 22,400 RSF, seven-year term, two months' security deposit, and one five-year renewal option at fair market rent.", sourceLocation: "Agreed Terms" },
        { canonicalType: "RENEWAL_OPTIONS", normalizedValue: "One 5-year option at FMR", rawValue: "one five-year renewal option at fair market rent", status: "AGREED", side: "LANDLORD", roundNumber: 2, confidence: 0.99, evidenceQuote: "Agreed: 22,400 RSF, seven-year term, two months' security deposit, and one five-year renewal option at fair market rent.", sourceLocation: "Agreed Terms" },
        { canonicalType: "BASE_RENT", normalizedValue: "$67.00/RSF/year", normalizedNumeric: 67, normalizedUnit: "USD_PER_RSF_YEAR", rawValue: "$67.00 per RSF per year", status: "PROPOSED", side: "LANDLORD", roundNumber: 2, confidence: 0.99, evidenceQuote: "Base Rent: $67.00 per RSF per year with 2.75% annual increases.", sourceLocation: "Base Rent" },
        { canonicalType: "ANNUAL_ESCALATION", normalizedValue: "2.75% annually", normalizedNumeric: 2.75, normalizedUnit: "PERCENT_ANNUAL", rawValue: "2.75% annual increases", status: "PROPOSED", side: "LANDLORD", roundNumber: 2, confidence: 0.99, evidenceQuote: "Base Rent: $67.00 per RSF per year with 2.75% annual increases.", sourceLocation: "Base Rent" },
        { canonicalType: "TI_ALLOWANCE", normalizedValue: "$105.00/RSF", normalizedNumeric: 105, normalizedUnit: "USD_PER_RSF_YEAR", rawValue: "$105.00 per RSF", status: "PROPOSED", side: "LANDLORD", roundNumber: 2, confidence: 0.99, evidenceQuote: "TI Allowance: $105.00 per RSF.", sourceLocation: "TI Allowance" },
        { canonicalType: "FREE_RENT", normalizedValue: "5 months", normalizedNumeric: 5, normalizedUnit: "MONTHS", rawValue: "Five (5) months", status: "PROPOSED", side: "LANDLORD", roundNumber: 2, confidence: 0.99, evidenceQuote: "Free Rent: Five (5) months.", sourceLocation: "Free Rent" },
        { canonicalType: "COMMENCEMENT_DATE", normalizedValue: "2027-04-01", normalizedUnit: "DATE", rawValue: "April 1, 2027", status: "UNRESOLVED", side: "LANDLORD", roundNumber: 2, confidence: 0.98, evidenceQuote: "Commencement: April 1, 2027 remains subject to timely surrender by the existing tenant; delivery guaranty remains unresolved.", sourceLocation: "Commencement" },
        { canonicalType: "TERMINATION_RIGHTS", normalizedValue: "No tenant termination right", rawValue: "rejects any early termination option", status: "REJECTED", side: "LANDLORD", roundNumber: 2, confidence: 0.99, evidenceQuote: "Termination: Landlord rejects any early termination option.", sourceLocation: "Termination" },
        { canonicalType: "OPERATING_EXPENSES", normalizedValue: "7% controllable expense cap; tax/insurance uncapped", normalizedNumeric: 7, normalizedUnit: "PERCENT_ANNUAL", rawValue: "no cap on taxes or insurance and a 7% cap on controllable expenses", status: "PROPOSED", side: "LANDLORD", roundNumber: 2, confidence: 0.98, evidenceQuote: "Operating Expenses: Landlord proposes no cap on taxes or insurance and a 7% cap on controllable expenses.", sourceLocation: "Operating Expenses" },
        { canonicalType: "DELIVERY_CONDITION", normalizedValue: "Broom-clean; base systems operational", rawValue: "broom-clean with base building systems in good working order", status: "AGREED", side: "LANDLORD", roundNumber: 2, confidence: 0.99, evidenceQuote: "Agreed Delivery: Landlord will deliver broom-clean with base building systems in good working order.", sourceLocation: "Delivery" },
      ] },
    },
  });

  // ─────────────────────────────────────────────────────────────
  // DEAL 2: Broker promised client market survey by today
  // ─────────────────────────────────────────────────────────────
  const deal2 = await prisma.deal.create({
    data: {
      name: "Seaport Office Search — Meridian Financial",
      company: "Meridian Financial Group",
      property: "Boston Seaport District",
      estimatedValue: 6_800_000,
      stage: "Market Survey",
      status: "ACTIVE",
    },
  });

  const thread2 = await prisma.thread.create({
    data: {
      dealId: deal2.id,
      subject: "Meridian — Seaport Office Requirements / Market Tour",
      participants: JSON.stringify([
        "James Park <j.park@cushwake.com>",
        "Linda Forsythe <l.forsythe@meridianfg.com>",
        "Tom Kaplan <t.kaplan@cushwake.com>",
      ]),
    },
  });

  const msg2a = await prisma.message.create({
    data: {
      threadId: thread2.id,
      sender: "Linda Forsythe <l.forsythe@meridianfg.com>",
      recipients: JSON.stringify([
        "James Park <j.park@cushwake.com>",
        "Tom Kaplan <t.kaplan@cushwake.com>",
      ]),
      sentAt: daysAgo(9),
      body: `James, Tom,

Following our kickoff meeting, here are our confirmed requirements:

- Size: 18,000–22,000 RSF
- Location: Seaport preferred; Financial District as alternative
- Timeline: Ideally in new space by Q2 2027
- Term: 10 years
- Budget: Up to $80/RSF gross equivalent
- Must-have: Column-free floors, water views preferred, LEED certified building

Can you get us a first-cut market survey this week? Our board meets September 28th and we'd love to have options in front of them.

Linda
CFO | Meridian Financial Group`,
    },
  });

  const msg2b = await prisma.message.create({
    data: {
      threadId: thread2.id,
      sender: "James Park <j.park@cushwake.com>",
      recipients: JSON.stringify([
        "Linda Forsythe <l.forsythe@meridianfg.com>",
        "Tom Kaplan <t.kaplan@cushwake.com>",
      ]),
      sentAt: daysAgo(8),
      body: `Linda,

Great meeting everyone. Tom and I are on it. We'll have a revised market survey to you by end of day Monday (September 28th) — in time for your board meeting.

We're tracking 6–8 strong options in the Seaport that match your criteria. I'll include rent comps and a brief on the submarket velocity so your board has full context.

Talk soon,
James Park
Executive Director | Cushman & Wakefield`,
    },
  });

  await prisma.obligation.create({
    data: {
      dealId: deal2.id,
      messageId: msg2b.id,
      owner: "James Park",
      counterparty: "Linda Forsythe",
      description:
        "Deliver revised market survey to Meridian board — committed for end of day today",
      dueAt: new Date("2026-09-28T18:00:00Z"),
      status: "OVERDUE",
      confidence: 0.98,
      evidenceQuote:
        "We'll have a revised market survey to you by end of day Monday (September 28th) — in time for your board meeting.",
    },
  });

  await prisma.dealEvent.createMany({
    data: [
      {
        dealId: deal2.id,
        messageId: msg2a.id,
        type: "REQUIREMENTS_CONFIRMED",
        description:
          "Client confirmed requirements: 18–22k RSF, Seaport, $80/RSF gross, Q2 2027",
        occurredAt: daysAgo(9),
        confidence: 0.99,
        evidenceQuote: "Size: 18,000–22,000 RSF",
      },
      {
        dealId: deal2.id,
        messageId: msg2b.id,
        type: "COMMITMENT_MADE",
        description:
          "Broker committed to delivering market survey by EOD September 28",
        occurredAt: daysAgo(8),
        confidence: 0.98,
        evidenceQuote:
          "We'll have a revised market survey to you by end of day Monday (September 28th)",
      },
    ],
  });

  // ─────────────────────────────────────────────────────────────
  // DEAL 3: Client said follow up after board meeting — date has passed
  // ─────────────────────────────────────────────────────────────
  const deal3 = await prisma.deal.create({
    data: {
      name: "Kendall Square HQ — NovaBio Sciences",
      company: "NovaBio Sciences",
      property: "Kendall Square, Cambridge MA",
      estimatedValue: 12_400_000,
      stage: "Prospect",
      status: "ACTIVE",
    },
  });

  const thread3 = await prisma.thread.create({
    data: {
      dealId: deal3.id,
      subject: "NovaBio — Kendall Square HQ Search",
      participants: JSON.stringify([
        "Rachel Kim <r.kim@newmark.com>",
        "Dr. Anand Patel <a.patel@novabiosciences.com>",
        "Stephanie Moore <s.moore@newmark.com>",
      ]),
    },
  });

  const msg3a = await prisma.message.create({
    data: {
      threadId: thread3.id,
      sender: "Rachel Kim <r.kim@newmark.com>",
      recipients: JSON.stringify([
        "Dr. Anand Patel <a.patel@novabiosciences.com>",
      ]),
      sentAt: daysAgo(18),
      body: `Anand,

Hope you're well. Following our initial tour last month of the Kendall Square options, I wanted to check in and see if NovaBio is ready to move into the RFP stage.

We're seeing strong demand in Kendall — several of the spaces we looked at had 2–3 groups active. Timing is important if we want leverage.

Are you in a position to move forward?

Rachel Kim
Managing Director | Newmark`,
    },
  });

  const msg3b = await prisma.message.create({
    data: {
      threadId: thread3.id,
      sender: "Dr. Anand Patel <a.patel@novabiosciences.com>",
      recipients: JSON.stringify(["Rachel Kim <r.kim@newmark.com>"]),
      sentAt: daysAgo(17),
      body: `Rachel,

Thanks for the follow-up. The tours were very helpful — we're between two scenarios internally (expanding Kendall vs. Cambridge Crossing).

Our board meets on September 24th to finalize the real estate strategy. Please follow up with me after September 25th and I'll have a clear answer for you on how we want to proceed.

Best,
Dr. Anand Patel
CEO | NovaBio Sciences`,
    },
  });

  await prisma.obligation.create({
    data: {
      dealId: deal3.id,
      messageId: msg3b.id,
      owner: "Rachel Kim",
      counterparty: "Dr. Anand Patel",
      description:
        "Follow up with NovaBio CEO after board meeting — client explicitly requested contact after September 25th",
      dueAt: daysAgo(2),
      status: "OVERDUE",
      confidence: 0.99,
      evidenceQuote:
        "Please follow up with me after September 25th and I'll have a clear answer for you.",
    },
  });

  await prisma.dealEvent.createMany({
    data: [
      {
        dealId: deal3.id,
        messageId: msg3a.id,
        type: "FOLLOW_UP_SENT",
        description: "Broker followed up on Kendall Square tour, flagged market velocity",
        occurredAt: daysAgo(18),
        confidence: 0.97,
        evidenceQuote: "We're seeing strong demand in Kendall — several of the spaces we looked at had 2–3 groups active.",
      },
      {
        dealId: deal3.id,
        messageId: msg3b.id,
        type: "BOARD_MEETING_SCHEDULED",
        description:
          "Client board meeting set for September 24 to decide real estate strategy",
        occurredAt: daysAgo(17),
        confidence: 0.99,
        evidenceQuote: "Our board meets on September 24th to finalize the real estate strategy.",
      },
    ],
  });

  // ─────────────────────────────────────────────────────────────
  // DEAL 4: Waiting on landlord for revised TI allowance
  // ─────────────────────────────────────────────────────────────
  const deal4 = await prisma.deal.create({
    data: {
      name: "One Financial Center — Vertex Capital",
      company: "Vertex Capital Partners",
      property: "One Financial Center, Boston MA",
      estimatedValue: 3_150_000,
      stage: "LOI",
      status: "ACTIVE",
    },
  });

  const thread4 = await prisma.thread.create({
    data: {
      dealId: deal4.id,
      subject: "Vertex Capital — One Financial Center LOI / TI Negotiation",
      participants: JSON.stringify([
        "Tom Kaplan <t.kaplan@cushwake.com>",
        "Neil Shanahan <n.shanahan@vertexcapital.com>",
        "Peter Lau <p.lau@equitycommonwealth.com>",
        "Greg Hoffmann <g.hoffmann@equitycommonwealth.com>",
      ]),
    },
  });

  const msg4a = await prisma.message.create({
    data: {
      threadId: thread4.id,
      sender: "Tom Kaplan <t.kaplan@cushwake.com>",
      recipients: JSON.stringify([
        "Peter Lau <p.lau@equitycommonwealth.com>",
        "Greg Hoffmann <g.hoffmann@equitycommonwealth.com>",
      ]),
      sentAt: daysAgo(14),
      body: `Peter, Greg,

Attached please find the signed LOI from Vertex Capital Partners for floors 22–23 at One Financial Center (14,800 RSF).

Key negotiated terms in the LOI:
- Lease term: 5 years
- Base rent: $62.00/RSF NNN, 3% annual bumps
- Free rent: 3 months
- TI allowance: $95/RSF (this remains open — Neil wants $115/RSF to complete the build-out they've planned)

Neil's build-out contractor has estimated the work at approximately $1.7M total, which drives his TI ask. The gap is ~$296K in landlord economics.

Please come back to us on the TI. We'd like to get this resolved this week so we can move to lease drafting.

Tom Kaplan
Executive Director | Cushman & Wakefield`,
    },
  });

  const msg4b = await prisma.message.create({
    data: {
      threadId: thread4.id,
      sender: "Peter Lau <p.lau@equitycommonwealth.com>",
      recipients: JSON.stringify([
        "Tom Kaplan <t.kaplan@cushwake.com>",
        "Greg Hoffmann <g.hoffmann@equitycommonwealth.com>",
      ]),
      sentAt: daysAgo(13),
      body: `Tom,

Received the LOI, thank you. The TI ask is meaningful given our basis in the building. We need to run this by our investment committee.

We expect to have an updated TI position back to you by end of this week (September 25th). If there is any flexibility on tenant's side, that would help us get there.

Peter Lau
VP Asset Management | Equity Commonwealth`,
    },
  });

  await prisma.obligation.create({
    data: {
      dealId: deal4.id,
      messageId: msg4b.id,
      owner: "Peter Lau",
      counterparty: "Tom Kaplan",
      description:
        "Return revised TI allowance position — landlord committed to response by September 25th",
      dueAt: new Date("2026-09-25T18:00:00Z"),
      status: "OVERDUE",
      confidence: 0.97,
      evidenceQuote:
        "We expect to have an updated TI position back to you by end of this week (September 25th).",
    },
  });

  await prisma.obligation.create({
    data: {
      dealId: deal4.id,
      messageId: msg4a.id,
      owner: "Neil Shanahan",
      counterparty: "Peter Lau",
      description: "Consider flexibility on TI allowance to bridge the $296K gap",
      dueAt: null,
      status: "WAITING",
      confidence: 0.82,
      evidenceQuote:
        "If there is any flexibility on tenant's side, that would help us get there.",
    },
  });

  await prisma.dealEvent.createMany({
    data: [
      {
        dealId: deal4.id,
        messageId: msg4a.id,
        type: "LOI_SUBMITTED",
        description:
          "Signed LOI submitted for 14,800 RSF at One Financial Center. TI gap of ~$296K remains open.",
        occurredAt: daysAgo(14),
        confidence: 0.99,
        evidenceQuote:
          "Attached please find the signed LOI from Vertex Capital Partners",
      },
      {
        dealId: deal4.id,
        messageId: msg4b.id,
        type: "COMMITMENT_MADE",
        description:
          "Landlord committed to providing revised TI position by September 25th",
        occurredAt: daysAgo(13),
        confidence: 0.97,
        evidenceQuote:
          "We expect to have an updated TI position back to you by end of this week (September 25th).",
      },
    ],
  });

  // ─────────────────────────────────────────────────────────────
  // DEAL 5: Healthy active deal — no required action
  // ─────────────────────────────────────────────────────────────
  const deal5 = await prisma.deal.create({
    data: {
      name: "Back Bay Sublease — Horizon Consulting",
      company: "Horizon Consulting",
      property: "500 Boylston Street, Boston MA",
      estimatedValue: 1_850_000,
      stage: "Lease Execution",
      status: "ACTIVE",
    },
  });

  const thread5 = await prisma.thread.create({
    data: {
      dealId: deal5.id,
      subject: "Horizon Consulting — 500 Boylston Sublease / Lease Execution",
      participants: JSON.stringify([
        "Megan Powell <m.powell@cbre.com>",
        "Ryan Cho <r.cho@horizonconsulting.com>",
        "Janet Mills <j.mills@bostonproperties.com>",
      ]),
    },
  });

  const msg5a = await prisma.message.create({
    data: {
      threadId: thread5.id,
      sender: "Megan Powell <m.powell@cbre.com>",
      recipients: JSON.stringify(["Ryan Cho <r.cho@horizonconsulting.com>"]),
      sentAt: daysAgo(5),
      body: `Ryan,

Great news — Boston Properties has countersigned the sublease. I'm attaching the fully executed copy for your records.

Next steps are straightforward:
1. Your counsel should confirm the sublandlord consent is in order (Janet's team has confirmed they'll have it to us by next Wednesday)
2. Wire the first month + security deposit per the payment schedule in Section 8.4 of the lease

No action needed from you until we receive the sublandlord consent. I'll ping you as soon as it lands.

This was a smooth process — congratulations on securing 500 Boylston!

Megan Powell
VP | CBRE Boston`,
    },
  });

  const msg5b = await prisma.message.create({
    data: {
      threadId: thread5.id,
      sender: "Ryan Cho <r.cho@horizonconsulting.com>",
      recipients: JSON.stringify(["Megan Powell <m.powell@cbre.com>"]),
      sentAt: daysAgo(4),
      body: `Megan,

Fantastic, thank you! We'll have our counsel review the executed copy today. Looking forward to the sublandlord consent.

We're very excited to get into the new space — the team will be thrilled.

Ryan`,
    },
  });

  await prisma.obligation.create({
    data: {
      dealId: deal5.id,
      messageId: msg5a.id,
      owner: "Janet Mills",
      counterparty: "Megan Powell",
      description:
        "Deliver sublandlord consent by next Wednesday (October 7, 2026)",
      dueAt: daysFromNow(9),
      status: "OPEN",
      confidence: 0.96,
      evidenceQuote:
        "Janet's team has confirmed they'll have it to us by next Wednesday",
    },
  });

  await prisma.obligation.create({
    data: {
      dealId: deal5.id,
      messageId: msg5a.id,
      owner: "Ryan Cho",
      counterparty: "Megan Powell",
      description:
        "Wire first month rent + security deposit per Section 8.4 payment schedule (after consent received)",
      dueAt: daysFromNow(12),
      status: "OPEN",
      confidence: 0.9,
      evidenceQuote:
        "Wire the first month + security deposit per the payment schedule in Section 8.4 of the lease",
    },
  });

  await prisma.dealEvent.createMany({
    data: [
      {
        dealId: deal5.id,
        messageId: msg5a.id,
        type: "LEASE_EXECUTED",
        description:
          "Sublease fully executed by both parties. Sublandlord consent pending.",
        occurredAt: daysAgo(5),
        confidence: 0.99,
        evidenceQuote: "Boston Properties has countersigned the sublease.",
      },
      {
        dealId: deal5.id,
        messageId: msg5b.id,
        type: "CLIENT_CONFIRMED",
        description: "Tenant acknowledged executed lease; counsel reviewing.",
        occurredAt: daysAgo(4),
        confidence: 0.95,
        evidenceQuote:
          "We'll have our counsel review the executed copy today.",
      },
    ],
  });

  console.log("✅ Seeded 5 deals plus a four-round negotiation history.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
