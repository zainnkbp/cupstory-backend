import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const VIDEO_GENRES = [
  '❤️ Romance', 
  '🔪 Thriller', 
  '🎭 Drama', 
  '😂 Comedy', 
  '👻 Horror', 
  '🕵️ Mystery', 
  '⚔️ Action', 
  '🧚 Fantasy'
];

async function main() {
  console.log("Memulai proses update genre video lama...");
  
  const videos = await prisma.video.findMany({
    where: {
      OR: [
        { genres: { equals: [] } },
        { genres: { equals: null } }
      ]
    }
  });

  if (videos.length === 0) {
    console.log("Semua video di database sudah memiliki genre.");
    return;
  }

  console.log(`Ditemukan ${videos.length} video tanpa genre. Sedang memperbarui...`);

  for (const video of videos) {
    // Pilih 1 hingga 2 genre acak untuk video lama
    const randomGenreCount = Math.floor(Math.random() * 2) + 1;
    const shuffledGenres = [...VIDEO_GENRES].sort(() => 0.5 - Math.random());
    const selectedGenres = shuffledGenres.slice(0, randomGenreCount);

    await prisma.video.update({
      where: { id: video.id },
      data: { genres: selectedGenres }
    });
    
    console.log(`Video ID ${video.id} ("${video.title}") -> Ditambahkan genre: ${selectedGenres.join(', ')}`);
  }

  console.log("✅ Update genre selesai!");
}

main()
  .catch((e) => {
    console.error("Terjadi kesalahan:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
