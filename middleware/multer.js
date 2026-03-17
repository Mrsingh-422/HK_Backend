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
        filename: (req, file, cb) => cb(null, `lab-profile-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter
}).fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'certificates', maxCount: 10 } // Lab License, NABL, etc.
]);

// ==========================================
// 5. PHARMACY CONFIGURATION (Specific)
// ==========================================
const pharmacyDir = 'public/uploads/pharmacies';
ensureDir(pharmacyDir);
const pharmacyDocUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, pharmacyDir),
        filename: (req, file, cb) => cb(null, `pharmacy-profile-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter
}).fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'certificates', maxCount: 10 } // Drug License, GST, etc.
]);

// ==========================================
// 6. NURSE CONFIGURATION (Specific)
// ==========================================
const nurseDir = 'public/uploads/nurses';
ensureDir(nurseDir);
const nurseDocUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, nurseDir),
        filename: (req, file, cb) => cb(null, `nurse-profile-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter
}).fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'certificates', maxCount: 10 } // Degree, Govt Registration, etc.
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
    uploadExcel
}; 