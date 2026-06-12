import express from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// Inisialisasi Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Setup Multer Storage Memory (Karena akan diupload ke Supabase Cloud)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const app = express();
const prisma = new PrismaClient();
app.use(cors());
app.use(express.json());
app.use(passport.initialize());

app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'CupStory API is running on Vercel' });
});

// Mengekspos folder 'gallery' agar bisa diakses public via URL
app.use('/gallery', express.static('gallery'));

// ==========================================
// KONFIGURASI PASSPORT (GOOGLE OAUTH)
// ==========================================
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "https://cupstory-backend.vercel.app/api/auth/google/callback"
  },
  async (accessToken, refreshToken, profile, cb) => {
    try {
      let user = await prisma.user.findUnique({ where: { googleId: profile.id } });
      if (!user) {
        // Jika belum pernah daftar, buat user baru
        user = await prisma.user.create({
          data: {
            googleId: profile.id,
            username: profile.displayName.replace(/\s+/g, '').toLowerCase() + Math.floor(Math.random()*100),
            email: profile.emails[0].value,
            avatar: profile.photos[0].value,
            bio: 'Kreator Baru di CupStory'
          }
        });
      }
      return cb(null, user);
    } catch (error) {
      return cb(error, null);
    }
  }
));

  // ==========================================
  // 0. API AUTENTIKASI (OAUTH)
  // ==========================================

  // Arahkan user ke halaman Google Login
  app.get('/api/auth/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false }));

  // Callback dari Google setelah user menyetujui
  app.get('/api/auth/google/callback', 
    passport.authenticate('google', { failureRedirect: '/login', session: false }),
    (req, res) => {
      // 1. Buat Token JWT (Tiket Masuk)
      const token = jwt.sign({ id: req.user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
      
      // 2. Lempar kembali ke aplikasi Frontend (beserta Token di URL)
      res.redirect(`${process.env.FRONTEND_URL}?token=${token}&userId=${req.user.id}`);
    }
  );

  // Endpoint untuk mengambil detail akun saya (Me) menggunakan Token
  app.get('/api/auth/me', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ error: 'Tidak ada token' });
      
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      const user = await prisma.user.findUnique({ 
        where: { id: decoded.id },
        include: { unlockedVideos: true } // Muat daftar video yang sudah dibeli
      });
      res.json({ success: true, user });
    } catch (error) {
      res.status(401).json({ error: 'Token tidak valid' });
    }
  });

  // ==========================================
  // 1. API VIDEO & FEED
  // ==========================================

  // Upload Video (UGC)
  app.post('/api/videos/upload', async (req, res) => {
    try {
      const { creatorId, title, description, videoUrl, isVip, price } = req.body;
      const newVideo = await prisma.video.create({
        data: {
          creatorId: parseInt(creatorId),
          title,
          description,
          videoUrl,
          isVip: isVip || false,
          price: isVip ? parseInt(price) : 0
        }
      });
      res.json({ success: true, message: 'Video berhasil diunggah!', data: newVideo });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Gagal mengunggah video' });
    }
  });

  // Upload Video Fisik (Dari Galeri)
  app.post('/api/videos/upload-file', upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]), async (req, res) => {
    try {
      const { creatorId, title, description, isVip, price, genres } = req.body;
      
      let videoUrl = '';
      let thumbnailUrl = '';
      
      // Upload Video ke Supabase Storage
      if (req.files && req.files['video']) {
        const file = req.files['video'][0];
        const fileName = `video_${Date.now()}_${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
        
        const { data, error } = await supabase.storage.from('videos').upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });
        
        if (error) {
          console.error("Supabase Upload Error:", error);
          throw error;
        }
        videoUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/videos/${fileName}`;
      }
      
      // Upload Thumbnail ke Supabase Storage
      if (req.files && req.files['thumbnail']) {
        const file = req.files['thumbnail'][0];
        const fileName = `thumb_${Date.now()}_${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
        
        const { data, error } = await supabase.storage.from('thumbnails').upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });
        
        if (error) {
          console.error("Supabase Upload Error:", error);
          throw error;
        }
        thumbnailUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/thumbnails/${fileName}`;
      }
      
      let parsedGenres = [];
      try {
        if (genres) parsedGenres = JSON.parse(genres);
      } catch(e) {}
      
      const newVideo = await prisma.video.create({
        data: {
          creatorId: parseInt(creatorId),
          title,
          description: description || '',
          videoUrl,
          thumbnailUrl,
          isVip: isVip === 'true',
          price: isVip === 'true' ? parseInt(price) : 0,
          genres: parsedGenres
        }
      });
      res.json({ success: true, message: 'File berhasil diunggah!', data: newVideo });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Gagal mengunggah file' });
    }
  });

  // Ambil FYP / Feed (Hanya Reels yang Gratis)
  app.get('/api/feed', async (req, res) => {
    try {
      const { userId, genre } = req.query;
      
      let orderBy = [{ createdAt: 'desc' }];
      const whereClause = { isVip: false };
      
      if (genre && genre !== 'For You') {
        whereClause.genres = { has: genre };
      } else if (userId) {
        // ALGORITMA FYP: Ambil preferensi pengguna untuk For You
        const preferences = await prisma.userGenrePreference.findMany({
          where: { userId: parseInt(userId) },
          orderBy: { score: 'desc' },
          take: 3
        });
        if (preferences.length > 0) {
          const topGenres = preferences.map(p => p.genre);
          // Prioritaskan genre favorit, lalu yang paling banyak di-view
          orderBy = [
            { views: 'desc' },
            { createdAt: 'desc' }
          ];
        } else {
          // Jika belum punya preferensi, urutkan berdasarkan yang paling banyak di-view secara global
          orderBy = [
            { views: 'desc' },
            { createdAt: 'desc' }
          ];
        }
      }

      const feed = await prisma.video.findMany({
        where: whereClause,
        include: { 
          creator: { select: { username: true, avatar: true } },
          _count: { select: { likes: true, comments: true } },
          ...(userId ? {
            likes: { where: { userId: parseInt(userId) } },
            comments: { where: { userId: parseInt(userId) } }
          } : {})
        },
        orderBy: orderBy,
        take: 15
      });

      // Map to add hasLiked and hasCommented boolean flags
      const formattedFeed = feed.map(v => ({
        ...v,
        hasLiked: v.likes && v.likes.length > 0,
        hasCommented: v.comments && v.comments.length > 0,
        likes: undefined, // remove arrays from response payload
        comments: undefined
      }));

      res.json({ success: true, data: formattedFeed });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Gagal mengambil feed' });
    }
  });

  // Ambil Profil Kreator (Tab Reels & Tab VIP)
  app.get('/api/profile/:id', async (req, res) => {
    try {
      const creatorId = parseInt(req.params.id);
      const { userId } = req.query;
      const user = await prisma.user.findUnique({ where: { id: creatorId } });
      
      const includeData = {
        _count: { select: { likes: true, comments: true } },
        ...(userId ? {
          likes: { where: { userId: parseInt(userId) } },
          comments: { where: { userId: parseInt(userId) } }
        } : {})
      };

      const reelsRaw = await prisma.video.findMany({ 
        where: { creatorId, isVip: false },
        include: includeData
      });
      const vipVideosRaw = await prisma.video.findMany({ 
        where: { creatorId, isVip: true },
        include: includeData
      });

      const formatVideo = (v) => ({
        ...v,
        hasLiked: v.likes && v.likes.length > 0,
        hasCommented: v.comments && v.comments.length > 0,
        likes: undefined,
        comments: undefined
      });

      res.json({ 
        success: true, 
        profile: user, 
        reels: reelsRaw.map(formatVideo), 
        vipVideos: vipVideosRaw.map(formatVideo) 
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Gagal mengambil profil' });
    }
  });

  // ==========================================
  // 2. API INTERAKSI & KAFKA EVENTS
  // ==========================================

  // Fitur Like Video (Event-Driven via Kafka)
  app.post('/api/videos/:id/like', async (req, res) => {
    try {
      const { userId } = req.body;
      const videoId = parseInt(req.params.id);
      
      // Ambil video untuk mengetahui genrenya (untuk score)
      const video = await prisma.video.findUnique({ where: { id: videoId } });
      
      const existingLike = await prisma.like.findFirst({
        where: { userId: parseInt(userId), videoId: parseInt(videoId) }
      });
      
      if (existingLike) {
        await prisma.like.delete({ where: { id: existingLike.id } });
      } else {
        await prisma.like.create({
          data: { userId: parseInt(userId), videoId: parseInt(videoId) }
        });
        
        // ALGORITMA FYP: +5 Poin preferensi jika Like
        if (video && video.genres && video.genres.length > 0) {
          for (const genre of video.genres) {
            await prisma.userGenrePreference.upsert({
              where: { userId_genre: { userId: parseInt(userId), genre } },
              update: { score: { increment: 5 } },
              create: { userId: parseInt(userId), genre, score: 5 }
            });
          }
        }
      }

      res.json({ success: true, message: 'Aksi Like berhasil diproses!' });
    } catch (error) {
      if (error.code === 'P2002') return res.json({ success: true, message: 'Abaikan duplicate like' });
      console.error(error);
      res.status(500).json({ success: false, message: 'Gagal melakukan aksi Like' });
    }
  });

  // Fitur Komentar (Event-Driven via Kafka)
  app.post('/api/videos/:id/comment', async (req, res) => {
    try {
      const { userId, text } = req.body;
      const videoId = parseInt(req.params.id);
      
      // Ambil video untuk mengetahui genrenya (untuk score)
      const video = await prisma.video.findUnique({ where: { id: videoId } });
      
      await prisma.comment.create({
        data: {
          userId: parseInt(userId),
          videoId: parseInt(videoId),
          text: text
        }
      });
      
      // ALGORITMA FYP: +10 Poin jika komentar
      if (video && video.genres && video.genres.length > 0) {
        for (const genre of video.genres) {
          await prisma.userGenrePreference.upsert({
            where: { userId_genre: { userId: parseInt(userId), genre } },
            update: { score: { increment: 10 } },
            create: { userId: parseInt(userId), genre, score: 10 }
          });
        }
      }

      res.json({ success: true, message: 'Komentar berhasil diproses!' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Gagal mengirim komentar' });
    }
  });

  // ==========================================
  // 4. API TELEMETRI (WATCH TIME)
  // ==========================================

  // Endpoint untuk mencatat View dan Durasi Tonton
  app.post('/api/videos/:id/view', async (req, res) => {
    try {
      const { userId, duration } = req.body;
      const videoId = parseInt(req.params.id);
      
      if (!userId || duration < 1) return res.json({ success: false });

      const video = await prisma.video.findUnique({ where: { id: videoId } });
      
      // 1. Tambah View Count global untuk video
      await prisma.video.update({
        where: { id: parseInt(videoId) },
        data: { views: { increment: 1 } }
      });

      // 2. Simpan atau Update durasi tonton di WatchHistory
      await prisma.watchHistory.upsert({
        where: { userId_videoId: { userId: parseInt(userId), videoId: parseInt(videoId) } },
        update: { watchDuration: duration },
        create: { userId: parseInt(userId), videoId: parseInt(videoId), watchDuration: duration }
      });

      // 3. ALGORITMA FYP: +1 Poin preferensi genre
      if (duration >= 3 && video && video.genres && video.genres.length > 0) {
        for (const genre of video.genres) {
          await prisma.userGenrePreference.upsert({
            where: { userId_genre: { userId: parseInt(userId), genre } },
            update: { score: { increment: 1 } },
            create: { userId: parseInt(userId), genre, score: 1 }
          });
        }
      }
      
      res.json({ success: true, message: 'View dicatat' });
    } catch (error) {
      console.error('Error tracking view:', error);
      res.status(500).json({ success: false });
    }
  });

  // Endpoint untuk mendapatkan urutan Tab Genre
  app.get('/api/users/:id/preferences', async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const preferences = await prisma.userGenrePreference.findMany({
        where: { userId },
        orderBy: { score: 'desc' }
      });
      
      const rankedGenres = preferences.map(p => p.genre);
      res.json({ success: true, genres: rankedGenres });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false });
    }
  });

  // Ambil Daftar Komentar untuk sebuah Video
  app.get('/api/videos/:id/comments', async (req, res) => {
    try {
      const videoId = parseInt(req.params.id);
      const comments = await prisma.comment.findMany({
        where: { videoId },
        include: { user: { select: { username: true, avatar: true } } },
        orderBy: { id: 'desc' }
      });
      res.json({ success: true, comments });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Gagal mengambil komentar' });
    }
  });

  // Webhook Pembayaran Midtrans (Top Up Koin)
  app.post('/api/webhook/payment', async (req, res) => {
    try {
      const { orderId, userId, amount, coinAmount } = req.body;

      await prisma.transaction.create({
        data: {
          orderId,
          userId: parseInt(userId),
          amount: parseInt(amount),
          coinAmount: parseInt(coinAmount),
          status: 'PENDING'
        }
      });

      await prisma.user.update({
        where: { id: parseInt(userId) },
        data: { coins: { increment: parseInt(coinAmount) } }
      });
      await prisma.transaction.update({
        where: { orderId: orderId },
        data: { status: 'SUCCESS' }
      });

      res.json({ success: true, message: 'Webhook Diterima. Koin berhasil diproses.' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
  });

  // ==========================================
  // 3. API MONETISASI & PAYWALL
  // ==========================================

  // Simulasi Top-Up Langsung dari Aplikasi (Mock)
  app.post('/api/topup/mock', async (req, res) => {
    try {
      const { userId, coinAmount } = req.body;
      const orderId = 'MOCK-' + Date.now();
      
      await prisma.user.update({
        where: { id: parseInt(userId) },
        data: { coins: { increment: parseInt(coinAmount) } }
      });

      res.json({ success: true, message: 'Top-Up simulasi berhasil diproses!' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Gagal memproses Top-Up' });
    }
  });

  // API Membeli / Membuka Akses Video VIP
  app.post('/api/videos/:id/unlock', async (req, res) => {
    try {
      const videoId = parseInt(req.params.id);
      const { userId } = req.body;

      // Ambil data User & Video
      const user = await prisma.user.findUnique({ where: { id: parseInt(userId) } });
      const video = await prisma.video.findUnique({ where: { id: videoId } });

      if (!video.isVip) return res.status(400).json({ success: false, message: 'Video ini gratis.' });
      if (user.coins < video.price) return res.status(400).json({ success: false, message: 'Koin tidak cukup!' });

      // Gunakan Transaction agar Sinkron & Aman
      await prisma.$transaction([
        // Kurangi Koin User
        prisma.user.update({
          where: { id: user.id },
          data: { coins: user.coins - video.price }
        }),
        // Catat Pembelian
        prisma.unlockedVideo.create({
          data: { userId: user.id, videoId: video.id }
        })
      ]);

      // Ambil data user terbaru setelah pembelian
      const updatedUser = await prisma.user.findUnique({
        where: { id: user.id },
        include: { unlockedVideos: true }
      });

      res.json({ success: true, message: 'Video VIP berhasil dibuka!', user: updatedUser });
    } catch (error) {
      // Jika error karena Unique Constraint (sudah pernah dibeli)
      if (error.code === 'P2002') return res.status(400).json({ success: false, message: 'Video sudah pernah dibeli.' });
      console.error(error);
      res.status(500).json({ success: false, message: 'Gagal membeli video' });
    }
  });

  // Vercel Serverless Export
  export default app;
