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

// ==========================================
// 3. DOCTOR DOCUMENT CONFIGURATION (Add This)
// ==========================================
const doctorDir = 'public/uploads/doctors';
if (!fs.existsSync(doctorDir)){
    fs.mkdirSync(doctorDir, { recursive: true });
}

const doctorStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, doctorDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'doc-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadDoctor = multer({ 
    storage: doctorStorage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Match these names to what you used in your Controller (uploadDocuments)
const doctorDocUploads = uploadDoctor.fields([
    { name: 'certificates', maxCount: 10 },
    { name: 'qualificationDoc', maxCount: 1 },
    { name: 'licenseDoc', maxCount: 1 },
    { name: 'photoId', maxCount: 1 }
]);


// ==========================================
// 3. EXCEL FILE UPLOAD CONFIGURATION
// ==========================================
const excelDir = 'public/uploads/excel';
if (!fs.existsSync(excelDir)){
    fs.mkdirSync(excelDir, { recursive: true });
}

const excelStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, excelDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const excelFilter = (req, file, cb) => {
    // Check for .xlsx or .csv
    if (
        file.mimetype.includes('excel') || 
        file.mimetype.includes('spreadsheetml') || 
        file.mimetype === 'text/csv' ||
        file.originalname.match(/\.(xlsx|xls|csv)$/)
    ) {
        cb(null, true);
    } else {
        cb(new Error('Only Excel (.xlsx, .xls) or CSV files are allowed!'), false);
    }
};

const uploadExcel = multer({ 
    storage: excelStorage,
    fileFilter: excelFilter
});


// ==========================================
// 4. PROVIDER DOCUMENT CONFIGURATION (Added)
// ==========================================
const providerDir = 'public/uploads/providers';
if (!fs.existsSync(providerDir)){
    fs.mkdirSync(providerDir, { recursive: true });
}

const providerStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, providerDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'prov-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadProvider = multer({ 
    storage: providerStorage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Keys for Postman: profileImage (1), certificates (up to 10)
const providerDocUploads = uploadProvider.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'certificates', maxCount: 10 }
]);

module.exports = { 
    hospitalUploads, // Purana wala
    contentUploads,  // Naya wala (About Us / Ambulance ke liye)
    doctorDocUploads, // DOCTOR DOCUMENTS
    providerDocUploads, // PROVIDER DOCUMENTS
    uploadExcel // EXCEL FILE UPLOAD
};