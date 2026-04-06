// middleware/multer.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Helper to create directory if not exists
const ensureDir = (dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

// ==========================================
// 1. FILTERS (Common for Doctors/Providers)
// ==========================================
const docFileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
        cb(null, true);
    } else {
        cb(new Error('Only Images and PDF files are allowed!'), false);
    }
};

// ==========================================
// 2. HOSPITAL CONFIGURATION
// ==========================================
const hospitalDir = 'public/uploads/hospitals';
ensureDir(hospitalDir);
const hospitalUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, hospitalDir),
        filename: (req, file, cb) => cb(null, `hospital-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
}).fields([
    { name: 'hospitalImage', maxCount: 5 },
    { name: 'licenseDocument', maxCount: 5 },
    { name: 'otherDocuments', maxCount: 10 }
]);

// ==========================================
// 3. DOCTOR CONFIGURATION
// ==========================================
const doctorDir = 'public/uploads/doctors';
ensureDir(doctorDir);
const doctorDocUploads = multer({ 
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, doctorDir),
        filename: (req, file, cb) => cb(null, `doc-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
}).fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'certificates', maxCount: 10 },
    { name: 'qualificationDoc', maxCount: 1 },
    { name: 'licenseDoc', maxCount: 1 },
    { name: 'photoId', maxCount: 1 }
]);

// ==========================================
// 4. LAB CONFIGURATION (Specific)
// ==========================================
const labDir = 'public/uploads/labs';
ensureDir(labDir);
const labDocUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, labDir),
        filename: (req, file, cb) => cb(null, `lab-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
}).fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'labImages', maxCount: 10 },
    { name: 'labCertificates', maxCount: 10 },
    { name: 'labLicenses', maxCount: 10 },
    { name: 'gstCertificates', maxCount: 5 },
    { name: 'drugLicenses', maxCount: 5 },
    { name: 'otherCertificates', maxCount: 10 }
]);

// ==========================================
// 5. PHARMACY CONFIGURATION (Specific)
// ==========================================
const pharmacyDocUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, 'public/uploads/pharmacies'),
        filename: (req, file, cb) => cb(null, `pharma-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
}).fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'pharmacyImages', maxCount: 10 },       // Matches Figma
    { name: 'pharmacyCertificates', maxCount: 10 }, // Matches Figma
    { name: 'pharmacyLicenses', maxCount: 10 },     // Matches Figma
    { name: 'gstCertificates', maxCount: 5 },       // Matches Figma
    { name: 'drugLicenses', maxCount: 5 },          // Matches Figma
    { name: 'otherCertificates', maxCount: 10 }     // Matches Figma
]);

// ==========================================
// 6. NURSE CONFIGURATION (Specific)
// ==========================================
const nurseDocUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, 'public/uploads/nurses'),
        filename: (req, file, cb) => cb(null, `nurse-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
}).fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'nursingCertificates', maxCount: 10 },    // Figma: Nursing Certificate
    { name: 'licensePhotos', maxCount: 10 },          // Figma: License Photo
    { name: 'gstCertificates', maxCount: 5 },        // Figma: GST Certificate
    { name: 'experienceCertificates', maxCount: 10 }, // Figma: Award/Experience
    { name: 'otherCertificates', maxCount: 10 }       // Figma: Other
]);

// ==========================================
// 7. AMBULANCE CONFIGURATION
// ==========================================
const ambulanceDir = 'public/uploads/ambulances';
ensureDir(ambulanceDir);
const ambulanceDocUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, ambulanceDir),
        filename: (req, file, cb) => cb(null, `amb-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter
}).fields([
    { name: 'drivingLicenseFile', maxCount: 1 },
    { name: 'rcFile', maxCount: 1 },
    { name: 'insuranceFile', maxCount: 1 },
    { name: 'fitnessCertificate', maxCount: 1 },
    { name: 'ambulancePermit', maxCount: 1 }
]);

