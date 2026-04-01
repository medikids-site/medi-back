import express from "express";
import cors from "cors";
import multer from "multer";
import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

// Helper function to safely destroy Cloudinary resource
const safeCloudinaryDestroy = async (publicId, resourceType = 'image') => {
  if (publicId) {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    } catch (e) {
      console.warn(`Could not destroy Cloudinary asset ${publicId}:`, e);
    }
  }
};

// --- CLOUDINARY CONFIGURATION ---
cloudinary.config({
  cloud_name: 'dh14nysup',
  api_key: '622444971447812',
  api_secret: 'un5ksy5kE9eXqH7r2YGCjDkZqbg',
});

// --- MONGODB CONFIGURATION ---
const MONGODB_URI = "mongodb+srv://mongomedi47_db_user:mongomedi47_db_password@cluster0.qe7u1xn.mongodb.net/?appName=Cluster0";
const PORT = process.env.PORT || 5001;

// --- MONGOOSE SCHEMAS ---

// 1. Doctors Schema
const doctorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  position: { type: String, required: true, trim: true },
  imageUrl: { type: String, required: true },
  imagePublicId: { type: String, required: true },
  uploadDate: { type: Date, default: Date.now },
}, { timestamps: true });

// 2. News Schema
const newsSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  content: { type: String, required: true }, // Long text with formatting
  imageUrl: { type: String, required: false }, // Optional image
  imagePublicId: { type: String, required: false }, // Optional
  uploadDate: { type: Date, default: Date.now },
}, { timestamps: true });

// 3. Partner Logos Schema
const partnerSchema = new mongoose.Schema({
  name: { type: String, required: false, trim: true }, // Optional company name
  link: { type: String, required: false, trim: true },
  logoUrl: { type: String, required: true },
  logoPublicId: { type: String, required: true },
  uploadDate: { type: Date, default: Date.now },
}, { timestamps: true });

// 4. Reviews Schema
const reviewSchema = new mongoose.Schema({
  name: { type: String, required: false, trim: true }, // Optional customer name
  note: { type: String, required: true, trim: true }, // Review text
  uploadDate: { type: Date, default: Date.now },
}, { timestamps: true });

// --- MODELS ---
const Doctor = mongoose.model('Doctor', doctorSchema);
const News = mongoose.model('News', newsSchema);
const Partner = mongoose.model('Partner', partnerSchema);
const Review = mongoose.model('Review', reviewSchema);

// --- EXPRESS APP SETUP ---
const app = express();

// --- MIDDLEWARE ---
app.use(cors({
  origin: '*',
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// --- DATABASE CONNECTION CHECK MIDDLEWARE ---
const checkDbConnection = (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ 
      error: "Database unavailable", 
      message: "MongoDB connection is not ready. Please try again later." 
    });
  }
  next();
};

// --- CLOUDINARY MULTER SETUP FOR IMAGES ---
const imageStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'medikids-site',
    allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'webp', 'svg'],
    public_id: (req, file) => {
      const timestamp = Date.now();
      const safeName = file.originalname.replace(/\s+/g, '_').replace(/[^\w.-]/g, '');
      return `${timestamp}-${safeName.split('.')[0]}`;
    },
  }
});

const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// --- ROUTES ---

