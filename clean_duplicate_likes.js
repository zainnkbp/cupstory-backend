import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log("Mencari duplikat Like...");
  const allLikes = await prisma.like.findMany();
  
  const seen = new Set();
  const toDelete = [];

  for (const like of allLikes) {
    const key = `${like.userId}-${like.videoId}`;
    if (seen.has(key)) {
      toDelete.push(like.id);
    } else {
      seen.add(key);
    }
  }

  if (toDelete.length > 0) {
    console.log(`Menghapus ${toDelete.length} Like duplikat yang menyebabkan bug toggle...`);
    await prisma.like.deleteMany({
      where: { id: { in: toDelete } }
    });
  } else {
    console.log("Tidak ada duplikat Like yang ditemukan.");
  }
  
  console.log("Pembersihan duplikat selesai!");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
