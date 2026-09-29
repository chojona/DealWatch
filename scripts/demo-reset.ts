import { PrismaClient } from "@prisma/client";
import { getDocumentStorage } from "../lib/documents/storage";
import { getMessageStorage } from "../lib/messages/storage";
import { CANONICAL_DEMO_DEAL_ID, CANONICAL_DEMO_DEAL_NAME } from "../lib/demo/identity";
import { resetCanonicalDemo } from "../lib/demo/reset";
import { DemoSafetyError } from "../lib/demo/safety";
import { verifyCanonicalDemo } from "../lib/demo/verify";

async function main() {
  const prisma = new PrismaClient();
  try {
    const restored = await resetCanonicalDemo(prisma, {
      documentStorage: getDocumentStorage(),
      messageStorage: getMessageStorage(),
    });
    const verified = await verifyCanonicalDemo(prisma);
    console.log("Canonical demo restored.");
    console.log(`Database: ${restored.databaseFile}`);
    console.log(`Workspace: Default (${restored.workspaceId})`);
    console.log(`Deal: ${CANONICAL_DEMO_DEAL_NAME}`);
    console.log(`Deal id: ${CANONICAL_DEMO_DEAL_ID}`);
    console.log(`Formal Base Rent: ${verified.formalRent}`);
    console.log(`Earlier formal Base Rent: ${verified.earlierFormalRent}`);
    console.log(`Communication: ${verified.communicationValue} (${verified.reconciliation})`);
    console.log(`Proposal action: ${verified.proposalStatus}`);
    console.log(`Insurance action: ${verified.insuranceStatus}`);
    console.log(`Attachment: ${verified.attachment} (not promoted)`);
    console.log("");
    console.log("Open these paths in the app:");
    console.log(`  /deals/${CANONICAL_DEMO_DEAL_ID}`);
    console.log(`  /deals/${CANONICAL_DEMO_DEAL_ID}/negotiation`);
    console.log(`  /deals/${CANONICAL_DEMO_DEAL_ID}/activity`);
    console.log(`  /deals/${CANONICAL_DEMO_DEAL_ID}/messages`);
    console.log(`  /deals/${CANONICAL_DEMO_DEAL_ID}/documents`);
    console.log("  /inbox");
  } catch (error) {
    if (error instanceof DemoSafetyError) {
      console.error(error.reason);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
