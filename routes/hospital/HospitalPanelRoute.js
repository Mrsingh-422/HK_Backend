const router = require('express').Router();
const { protect } = require('../../middleware/authMiddleware');
const { serviceUpload } = require('../../middleware/multer');
const { 
    getHospitalMasterData,getHospitalDashboardStats,
    createWardUnit,getBedsInWard,updateBedDetails,admitPatientToBed,updateWardBeds, addHospitalService, updateHospitalService, 
    generateFinalBillAndDischarge, generateHospitalCoupon, getHospitalCoupons ,deleteSpecificBed,
    getHospitalServices, getWardStatus,updateBedStatus,assignDoctorToAdmission,getAvailableDrivers, assignDriverToCase,
    getIncomingReferrals,getHospitalWards, updateWardInfo, deleteWard, getAllHospitalAdmissions
} = require('../../controllers/hospital/HospitalPanel');

// Base: /hospital/panel

router.get('/get-enums', protect('hospital'), getHospitalMasterData);

router.get('/dashboard-stats', protect('hospital'), getHospitalDashboardStats);
router.post('/ward/create', protect('hospital'), createWardUnit);
router.get('/ward/:wardId/beds', protect('hospital'), getBedsInWard);
router.put('/bed/update/:bedId', protect('hospital'), updateBedDetails);
router.delete('/bed/delete/:bedId', protect('hospital'), deleteSpecificBed);

router.post('/ward/admit-patient', protect('hospital'), admitPatientToBed);
router.put('/ward/update-beds', protect('hospital'), updateWardBeds);
router.get('/ward-status', protect('hospital'), getWardStatus);
router.patch('/bed/status', protect('hospital'), updateBedStatus);
router.post('/admissions/assign-doctor', protect('hospital'), assignDoctorToAdmission);

router.post('/service/add', protect('hospital'), serviceUpload.single('image'), addHospitalService);
router.put('/service/update/:id', protect('hospital'), serviceUpload.single('image'), updateHospitalService);
router.get('/services', protect('hospital'), getHospitalServices);


router.post('/coupon/generate', protect('hospital'), generateHospitalCoupon);
router.get('/coupon/list', protect('hospital'), getHospitalCoupons);

router.get('/available-drivers', protect('hospital'), getAvailableDrivers);
router.post('/assign-driver', protect('hospital'), assignDriverToCase);


router.post('/discharge/finalize', protect('hospital'), generateFinalBillAndDischarge);
router.get('/referrals/incoming', protect('hospital'), getIncomingReferrals);

// --- WARD MANAGEMENT ---
router.get('/wards/list', protect('hospital'), getHospitalWards); // New: Get All Wards
router.put('/ward/update/:wardId', protect('hospital'), updateWardInfo); // New: Update Ward
router.delete('/ward/delete/:wardId', protect('hospital'), deleteWard); // New: Delete Ward

// --- PATIENT / ADMISSION MANAGEMENT ---
router.get('/admissions/all', protect('hospital'), getAllHospitalAdmissions); // New: All Admissions List


module.exports = router;