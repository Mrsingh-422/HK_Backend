const Doctor = require('../../models/Doctor');
const Hospital = require('../../models/Hospital');
const Provider = require('../../models/Provider');
const Ambulance = require('../../models/Ambulance');
const { getLocationFilter } = require('../../middleware/authMiddleware');

// ==========================================
// 1. LISTING APIs (Location Aware)
// ==========================================

const getDoctorsList = async (req, res) => {
    try {
        const { status, role } = req.query; 
        const locFilter = getLocationFilter(req);
        const filter = { 
            ...locFilter, 
            ...(status && { profileStatus: status }),
            ...(role && { role: role }) 
        };
        const doctors = await Doctor.find(filter).populate('hospitalId', 'name email');
        res.json({ success: true, count: doctors.length, data: doctors });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getHospitalsList = async (req, res) => {
    try {
        const { status } = req.query;
        const locFilter = getLocationFilter(req);
        const filter = { ...locFilter, ...(status && { profileStatus: status }) };
        const hospitals = await Hospital.find(filter);
        res.json({ success: true, count: hospitals.length, data: hospitals });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getProvidersList = async (req, res) => {
    try {
        const { category, status } = req.query;
        const locFilter = getLocationFilter(req);
        let filter = { ...locFilter };
        if (category) filter.category = category; 
        if (status) filter.profileStatus = status;

        const providers = await Provider.find(filter);
        res.json({ success: true, count: providers.length, data: providers });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getAmbulancesList = async (req, res) => {
    try {
        const { status } = req.query;
        const locFilter = getLocationFilter(req);
        const filter = { ...locFilter, ...(status && { profileStatus: status }) };
        const ambulances = await Ambulance.find(filter).populate('hospitalId', 'name');
        res.json({ success: true, count: ambulances.length, data: ambulances });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ==========================================
// 2. APPROVAL & REJECTION LOGIC (Separate APIs)
// ==========================================

// --- DOCTOR ---
const approveDoctor = async (req, res) => {
    try {
        const doctor = await Doctor.findByIdAndUpdate(req.params.id, { profileStatus: 'Approved', rejectionReason: null }, { new: true });
        if (!doctor) return res.status(404).json({ message: 'Doctor not found' });
        res.json({ success: true, message: 'Doctor approved successfully', data: doctor });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const rejectDoctor = async (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ message: 'Rejection reason is required' });
        const doctor = await Doctor.findByIdAndUpdate(req.params.id, { profileStatus: 'Rejected', rejectionReason: reason }, { new: true });
        res.json({ success: true, message: 'Doctor rejected', data: doctor });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- HOSPITAL ---
const approveHospital = async (req, res) => {
    try {
        const hospital = await Hospital.findByIdAndUpdate(req.params.id, { profileStatus: 'Approved', rejectionReason: null }, { new: true });
        res.json({ success: true, message: 'Hospital approved', data: hospital });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const rejectHospital = async (req, res) => {
    try {
        const { reason } = req.body;
        const hospital = await Hospital.findByIdAndUpdate(req.params.id, { profileStatus: 'Rejected', rejectionReason: reason }, { new: true });
        res.json({ success: true, message: 'Hospital rejected', data: hospital });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- PROVIDER (Pharmacy/Lab/Nurse) ---
const approveProvider = async (req, res) => {
    try {
        const provider = await Provider.findByIdAndUpdate(req.params.id, { profileStatus: 'Approved', rejectionReason: null }, { new: true });
        res.json({ success: true, message: 'Provider approved', data: provider });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const rejectProvider = async (req, res) => {
    try {
        const { reason } = req.body;
        const provider = await Provider.findByIdAndUpdate(req.params.id, { profileStatus: 'Rejected', rejectionReason: reason }, { new: true });
        res.json({ success: true, message: 'Provider rejected', data: provider });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- AMBULANCE ---
const approveAmbulance = async (req, res) => {
    try {
        const ambulance = await Ambulance.findByIdAndUpdate(req.params.id, { profileStatus: 'Approved', rejectionReason: null }, { new: true });
        res.json({ success: true, message: 'Ambulance approved', data: ambulance });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const rejectAmbulance = async (req, res) => {
    try {
        const { reason } = req.body;
        const ambulance = await Ambulance.findByIdAndUpdate(req.params.id, { profileStatus: 'Rejected', rejectionReason: reason }, { new: true });
        res.json({ success: true, message: 'Ambulance rejected', data: ambulance });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = {
    getDoctorsList, getHospitalsList, getProvidersList, getAmbulancesList,
    approveDoctor, rejectDoctor,
    approveHospital, rejectHospital,
    approveProvider, rejectProvider,
    approveAmbulance, rejectAmbulance
};