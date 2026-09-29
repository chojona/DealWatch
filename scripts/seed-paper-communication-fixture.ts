import { prisma } from "../lib/db";
import { installBrowserPaperCommunicationDeals } from "../lib/deals/brief/paperCommunicationFixture";
import { getDocumentStorage } from "../lib/documents/storage";
import { getMessageStorage } from "../lib/messages/storage";

async function main() {
  const installed = await installBrowserPaperCommunicationDeals(prisma, {
    storage: getDocumentStorage(),
    messageStorage: getMessageStorage(),
  });
  console.log(JSON.stringify({
    differsDealId: installed.differs.dealId,
    differsDocumentId: installed.differs.documentId,
    differsMessageId: installed.differs.messageId,
    misreadDealId: installed.misread.dealId,
    misreadMessageId: installed.misread.messageId,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
