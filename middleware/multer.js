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
    { name: 'ambulancePermit', maxCount: 1 },

     { name: 'vehicleImages', maxCount: 5 },
    { name: 'rcFile', maxCount: 2 },
    { name: 'drivingLicenseFile', maxCount: 2 },
    { name: 'insuranceFile', maxCount: 1 },
    { name: 'referralCard', maxCount: 1 },
    { name: 'incidentPhoto', maxCount: 1 },

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

// 🔒 File Filter add kiya gaya hai taaki sirf CSV, TSV, aur Excel allow ho
const excelCsvFilter = (req, file, cb) => {
    const allowedExtensions = ['.csv', '.tsv', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedExtensions.includes(ext) || file.mimetype.includes('csv') || file.mimetype.includes('excel') || file.mimetype.includes('spreadsheetml')) {
        cb(null, true); // File accepted
    } else {
        cb(new Error('Invalid file type! Only CSV, TSV, and Excel files are allowed.'), false); // File rejected
    }
};

// Updated uploadExcel with filter
const uploadExcel = multer({ 
    storage: multer.diskStorage({ 
        destination: (req, file, cb) => cb(null, excelDir), 
        filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`) 
    }),
    fileFilter: excelCsvFilter // 👈 Ye add karna best practice hai
});

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

// ==========================================
// 16. LOCKER CONFIGURATION
// ==========================================
const lockerDir = 'public/uploads/locker';
ensureDir(lockerDir);

const lockerUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, lockerDir),
        filename: (req, file, cb) => cb(null, `locker-${Date.now()}${path.extname(file.originalname)}`)
    })
});


// ==========================================
// 17. INSURANCE DOCUMENT CONFIGURATION
// ==========================================
const insuranceDir = 'public/uploads/insurance';
ensureDir(insuranceDir);

const insuranceUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, insuranceDir),
        filename: (req, file, cb) => cb(null, `insurance-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: (req, file, cb) => {
        // Allowing Images, PDF, and DOC files as per Flutter UI requirements
        const allowedMimes = [
            'image/jpeg', 'image/jpg', 'image/png', 
            'application/pdf', 
            'application/msword', 
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];
        
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only Images, PDF, and Word documents are allowed!'), false);
        }
    },
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// ==========================================
// 18. PHARMACY PRESCRIPTION CONFIGURATION
// ==========================================
const pharmaPrescriptionDir = 'public/uploads/pharmacy_prescriptions';
ensureDir(pharmaPrescriptionDir);

const pharmacyPrescriptionUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, pharmaPrescriptionDir),
        filename: (req, file, cb) => cb(null, `pharma-rx-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter, // Images and PDF allowed
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// ==========================================
// 19. FIRE HQ CONFIGURATION
// ==========================================
const fireHQDir = 'public/uploads/fire_hq';
ensureDir(fireHQDir);
const fireHQUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, fireHQDir),
        filename: (req, file, cb) => cb(null, `hq-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
}).fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'hqDocuments', maxCount: 5 }
]);

// ==========================================
// 20. FIRE STATION CONFIGURATION
// ==========================================
const fireStationDir = 'public/uploads/fire_stations';
ensureDir(fireStationDir);
const fireStationUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, fireStationDir),
        filename: (req, file, cb) => cb(null, `stn-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
}).fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'stationImages', maxCount: 5 },
    { name: 'certificates', maxCount: 5 }
]);

// ==========================================
// 21. FIRE STAFF CONFIGURATION
// ==========================================
const fireStaffDir = 'public/uploads/fire_staff';
ensureDir(fireStaffDir);
const fireStaffUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, fireStaffDir),
        filename: (req, file, cb) => cb(null, `staff-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB for profile pics
}).single('profileImage'); // Figma Screen 1: Staff profile photo upload

// ==========================================
// 22. POLICE HQ CONFIGURATION
// ==========================================
const policeHQDir = 'public/uploads/police_hq';
ensureDir(policeHQDir);
const policeHQUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, policeHQDir),
        filename: (req, file, cb) => cb(null, `phq-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
}).fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'hqDocuments', maxCount: 5 }
]);

// ==========================================
// 23. POLICE STATION CONFIGURATION
// ==========================================
const policeStationDir = 'public/uploads/police_stations';
ensureDir(policeStationDir);
const policeStationUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, policeStationDir),
        filename: (req, file, cb) => cb(null, `ps-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
}).fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'stationImages', maxCount: 5 }
]);