app.get("/", (req, res) => {
  res.json({
    message: "Medikids Backend API ✅",
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// ========== DOCTORS ROUTES ==========

app.post("/doctors/upload", checkDbConnection, uploadImage.single("image"), async (req, res) => {
  console.log('👨‍⚕️ Doctor upload request');
  
  if (!req.file) {
    return res.status(400).json({ error: "Doctor image is required" });
  }

  try {
    const { name, position } = req.body;

    if (!name || !position) {
      return res.status(400).json({ error: "Name and position are required" });
    }

    const newDoctor = new Doctor({
      name: name.trim(),
      position: position.trim(),
      imageUrl: req.file.path,
      imagePublicId: req.file.filename,
    });

    await newDoctor.save();
    console.log(`✅ Doctor created: ${newDoctor._id}`);

    res.status(201).json({
      message: "Doctor created successfully!",
      doctor: newDoctor
    });

  } catch (error) {
    console.error('❌ Error creating doctor:', error);
    res.status(500).json({ error: "Failed to create doctor", details: error.message });
  }
});

app.get("/doctors", checkDbConnection, async (req, res) => {
  try {
    const doctors = await Doctor.find().sort({ uploadDate: -1 });
    res.json({ doctors });
  } catch (error) {
    console.error('❌ Error fetching doctors:', error);
    res.status(500).json({ error: "Failed to fetch doctors" });
  }
});

app.get("/doctors/:id", checkDbConnection, async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.params.id);
    if (!doctor) {
      return res.status(404).json({ error: "Doctor not found" });
    }
    res.json({ doctor });
  } catch (error) {
    console.error('❌ Error fetching doctor:', error);
    res.status(500).json({ error: "Failed to fetch doctor" });
  }
});

app.put("/doctors/:id", checkDbConnection, uploadImage.single("image"), async (req, res) => {
  try {
    const { name, position } = req.body;
    const doctor = await Doctor.findById(req.params.id);

    if (!doctor) {
      return res.status(404).json({ error: "Doctor not found" });
    }

    // Update fields
    if (name) doctor.name = name.trim();
    if (position) doctor.position = position.trim();

    // Update image if new one is uploaded
    if (req.file) {
      await safeCloudinaryDestroy(doctor.imagePublicId);
      doctor.imageUrl = req.file.path;
      doctor.imagePublicId = req.file.filename;
    }

    await doctor.save();
    console.log(`✅ Doctor updated: ${req.params.id}`);

    res.json({ message: "Doctor updated successfully", doctor });
  } catch (error) {
    console.error('❌ Error updating doctor:', error);
    res.status(500).json({ error: "Failed to update doctor" });
  }
});

app.delete("/doctors/:id", checkDbConnection, async (req, res) => {
  try {
    const doctor = await Doctor.findById(req.params.id);
    if (!doctor) {
      return res.status(404).json({ error: "Doctor not found" });
    }

    await safeCloudinaryDestroy(doctor.imagePublicId);
    await Doctor.findByIdAndDelete(req.params.id);
    console.log(`✅ Doctor deleted: ${req.params.id}`);

    res.json({ message: "Doctor deleted successfully" });
  } catch (error) {
    console.error('❌ Error deleting doctor:', error);
    res.status(500).json({ error: "Failed to delete doctor" });
  }
});

// ========== NEWS ROUTES ==========

app.post("/news/upload", checkDbConnection, uploadImage.single("image"), async (req, res) => {
  console.log('📰 News upload request');
  
  try {
    const { title, content } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: "Title and content are required" });
    }

    // Handle optional image
    let imageUrl = null;
    let imagePublicId = null;

    if (req.file) {
      imageUrl = req.file.path;
      imagePublicId = req.file.filename;
      console.log('📷 Image uploaded for news');
    } else {
      console.log('📝 News created without image');
    }

    const newNews = new News({
      title: title.trim(),
      content: content, // Keep formatting as-is
      imageUrl,
      imagePublicId,
    });

    await newNews.save();
    console.log(`✅ News created: ${newNews._id}`);

    res.status(201).json({
      message: "News created successfully!",
      news: newNews
    });

  } catch (error) {
    console.error('❌ Error creating news:', error);
    res.status(500).json({ error: "Failed to create news", details: error.message });
  }
});

app.get("/news", checkDbConnection, async (req, res) => {
  try {
    const news = await News.find().sort({ uploadDate: -1 });
    res.json({ news });
  } catch (error) {
    console.error('❌ Error fetching news:', error);
    res.status(500).json({ error: "Failed to fetch news" });
  }
});

app.get("/news/:id", checkDbConnection, async (req, res) => {
  try {
    const news = await News.findById(req.params.id);
    if (!news) {
      return res.status(404).json({ error: "News not found" });
    }
    res.json({ news });
  } catch (error) {
    console.error('❌ Error fetching news:', error);
    res.status(500).json({ error: "Failed to fetch news" });
  }
});

