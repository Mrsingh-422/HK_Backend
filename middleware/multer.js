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
const hospitalUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, hospitalDir),
        filename: (req, file, cb) => cb(null, `hospital-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
});

const hospitalUploads = hospitalUpload.fields([
    { name: 'hospitalImage', maxCount: 5 },
    { name: 'licenseDocument', maxCount: 5 },
    { name: 'otherDocuments', maxCount: 10 }
]);

// ==========================================
// 3. DOCTOR CONFIGURATION (Fixed for Hospital Doctors)
// ==========================================
const doctorDir = 'public/uploads/doctors';
ensureDir(doctorDir);
const uploadDoctor = multer({ 
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, doctorDir),
        filename: (req, file, cb) => cb(null, `doc-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
});

// Matches keys used in both Independent and Hospital-Doctor flows
const doctorDocUploads = uploadDoctor.fields([
    { name: 'profileImage', maxCount: 1 },  // circle avatar
    { name: 'certificates', maxCount: 10 }, // multiple certificates
    { name: 'qualificationDoc', maxCount: 1 },
    { name: 'licenseDoc', maxCount: 1 },
    { name: 'photoId', maxCount: 1 }
]);

// ==========================================
// 4. PROVIDER CONFIGURATION
// ==========================================
const providerDir = 'public/uploads/providers';
ensureDir(providerDir);
const providerDocUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, providerDir),
        filename: (req, file, cb) => cb(null, `prov-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter
}).fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'certificates', maxCount: 10 }
]);

// ==========================================
// 5. AMBULANCE CONFIGURATION
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
// 6. EXCEL & FRONTEND CONFIGURATION
// ==========================================
const excelDir = 'public/uploads/excel';
const frontendDir = 'public/uploads/homepage';
ensureDir(excelDir);
ensureDir(frontendDir);

const uploadExcel = multer({ storage: multer.diskStorage({ destination: (req, file, cb) => cb(null, excelDir), filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`) }) });
const contentUploads = multer({ storage: multer.diskStorage({ destination: (req, file, cb) => cb(null, frontendDir), filename: (req, file, cb) => cb(null, `content-${Date.now()}${path.extname(file.originalname)}`) }) }).array('images', 10);

// ==========================================
// 7. USER REPORTS (Figma: Patient Details Upload Button)
// ==========================================
const userReportDir = 'public/uploads/user_reports';
if (!fs.existsSync(userReportDir)) fs.mkdirSync(userReportDir, { recursive: true });

const userReportUploads = multer({ 
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, userReportDir),
        filename: (req, file, cb) => cb(null, `report-${Date.now()}${path.extname(file.originalname)}`)
    })
}).single('medicalReport'); // Figma: Patient Details upload button


// ==========================================
// 8. LAB SERVICES CONFIGURATION (Tests & Packages)
// ==========================================
const labServiceDir = 'public/uploads/lab_services';
ensureDir(labServiceDir);

const labServiceStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, labServiceDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'lab-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadLabService = multer({ 
    storage: labServiceStorage,
    fileFilter: docFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Figma ke according 'photos' key use hogi multiple images ke liye
const labServiceUploads = uploadLabService.fields([
    { name: 'photos', maxCount: 10 } // Lab test ya package ki photos
]);


module.exports = { 
    hospitalUploads,
    contentUploads,
    doctorDocUploads,
    userReportUploads,
    providerDocUploads,
    ambulanceDocUploads,
        labServiceUploads,
    uploadExcel
};