// ==========================================
// 24. POLICE STAFF CONFIGURATION
// ==========================================
const policeStaffDir = 'public/uploads/police_staff';
ensureDir(policeStaffDir);
const policeStaffUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, policeStaffDir),
        filename: (req, file, cb) => cb(null, `pstaff-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 2 * 1024 * 1024 }
}).single('profileImage');

// ==========================================
// 25. CATEGORY CONFIGURATION
// ==========================================
const categoryDir = 'public/uploads/categories';
ensureDir(categoryDir);
const categoryTestUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, categoryDir),
        filename: (req, file, cb) => cb(null, `cat-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 2 * 1024 * 1024 }
}).single('categoryImage'); // Key for Postman: categoryImage

// ==========================================
// 26. FIRE CASE/INCIDENT REPORT CONFIGURATION
// ==========================================
// ADDON: Screen 66 Scene Photos ke liye
const fireCaseDir = 'public/uploads/fire_cases';
ensureDir(fireCaseDir);

const fireCaseUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, fireCaseDir),
        filename: (req, file, cb) => cb(null, `case-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
}).fields([
    { name: 'incidentImages', maxCount: 10 }, // Figma Screen 66: Scene Photos
    { name: 'medicalCertificate', maxCount: 1 } // Support for medical files if needed
]);


// ==========================================
// 27. NURSE SERVICES (Daily Care & Packages)
// ==========================================
const nurseServiceDir = 'public/uploads/nurse_services';
ensureDir(nurseServiceDir);

const nurseServiceUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, nurseServiceDir),
        filename: (req, file, cb) => cb(null, `nservice-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter, // Image and PDF filter
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
}).fields([
    { name: 'photos', maxCount: 10 } // Figma Screen 42: "Add Service Photo"
]);

// ==========================================
// EXPORTING ALL UPLOAD CONFIGURATIONS
// ==========================================
const careCSVDir = 'public/uploads/care_csv';
ensureDir(careCSVDir);

const careCSVUpload = multer({ 
    storage: multer.diskStorage({ 
        destination: (req, file, cb) => cb(null, careCSVDir), 
        filename: (req, file, cb) => cb(null, `care-${Date.now()}-${file.originalname}`) 
    }),
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.csv' || ext === '.xlsx' || ext === '.xls' || file.mimetype.includes('csv') || file.mimetype.includes('excel') || file.mimetype.includes('spreadsheetml')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV, XLSX, and XLS files are allowed'), false);
        }
    }
}).single('file'); // Postman key: 'file'

// ==========================================
// 28. FIRE STAFF UPDATE (Screen 92)
// ==========================================
// Staff ki purani folder use karenge 'public/uploads/fire_staff'
const fireStaffUpdateUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, fireStaffDir),
        filename: (req, file, cb) => cb(null, `staff-upd-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB
}).single('profileImage'); // Key for Postman: profileImage


// ==========================================
// 29. FIRE STATION PROFILE UPDATE (Screen 21)
// ==========================================
// Station ki purani folder use karenge 'public/uploads/fire_stations'
const fireStationUpdateUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, fireStationDir),
        filename: (req, file, cb) => cb(null, `stn-upd-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
}).single('profileImage'); // Key for Postman: profileImage

// ==========================================
// 30. FIRE INCIDENT EVIDENCE (Screenshot Upload Status)
// ==========================================
// Folder: public/uploads/fire_evidence
const fireEvidenceDir = 'public/uploads/fire_evidence';
ensureDir(fireEvidenceDir);

const fireEvidenceUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, fireEvidenceDir),
        filename: (req, file, cb) => cb(null, `evidence-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: (req, file, cb) => {
        // Figma Screenshot ke according: Max 5 photos (JPG, PNG)
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only JPG and PNG images are allowed!'), false);
        }
    },
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB per image
}).fields([
    { name: 'incidentImages', maxCount: 5 } // Figma key: incidentImages
]);

// ==========================================
// 31. FIRE LEAVE ATTACHMENT (Screen: New Request)
// ==========================================
const fireLeaveDir = 'public/uploads/fire_leaves';
ensureDir(fireLeaveDir);

const fireLeaveUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, fireLeaveDir),
        filename: (req, file, cb) => cb(null, `leave-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter, // Images and PDF allowed
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
}).single('attachment'); // 👈 Key name matching Figma: 'attachment'


// ==========================================
// 32. NURSE PACKAGES (Multiple Photos)
// ==========================================
const nursePackageDir = 'public/uploads/nurse_packages';
ensureDir(nursePackageDir);

const nursePackageUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, nursePackageDir),
        filename: (req, file, cb) => cb(null, `pkg-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
}).fields([
    { name: 'photos', maxCount: 10 } // Key name: photos
]);


// ==========================================
// 33. HOSPITAL SERVICES (Icons/Photos)
// ==========================================
const hospitalServiceDir = 'public/uploads/hospital_services';
ensureDir(hospitalServiceDir);

const serviceUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, hospitalServiceDir),
        filename: (req, file, cb) => cb(null, `service-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter,
    limits: { fileSize: 3 * 1024 * 1024 } // 3MB
});

// ==========================================
// 34. HOSPITAL TERMS FILE CONFIGURATION (TXT Only)
// ==========================================
const termsFileDir = 'public/uploads/hospital_terms';
ensureDir(termsFileDir);

const termsUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, termsFileDir),
        filename: (req, file, cb) => cb(null, `terms-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        // Strictly allow only .txt extension
        if (ext === '.txt' || file.mimetype === 'text/plain') {
            cb(null, true);
        } else {
            cb(new Error('Only TXT (Plain Text) files are allowed!'), false);
        }
    },
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB limit (TXT file ke liye bahut hai)
}).single('termsPdf'); // Postman key: 'termsPdf'


// ==========================================
// 35. DOCTOR DISCHARGE MEDICAL REPORTS UPLOADS (Figma Screen: Upload Reports)
// ==========================================
const doctorReportDir = 'public/uploads/doctor_reports';
ensureDir(doctorReportDir);

const doctorReportUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, doctorReportDir),
        filename: (req, file, cb) => cb(null, `report-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: docFileFilter, // Images and PDF allowed
    limits: { fileSize: 10 * 1024 * 1024 } // Max 10MB per file
}).array('clinicalReports', 10); // 👈 Allows uploading up to 10 files at once! Postman key: 'clinicalReports'


// ==========================================
// 36. POLICE CASE EVIDENCE UPLOADS (Figma Case Details Screen)
// ==========================================
const policeEvidenceDir = 'public/uploads/police_evidence';
ensureDir(policeEvidenceDir);

const policeEvidenceUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, policeEvidenceDir),
        filename: (req, file, cb) => cb(null, `pevid-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: (req, file, cb) => {
        // Figma instructions: JPG, PNG, MP4 or PDF allowed
        const allowedMimes = [
            'image/jpeg', 'image/jpg', 'image/png', 
            'application/pdf', 
            'video/mp4'
        ];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only JPG, PNG, MP4, and PDF files are allowed!'), false);
        }
    },
    limits: { fileSize: 15 * 1024 * 1024 } // 15MB limit to allow video/PDF evidence
}).array('evidenceFiles', 10); // Multi-upload support up to 10 files (Postman Key: 'evidenceFiles')



// ==========================================
// 37. PATIENT DIET PLAN PDF UPLOADS (Figma Screen: Diet Plan Profile)
// ==========================================
const dietPlanDir = 'public/uploads/diet_plans';
ensureDir(dietPlanDir);

const dietPlanUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, dietPlanDir),
        filename: (req, file, cb) => cb(null, `diet-${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: (req, file, cb) => {
        // Strictly allow only PDF documents for diet plan
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF documents are allowed for Diet Plan!'), false);
        }
    },
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
}).single('dietPlanPdf'); // Postman/Flutter key: 'dietPlanPdf'


// ==========================================
// 38. PHARMACY COMBO OFFERS CONFIGURATION
// ==========================================
const comboOfferDir = 'public/uploads/combo_offers';
ensureDir(comboOfferDir);

const comboOfferUploads = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, comboOfferDir),
        filename: (req, file, cb) => cb(null, `combo-${Date.now()}-${file.originalname}`)
    }),
    fileFilter: (req, file, cb) => {
        // Only images are allowed
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only Images are allowed for Combo Offers!'), false);
        }
    },
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB per image limit
}).fields([
    { name: 'images', maxCount: 10 } // Allows uploading up to 10 images at once
]);


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
    insuranceUpload,
    lockerUpload,
    pharmacyPrescriptionUploads,
    uploadExcel,

    fireHQUploads,
    fireStationUploads,
    fireStaffUploads,
     policeHQUploads,
    policeStationUploads,
    policeStaffUploads,
    fireCaseUploads,
    categoryTestUploads,
    nurseServiceUploads,
    careCSVUpload,
    fireStaffUpdateUploads, // Screen 92: Update Staff Profile
    fireStationUpdateUploads, // Screen 21: Update Station Profile
    fireEvidenceUploads, // Screen 101: Upload Evidence
    fireLeaveUploads, // Screen: New Request
    nursePackageUploads, // Screen: New Package
    serviceUpload, // Screen: Add Service
    termsUpload,
    doctorReportUploads,
    policeEvidenceUploads,
    dietPlanUploads,
    comboOfferUploads

};  