app.put("/news/:id", checkDbConnection, uploadImage.single("image"), async (req, res) => {
  try {
    const { title, content } = req.body;
    const news = await News.findById(req.params.id);

    if (!news) {
      return res.status(404).json({ error: "News not found" });
    }

    // Update fields
    if (title) news.title = title.trim();
    if (content) news.content = content;

    // Update image if new one is uploaded
    if (req.file) {
      if (news.imagePublicId) {
        await safeCloudinaryDestroy(news.imagePublicId);
      }
      news.imageUrl = req.file.path;
      news.imagePublicId = req.file.filename;
    }

    await news.save();
    console.log(`✅ News updated: ${req.params.id}`);

    res.json({ message: "News updated successfully", news });
  } catch (error) {
    console.error('❌ Error updating news:', error);
    res.status(500).json({ error: "Failed to update news" });
  }
});

app.delete("/news/:id", checkDbConnection, async (req, res) => {
  try {
    const news = await News.findById(req.params.id);
    if (!news) {
      return res.status(404).json({ error: "News not found" });
    }

    // Only delete from Cloudinary if image exists
    if (news.imagePublicId) {
      await safeCloudinaryDestroy(news.imagePublicId);
    }
    
    await News.findByIdAndDelete(req.params.id);
    console.log(`✅ News deleted: ${req.params.id}`);

    res.json({ message: "News deleted successfully" });
  } catch (error) {
    console.error('❌ Error deleting news:', error);
    res.status(500).json({ error: "Failed to delete news" });
  }
});

// ========== PARTNER LOGOS ROUTES ==========

app.post("/partners/upload", checkDbConnection, uploadImage.single("logo"), async (req, res) => {
  console.log('🤝 Partner logo upload request');
  
  if (!req.file) {
    return res.status(400).json({ error: "Partner logo is required" });
  }

  try {
    const { name } = req.body;

    const newPartner = new Partner({
      name: name ? name.trim() : '',
      link: req.body.link ? req.body.link.trim() : '',
      logoUrl: req.file.path,
      logoPublicId: req.file.filename,
    });

    await newPartner.save();
    console.log(`✅ Partner logo created: ${newPartner._id}`);

    res.status(201).json({
      message: "Partner logo created successfully!",
      partner: newPartner
    });

  } catch (error) {
    console.error('❌ Error creating partner logo:', error);
    res.status(500).json({ error: "Failed to create partner logo", details: error.message });
  }
});

app.get("/partners", checkDbConnection, async (req, res) => {
  try {
    const partners = await Partner.find().sort({ uploadDate: -1 });
    res.json({ partners });
  } catch (error) {
    console.error('❌ Error fetching partners:', error);
    res.status(500).json({ error: "Failed to fetch partners" });
  }
});

app.get("/partners/:id", checkDbConnection, async (req, res) => {
  try {
    const partner = await Partner.findById(req.params.id);
    if (!partner) {
      return res.status(404).json({ error: "Partner not found" });
    }
    res.json({ partner });
  } catch (error) {
    console.error('❌ Error fetching partner:', error);
    res.status(500).json({ error: "Failed to fetch partner" });
  }
});

app.put("/partners/:id", checkDbConnection, uploadImage.single("logo"), async (req, res) => {
  try {
    const { name } = req.body;
    const partner = await Partner.findById(req.params.id);

    if (!partner) {
      return res.status(404).json({ error: "Partner not found" });
    }

    // Update name if provided
    if (name !== undefined) {
      partner.name = name.trim();
    }

    if (req.body.link) partner.link = req.body.link.trim();

    // Update logo if new one is uploaded
    if (req.file) {
      await safeCloudinaryDestroy(partner.logoPublicId);
      partner.logoUrl = req.file.path;
      partner.logoPublicId = req.file.filename;
    }

    await partner.save();
    console.log(`✅ Partner updated: ${req.params.id}`);

    res.json({ message: "Partner updated successfully", partner });
  } catch (error) {
    console.error('❌ Error updating partner:', error);
    res.status(500).json({ error: "Failed to update partner" });
  }
});

