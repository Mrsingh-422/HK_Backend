const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ==========================================
// 1. HOSPITAL UPLOAD CONFIGURATION (Existing)
// ==========================================
const hospitalDir = 'public/uploads/hospitals';
if (!fs.existsSync(hospitalDir)){
    fs.mkdirSync(hospitalDir, { recursive: true });
}

const hospitalStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, hospitalDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'hospital-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const hospitalFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
        cb(null, true);
    } else {
        cb(new Error('Only Images and PDF files are allowed!'), false);
    }
};

const uploadHospital = multer({ 
    storage: hospitalStorage,
    fileFilter: hospitalFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
});

const hospitalUploads = uploadHospital.fields([
    { name: 'hospitalImage', maxCount: 5 },
    { name: 'licenseDocument', maxCount: 5 },
    { name: 'otherDocuments', maxCount: 10 }
]);


// ==========================================
// 2. FRONTEND CONTENT CONFIGURATION (New)
// ==========================================
// Folder: public/uploads/homepage
const frontendDir = 'public/uploads/homepage';
if (!fs.existsSync(frontendDir)){
    fs.mkdirSync(frontendDir, { recursive: true });
}

const frontendStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, frontendDir); // Files yahan save hongi
    },
    filename: function (req, file, cb) {
        // Example: content-170899... .jpg
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'content-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// Filter: Only Images (No PDF needed for sliders/banners)
const frontendFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed for frontend content!'), false);
    }
};

const uploadFrontend = multer({ 
    storage: frontendStorage,
    fileFilter: frontendFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // Limit: 10MB (High quality images ke liye)
});

// Export Logic for Multiple Images (Array)
// Key 'images' matches your React FormData key: data.append("images", image);
const contentUploads = uploadFrontend.array('images', 10); 


// ==========================================
// EXPORTS
// ==========================================
module.exports = { 
    hospitalUploads, // Purana wala
    contentUploads   // Naya wala (About Us / Ambulance ke liye)
};