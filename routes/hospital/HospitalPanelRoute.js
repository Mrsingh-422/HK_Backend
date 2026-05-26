const router = require('express').Router();
const { protect } = require('../../middleware/authMiddleware');
const { serviceUpload, termsUpload } = require('../../middleware/multer');
const { 
    getHospitalMasterData,getHospitalDashboardStats,
    createWardUnit,getBedsInWard,updateBedDetails,admitPatientToBed,updateWardBeds, addHospitalService, updateHospitalService, 
    generateFinalBillAndDischarge, generateHospitalCoupon, getHospitalCoupons ,updateHospitalCoupon,toggleCouponStatus,deleteSpecificBed,
    getHospitalServices, getWardStatus,updateBedStatus,assignDoctorToAdmission,getAvailableDrivers, assignDriverToCase,
    getIncomingReferrals,getEmergencyCases, trackAllAmbulances, getHospitalWards, updateWardInfo, deleteWard, getAllHospitalAdmissions,
    toggleAmbulanceStatus,updateHospitalTerms, getHospitalTerms, getHospitalPanelRatings,
    getDailyOccupancy,finalizeDischarge, setHospitalShift ,getHospitalReferralBookings,
    updateBedPrice, uploadHospitalTermsPdf

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


// coupon management routes
router.post('/coupon/generate', protect('hospital'), generateHospitalCoupon);
router.get('/coupon/list', protect('hospital'), getHospitalCoupons);
router.put('/coupon/update/:id', protect('hospital'), updateHospitalCoupon);
router.patch('/coupon/toggle/:id', protect('hospital'), toggleCouponStatus);

// --- DRIVER MANAGEMENT ---
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

// --- EMERGENCY & AMBULANCE ---
router.get('/emergency-cases', protect('hospital'), getEmergencyCases);
router.get('/track-ambulances', protect('hospital'), trackAllAmbulances);

router.post('/ambulance/toggle-status', protect('hospital'), toggleAmbulanceStatus);

router.put('/terms', protect('hospital'), updateHospitalTerms);
router.get('/terms', protect('hospital'), getHospitalTerms);
router.get('/ratings', protect('hospital'), getHospitalPanelRatings);


router.get('/daily-occupancy', protect('hospital'), getDailyOccupancy);
router.post('/finalize-discharge', protect('hospital'), finalizeDischarge);
router.post('/set-shift', protect('hospital'), setHospitalShift);

router.get('/referral-bookings', protect('hospital'), getHospitalReferralBookings);


router.put('/bed/update-price', protect('hospital'), updateBedPrice);
// Terms and Conditions PDF Import route
router.put('/terms/uploadfile', protect('hospital'), termsUpload, uploadHospitalTermsPdf);

module.exports = router;