app.delete("/partners/:id", checkDbConnection, async (req, res) => {
  try {
    const partner = await Partner.findById(req.params.id);
    if (!partner) {
      return res.status(404).json({ error: "Partner not found" });
    }

    await safeCloudinaryDestroy(partner.logoPublicId);
    await Partner.findByIdAndDelete(req.params.id);
    console.log(`✅ Partner deleted: ${req.params.id}`);

    res.json({ message: "Partner deleted successfully" });
  } catch (error) {
    console.error('❌ Error deleting partner:', error);
    res.status(500).json({ error: "Failed to delete partner" });
  }
});

// ========== REVIEWS ROUTES ==========

// Multer middleware for reviews (no file, just to handle FormData)
const noFileUpload = multer();

app.post("/reviews/upload", checkDbConnection, noFileUpload.none(), async (req, res) => {
  console.log('⭐ Review upload request');
  console.log('Request body:', req.body);
  
  try {
    const { name, note } = req.body;

    if (!note) {
      return res.status(400).json({ error: "Review note is required" });
    }

    const newReview = new Review({
      name: name ? name.trim() : '',
      note: note.trim(),
    });

    await newReview.save();
    console.log(`✅ Review created: ${newReview._id}`);

    res.status(201).json({
      message: "Review created successfully!",
      review: newReview
    });

  } catch (error) {
    console.error('❌ Error creating review:', error);
    res.status(500).json({ error: "Failed to create review", details: error.message });
  }
});

app.get("/reviews", checkDbConnection, async (req, res) => {
  try {
    const reviews = await Review.find().sort({ uploadDate: -1 });
    res.json({ reviews });
  } catch (error) {
    console.error('❌ Error fetching reviews:', error);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

app.get("/reviews/:id", checkDbConnection, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({ error: "Review not found" });
    }
    res.json({ review });
  } catch (error) {
    console.error('❌ Error fetching review:', error);
    res.status(500).json({ error: "Failed to fetch review" });
  }
});

app.put("/reviews/:id", checkDbConnection, noFileUpload.none(), async (req, res) => {
  try {
    const { name, note } = req.body;
    const review = await Review.findById(req.params.id);

    if (!review) {
      return res.status(404).json({ error: "Review not found" });
    }

    // Update fields
    if (name !== undefined) review.name = name.trim();
    if (note) review.note = note.trim();

    await review.save();
    console.log(`✅ Review updated: ${req.params.id}`);

    res.json({ message: "Review updated successfully", review });
  } catch (error) {
    console.error('❌ Error updating review:', error);
    res.status(500).json({ error: "Failed to update review" });
  }
});

app.delete("/reviews/:id", checkDbConnection, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({ error: "Review not found" });
    }

    await Review.findByIdAndDelete(req.params.id);
    console.log(`✅ Review deleted: ${req.params.id}`);

    res.json({ message: "Review deleted successfully" });
  } catch (error) {
    console.error('❌ Error deleting review:', error);
    res.status(500).json({ error: "Failed to delete review" });
  }
});

// --- Global Error Handling ---
app.use((error, req, res, next) => {
  console.error('💥 Error:', error);

  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.message });
  }

  res.status(500).json({ error: error.message || 'Something went wrong!' });
});

// --- 404 Handler ---
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// --- SERVER START & DB CONNECTION ---
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Medikids Server Running!`);
  console.log(`🌐 Server listening on port ${PORT}`);
  console.log(`\n📋 Endpoints:`);
  console.log(' Doctors: POST/GET/PUT/DELETE /doctors');
  console.log(' News: POST/GET/PUT/DELETE /news (image optional)');
  console.log(' Partners: POST/GET/PUT/DELETE /partners (name optional)');
  console.log(' Reviews: POST/GET/PUT/DELETE /reviews (name optional)');
  
  mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB successfully!');
  })
  .catch(err => {
    console.error('❌ Initial MongoDB connection failed:', err.message);
  });
});

// --- MONGOOSE CONNECTION EVENT HANDLERS ---
mongoose.connection.on('disconnected', () => {
  console.log('⚠️  MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected successfully!');
});

// --- GRACEFUL SHUTDOWN ---
const shutdown = async () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  try {
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed');
  } catch (err) {
    console.error('❌ Error closing MongoDB connection:', err);
  }
  
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);