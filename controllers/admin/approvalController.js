const Doctor = require('../../models/Doctor');
const Hospital = require('../../models/Hospital');
const Ambulance = require('../../models/Ambulance');
const Lab = require('../../models/Lab');
const Pharmacy = require('../../models/Pharmacy');
const Nurse = require('../../models/Nurse');
const { getLocationFilter } = require('../../middleware/authMiddleware');
const {sendPushNotification} = require('../../utils/notification');

const getPaginatedList = async (Model, req, res, searchFields = [], populateFields = null) => {
    try {
        // Query parameters me geographic parameters add kiye
        const { status, page = 1, limit = 10, search = "", country, state, city } = req.query;
        const locFilter = getLocationFilter(req);
 
        const filter = { ...locFilter };
        if (status) filter.profileStatus = status;
 
        // Custom Dropdown query support
        if (country) filter.country = { $regex: country, $options: 'i' };
        if (state) filter.state = { $regex: state, $options: 'i' };
        if (city) filter.city = { $regex: city, $options: 'i' };
 
        if (search && searchFields.length > 0) {
            filter.$or = searchFields.map(field => ({
                [field]: { $regex: search, $options: 'i' }
            }));
        }
 
        const skip = (page - 1) * limit;
        const totalDocs = await Model.countDocuments(filter);
       
        let query = Model.find(filter).skip(skip).limit(parseInt(limit)).sort({ createdAt: -1 });
        if (populateFields) query = query.populate(populateFields);
 
        const data = await query;
 
        res.json({
            success: true,
            totalDocs,
            totalPages: Math.ceil(totalDocs / limit),
            currentPage: parseInt(page),
            data
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
 

// --- DOCTOR ---
const getDoctorsList = (req, res) => getPaginatedList(Doctor, req, res, ['name', 'email', 'specialization'], { path: 'hospitalId', select: 'name email' });

const approveDoctor = async (req, res) => {
    const doctor = await Doctor.findByIdAndUpdate(req.params.id, { profileStatus: 'Approved', rejectionReason: null }, { new: true });
    if (!doctor) return res.status(404).json({ success: false, message: "Doctor not found." });

    try {
        await sendPushNotification(
            doctor._id,
            'doctor',
            "🎉 Profile Approved!",
            "Congratulations! Your Doctor account has been approved by Health Kangaroo Admin. You can now login and receive appointments.",
            { type: 'ACCOUNT_APPROVED', role: 'doctor', click_action: 'FLUTTER_NOTIFICATION_CLICK' }
        );
    } catch (e) {}

    res.json({ success: true, message: 'Doctor approved and notified.', data: doctor });
};

const rejectDoctor = async (req, res) => {
    const { reason } = req.body;
    const doctor = await Doctor.findByIdAndUpdate(req.params.id, { profileStatus: 'Rejected', rejectionReason: reason || "Documents verification failed." }, { new: true });
    if (!doctor) return res.status(404).json({ success: false, message: "Doctor not found." });

    try {
        await sendPushNotification(
            doctor._id,
            'doctor',
            "⚠️ Application Rejected",
            `Your Doctor verification was declined. Reason: "${doctor.rejectionReason}". Please re-upload valid documents.`,
            { type: 'ACCOUNT_REJECTED', role: 'doctor', reason: String(doctor.rejectionReason), click_action: 'FLUTTER_NOTIFICATION_CLICK' }
        );
    } catch (e) {}

    res.json({ success: true, message: 'Doctor rejected and notified.', data: doctor });
};


// --- HOSPITAL ---
const getHospitalsList = (req, res) => getPaginatedList(Hospital, req, res, ['name', 'email']);

const approveHospital = async (req, res) => {
    const hospital = await Hospital.findByIdAndUpdate(req.params.id, { profileStatus: 'Approved', rejectionReason: null }, { new: true });
    if (!hospital) return res.status(404).json({ success: false, message: "Hospital not found." });

    try {
        await sendPushNotification(
            hospital._id,
            'hospital',
            "🎉 Hospital Profile Approved!",
            "Your Hospital profile has been verified and approved. You can now manage beds, wards, and admissions.",
            { type: 'ACCOUNT_APPROVED', role: 'hospital', click_action: 'FLUTTER_NOTIFICATION_CLICK' }
        );
    } catch (e) {}

    res.json({ success: true, message: 'Hospital approved and notified.', data: hospital });
};

const rejectHospital = async (req, res) => {
    const { reason } = req.body;
    const hospital = await Hospital.findByIdAndUpdate(req.params.id, { profileStatus: 'Rejected', rejectionReason: reason || "Hospital license documents failed verification." }, { new: true });
    if (!hospital) return res.status(404).json({ success: false, message: "Hospital not found." });

    try {
        await sendPushNotification(
            hospital._id,
            'hospital',
            "⚠️ Hospital Application Rejected",
            `Your hospital verification was declined. Reason: "${hospital.rejectionReason}". Please check documents.`,
            { type: 'ACCOUNT_REJECTED', role: 'hospital', reason: String(hospital.rejectionReason), click_action: 'FLUTTER_NOTIFICATION_CLICK' }
        );
    } catch (e) {}

    res.json({ success: true, message: 'Hospital rejected and notified.', data: hospital });
};


// --- LAB ---
const getLabsList = (req, res) => getPaginatedList(Lab, req, res, ['name', 'email']);

const approveLab = async (req, res) => {
    const lab = await Lab.findByIdAndUpdate(req.params.id, { profileStatus: 'Approved', rejectionReason: null }, { new: true });
    if (!lab) return res.status(404).json({ success: false, message: "Lab not found." });

    try {
        await sendPushNotification(
            lab._id,
            'lab',
            "🎉 Lab Account Approved!",
            "Your Diagnostic Lab partner profile has been approved. You can now list tests and receive patient orders.",
            { type: 'ACCOUNT_APPROVED', role: 'lab', click_action: 'FLUTTER_NOTIFICATION_CLICK' }
        );
    } catch (e) {}

    res.json({ success: true, message: 'Lab approved and notified.', data: lab });
};

const rejectLab = async (req, res) => {
    const { reason } = req.body;
    const lab = await Lab.findByIdAndUpdate(req.params.id, { profileStatus: 'Rejected', rejectionReason: reason || "Lab documents verification failed." }, { new: true });
    if (!lab) return res.status(404).json({ success: false, message: "Lab not found." });

    try {
        await sendPushNotification(
            lab._id,
            'lab',
            "⚠️ Lab Application Rejected",
            `Your diagnostic lab onboarding was declined. Reason: "${lab.rejectionReason}". Please update required files.`,
            { type: 'ACCOUNT_REJECTED', role: 'lab', reason: String(lab.rejectionReason), click_action: 'FLUTTER_NOTIFICATION_CLICK' }
        );
    } catch (e) {}

    res.json({ success: true, message: 'Lab rejected and notified.', data: lab });
};


// --- PHARMACY ---
const getPharmaciesList = (req, res) => getPaginatedList(Pharmacy, req, res, ['name', 'email']);

const approvePharmacy = async (req, res) => {
    const pharmacy = await Pharmacy.findByIdAndUpdate(req.params.id, { profileStatus: 'Approved', rejectionReason: null }, { new: true });
    if (!pharmacy) return res.status(404).json({ success: false, message: "Pharmacy not found." });

    try {
        await sendPushNotification(
            pharmacy._id,
            'pharmacy',
            "🎉 Pharmacy Account Approved!",
            "Your Pharmacy store has been approved by Health Kangaroo Admin. You can now manage medicine inventory and orders.",
            { type: 'ACCOUNT_APPROVED', role: 'pharmacy', click_action: 'FLUTTER_NOTIFICATION_CLICK' }
        );
    } catch (e) {}

    res.json({ success: true, message: 'Pharmacy approved and notified.', data: pharmacy });
};

const rejectPharmacy = async (req, res) => {
    const { reason } = req.body;
    const pharmacy = await Pharmacy.findByIdAndUpdate(req.params.id, { profileStatus: 'Rejected', rejectionReason: reason || "Drug License or GST verification failed." }, { new: true });
    if (!pharmacy) return res.status(404).json({ success: false, message: "Pharmacy not found." });

    try {
        await sendPushNotification(
            pharmacy._id,
            'pharmacy',
            "⚠️ Pharmacy Application Rejected",
            `Your pharmacy onboarding was declined. Reason: "${pharmacy.rejectionReason}". Please review license documents.`,
            { type: 'ACCOUNT_REJECTED', role: 'pharmacy', reason: String(pharmacy.rejectionReason), click_action: 'FLUTTER_NOTIFICATION_CLICK' }
        );
    } catch (e) {}

    res.json({ success: true, message: 'Pharmacy rejected and notified.', data: pharmacy });
};


// --- NURSE ---
const getNursesList = (req, res) => getPaginatedList(Nurse, req, res, ['name', 'email']);

const approveNurse = async (req, res) => {
    const nurse = await Nurse.findByIdAndUpdate(req.params.id, { profileStatus: 'Approved', rejectionReason: null }, { new: true });
    if (!nurse) return res.status(404).json({ success: false, message: "Nurse not found." });

    try {
        await sendPushNotification(
            nurse._id,
            'nurse',
            "🎉 Nursing Profile Approved!",
            "Your Nurse Bureau / Provider account has been approved. You can now receive home care bookings.",
            { type: 'ACCOUNT_APPROVED', role: 'nurse', click_action: 'FLUTTER_NOTIFICATION_CLICK' }
        );
    } catch (e) {}

    res.json({ success: true, message: 'Nurse approved and notified.', data: nurse });
};

const rejectNurse = async (req, res) => {
    const { reason } = req.body;
    const nurse = await Nurse.findByIdAndUpdate(req.params.id, { profileStatus: 'Rejected', rejectionReason: reason || "Nursing certificate verification failed." }, { new: true });
    if (!nurse) return res.status(404).json({ success: false, message: "Nurse not found." });

    try {
        await sendPushNotification(
            nurse._id,
            'nurse',
            "⚠️ Nursing Application Rejected",
            `Your nursing onboarding was declined. Reason: "${nurse.rejectionReason}". Please re-upload valid certificates.`,
            { type: 'ACCOUNT_REJECTED', role: 'nurse', reason: String(nurse.rejectionReason), click_action: 'FLUTTER_NOTIFICATION_CLICK' }
        );
    } catch (e) {}

    res.json({ success: true, message: 'Nurse rejected and notified.', data: nurse });
};


// --- AMBULANCE ---
const getAmbulancesList = (req, res) => getPaginatedList(Ambulance, req, res, ['vehicleNumber', 'driverName'], 'hospitalId');

const approveAmbulance = async (req, res) => {
    const ambulance = await Ambulance.findByIdAndUpdate(req.params.id, { profileStatus: 'Approved', rejectionReason: null }, { new: true });
    if (!ambulance) return res.status(404).json({ success: false, message: "Ambulance not found." });

    try {
        await sendPushNotification(
            ambulance._id,
            'ambulance',
            "🎉 Ambulance Driver Profile Approved!",
            "Your Ambulance driver account has been verified and approved. You can now toggle online and receive emergency dispatches.",
            { type: 'ACCOUNT_APPROVED', role: 'ambulance', click_action: 'FLUTTER_NOTIFICATION_CLICK' }
        );
    } catch (e) {}

    res.json({ success: true, message: 'Ambulance approved and notified.', data: ambulance });
};

const rejectAmbulance = async (req, res) => {
    const { reason } = req.body;
    const ambulance = await Ambulance.findByIdAndUpdate(req.params.id, { profileStatus: 'Rejected', rejectionReason: reason || "Driving license or RC verification failed." }, { new: true });
    if (!ambulance) return res.status(404).json({ success: false, message: "Ambulance not found." });

    try {
        await sendPushNotification(
            ambulance._id,
            'ambulance',
            "⚠️ Ambulance Registration Declined",
            `Your ambulance driver profile was declined. Reason: "${ambulance.rejectionReason}". Please re-upload RC/DL documents.`,
            { type: 'ACCOUNT_REJECTED', role: 'ambulance', reason: String(ambulance.rejectionReason), click_action: 'FLUTTER_NOTIFICATION_CLICK' }
        );
    } catch (e) {}

    res.json({ success: true, message: 'Ambulance rejected and notified.', data: ambulance });
};

module.exports = {
    getDoctorsList, approveDoctor, rejectDoctor,
    getHospitalsList, approveHospital, rejectHospital,
    getLabsList, approveLab, rejectLab,
    getPharmaciesList, approvePharmacy, rejectPharmacy,
    getNursesList, approveNurse, rejectNurse,
    getAmbulancesList, approveAmbulance, rejectAmbulance
};