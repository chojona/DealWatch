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

  console.log("✅ Seeded 5 deals with threads, messages, obligations, and events.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
