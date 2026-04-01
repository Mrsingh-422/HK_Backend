const Doctor = require('../../models/Doctor');
const Hospital = require('../../models/Hospital');
const Ambulance = require('../../models/Ambulance');
const Lab = require('../../models/Lab');
const Pharmacy = require('../../models/Pharmacy');
const Nurse = require('../../models/Nurse');
const { getLocationFilter } = require('../../middleware/authMiddleware');

// Helper function to handle listing with Search and Pagination
const getPaginatedList = async (Model, req, res, searchFields = [], populateFields = null) => {
    try {
        const { status, page = 1, limit = 10, search = "" } = req.query;
        const locFilter = getLocationFilter(req);

        const filter = { ...locFilter };
        if (status) filter.profileStatus = status;

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
    res.json({ success: true, message: 'Doctor approved', data: doctor });
};

const rejectDoctor = async (req, res) => {
    const { reason } = req.body;
    const doctor = await Doctor.findByIdAndUpdate(req.params.id, { profileStatus: 'Rejected', rejectionReason: reason }, { new: true });
    res.json({ success: true, message: 'Doctor rejected', data: doctor });
};

// --- HOSPITAL ---
const getHospitalsList = (req, res) => getPaginatedList(Hospital, req, res, ['name', 'email']);

const approveHospital = async (req, res) => {
    const hospital = await Hospital.findByIdAndUpdate(req.params.id, { profileStatus: 'Approved', rejectionReason: null }, { new: true });
    res.json({ success: true, message: 'Hospital approved', data: hospital });
};

const rejectHospital = async (req, res) => {
    const { reason } = req.body;
    const hospital = await Hospital.findByIdAndUpdate(req.params.id, { profileStatus: 'Rejected', rejectionReason: reason }, { new: true });
    res.json({ success: true, message: 'Hospital rejected', data: hospital });
};

// --- LAB ---
const getLabsList = (req, res) => getPaginatedList(Lab, req, res, ['name', 'email']);

const approveLab = async (req, res) => {
    const lab = await Lab.findByIdAndUpdate(req.params.id, { profileStatus: 'Approved', rejectionReason: null }, { new: true });
    res.json({ success: true, message: 'Lab approved', data: lab });
};

const rejectLab = async (req, res) => {
    const { reason } = req.body;
    const lab = await Lab.findByIdAndUpdate(req.params.id, { profileStatus: 'Rejected', rejectionReason: reason }, { new: true });
    res.json({ success: true, message: 'Lab rejected', data: lab });
};

// --- PHARMACY ---
const getPharmaciesList = (req, res) => getPaginatedList(Pharmacy, req, res, ['name', 'email']);

const approvePharmacy = async (req, res) => {
    const pharmacy = await Pharmacy.findByIdAndUpdate(req.params.id, { profileStatus: 'Approved', rejectionReason: null }, { new: true });
    res.json({ success: true, message: 'Pharmacy approved', data: pharmacy });
};

const rejectPharmacy = async (req, res) => {
    const { reason } = req.body;
    const pharmacy = await Pharmacy.findByIdAndUpdate(req.params.id, { profileStatus: 'Rejected', rejectionReason: reason }, { new: true });
    res.json({ success: true, message: 'Pharmacy rejected', data: pharmacy });
};

// --- NURSE ---
const getNursesList = (req, res) => getPaginatedList(Nurse, req, res, ['name', 'email']);

const approveNurse = async (req, res) => {
    const nurse = await Nurse.findByIdAndUpdate(req.params.id, { profileStatus: 'Approved', rejectionReason: null }, { new: true });
    res.json({ success: true, message: 'Nurse approved', data: nurse });
};

const rejectNurse = async (req, res) => {
    const { reason } = req.body;
    const nurse = await Nurse.findByIdAndUpdate(req.params.id, { profileStatus: 'Rejected', rejectionReason: reason }, { new: true });
    res.json({ success: true, message: 'Nurse rejected', data: nurse });
};

// --- AMBULANCE ---
const getAmbulancesList = (req, res) => getPaginatedList(Ambulance, req, res, ['vehicleNumber', 'driverName'], 'hospitalId');

const approveAmbulance = async (req, res) => {
    const ambulance = await Ambulance.findByIdAndUpdate(req.params.id, { profileStatus: 'Approved', rejectionReason: null }, { new: true });
    res.json({ success: true, message: 'Ambulance approved', data: ambulance });
};

const rejectAmbulance = async (req, res) => {
    const { reason } = req.body;
    const ambulance = await Ambulance.findByIdAndUpdate(req.params.id, { profileStatus: 'Rejected', rejectionReason: reason }, { new: true });
    res.json({ success: true, message: 'Ambulance rejected', data: ambulance });
};

module.exports = {
    getDoctorsList, approveDoctor, rejectDoctor,
    getHospitalsList, approveHospital, rejectHospital,
    getLabsList, approveLab, rejectLab,
    getPharmaciesList, approvePharmacy, rejectPharmacy,
    getNursesList, approveNurse, rejectNurse,
    getAmbulancesList, approveAmbulance, rejectAmbulance
};