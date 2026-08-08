/**
 * One-off cleanup for the contract-address migration: wipes all
 * Competition/Submission/Dispute data tied to the previous contract
 * deployment so nothing from it lingers under the new address. Users and
 * uploaded Images are left untouched.
 *
 * Run once, manually, against the target database (take a backup first —
 * this is irreversible):
 *   cd backend && npx ts-node scripts/wipe-competitions.ts
 */
import { prisma } from "../src/lib/prisma";

async function main() {
  const disputes = await prisma.dispute.deleteMany({});
  const submissions = await prisma.submission.deleteMany({});
  const competitions = await prisma.competition.deleteMany({});
  console.log(
    `Wiped: ${disputes.count} disputes, ${submissions.count} submissions, ${competitions.count} competitions.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
