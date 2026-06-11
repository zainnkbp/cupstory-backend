import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log("Mereset data interaksi...");
  await prisma.comment.deleteMany({});
  await prisma.unlockedVideo.deleteMany({});
  await prisma.like.deleteMany({});
  console.log("Selesai! Semua Komentar, Video VIP yang terbuka, dan Likes sudah bersih.");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
