import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prisma = new PrismaClient();
const GALLERY_DIR = path.join(__dirname, 'gallery');

async function main() {
  console.log("Memulai pembersihan gallery...");
  
  // Ambil semua video dari database
  const videos = await prisma.video.findMany({
    select: { videoUrl: true, thumbnailUrl: true }
  });

  // Ekstrak nama file dari URL
  const activeFiles = new Set();
  
  videos.forEach(v => {
    if (v.videoUrl) {
      const parts = v.videoUrl.split('/');
      const filename = parts[parts.length - 1];
      activeFiles.add(filename);
    }
    if (v.thumbnailUrl) {
      const parts = v.thumbnailUrl.split('/');
      const filename = parts[parts.length - 1];
      activeFiles.add(filename);
    }
  });

  console.log(`Ditemukan ${activeFiles.size} file yang terpakai di database.`);

  // Baca isi folder gallery
  if (!fs.existsSync(GALLERY_DIR)) {
    console.log("Folder gallery tidak ditemukan.");
    return;
  }

  const filesInGallery = fs.readdirSync(GALLERY_DIR);
  let deletedCount = 0;

  for (const file of filesInGallery) {
    if (!activeFiles.has(file)) {
      const filePath = path.join(GALLERY_DIR, file);
      fs.unlinkSync(filePath);
      console.log(`🗑️ Menghapus file tidak terpakai: ${file}`);
      deletedCount++;
    }
  }

  console.log(`\n✅ Pembersihan selesai! Menghapus total ${deletedCount} file dari gallery.`);
}

main()
  .catch((e) => {
    console.error("Terjadi kesalahan:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