// ==========================================
// 8. LAB SERVICES (Tests & Packages Photos)
// ==========================================
const labServiceDir = 'public/uploads/lab_services';
ensureDir(labServiceDir);
const labServiceUploads = multer({ 
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, labServiceDir),
        filename: (req, file, cb) => cb(null, `service-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter
}).fields([
    { name: 'photos', maxCount: 10 }
]);

// ==========================================
// 9. MISC (Excel, Frontend, User Reports)
// ==========================================
const excelDir = 'public/uploads/excel';
const frontendDir = 'public/uploads/homepage';
const userReportDir = 'public/uploads/user_reports';
ensureDir(excelDir); ensureDir(frontendDir); ensureDir(userReportDir);

const uploadExcel = multer({ storage: multer.diskStorage({ destination: (req, file, cb) => cb(null, excelDir), filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`) }) });
const contentUploads = multer({ storage: multer.diskStorage({ destination: (req, file, cb) => cb(null, frontendDir), filename: (req, file, cb) => cb(null, `content-${Date.now()}${path.extname(file.originalname)}`) }) }).array('images', 10);
const userReportUploads = multer({ storage: multer.diskStorage({ destination: (req, file, cb) => cb(null, userReportDir), filename: (req, file, cb) => cb(null, `report-${Date.now()}${path.extname(file.originalname)}`) }) }).single('medicalReport');


// ==========================================
// 10. DRIVER DOCUMENT CONFIGURATION
// ==========================================
const driverDir = 'public/uploads/drivers';
ensureDir(driverDir);

const driverDocUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, driverDir),
        filename: (req, file, cb) => cb(null, `driver-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter, // Purana wala common filter
    limits: { fileSize: 5 * 1024 * 1024 }
}).fields([
    { name: 'profilePic', maxCount: 1 },        // Figma: Driver Profile Image
    { name: 'certificate', maxCount: 1 },       // Figma: Add Certificate
    { name: 'license', maxCount: 1 },           // Figma: Add Driver License
    { name: 'rcImage', maxCount: 1 }            // Figma: Add RC Image
]);

// ==========================================
// 11. PRESCRIPTION CONFIGURATION (User Side)
// ==========================================
const prescriptionDir = 'public/uploads/prescriptions';
ensureDir(prescriptionDir);

const prescriptionUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, prescriptionDir),
        filename: (req, file, cb) => cb(null, `presc-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// ==========================================
// 12. BANNER CONFIGURATION
// ==========================================
const bannerDir = 'public/uploads/banners';
ensureDir(bannerDir);

const bannerUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, 'public/uploads/banners'),
        filename: (req, file, cb) => cb(null, `banner-${Date.now()}-${file.originalname}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
}).array('image', 10);


// ==========================================
// 13. ARTICLES admin CONFIGURATION
// ==========================================
const articleDir = 'public/uploads/articles';
ensureDir(articleDir);

const articleUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, articleDir),
        filename: (req, file, cb) => cb(null, `art-${Date.now()}-${file.originalname}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
}).array('image', 10); // Multiple images key: 'images'


// ==========================================
// 14. ADS admin CONFIGURATION
// ==========================================
const adDir = 'public/uploads/ads';
ensureDir(adDir);

const adUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, adDir),
        filename: (req, file, cb) => cb(null, `ad-${Date.now()}-${file.originalname}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
}).array('image', 5); // Max 5 images per ad



// ==========================================
// 15. USER CONFIGURATION
// ==========================================

const userDir = 'public/uploads/users';
ensureDir(userDir);
const userProfileUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, userDir),
        filename: (req, file, cb) => cb(null, `user-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit
}).single('profilePic');

module.exports = { 
    hospitalUploads,
    contentUploads,
    doctorDocUploads,
    userReportUploads,
    labDocUploads,         // For Lab Step 2
    pharmacyDocUploads,    // For Pharmacy Step 2
    nurseDocUploads,       // For Nurse Step 2
    ambulanceDocUploads,
    labServiceUploads,     // For Lab Tests/Packages
    driverDocUploads,
    prescriptionUploads,
    bannerUploads,
    articleUploads,
    adUploads,
    userProfileUpload,
    uploadExcel
};  