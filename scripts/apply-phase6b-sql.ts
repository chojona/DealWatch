import { PrismaClient } from "@prisma/client";
import { applyPhase6bSql } from "../lib/entities/applyPhase6bSql";

const prisma = new PrismaClient();

applyPhase6bSql(prisma)
  .then(() => {
    console.log("phase6b sql applied");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
