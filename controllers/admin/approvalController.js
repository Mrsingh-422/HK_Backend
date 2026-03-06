const Doctor = require('../../models/Doctor');
const Hospital = require('../../models/Hospital');
const Provider = require('../../models/Provider');
const { getLocationFilter } = require('../../middleware/authMiddleware');

// --- 1. GET LISTS (Location Aware) ---

const getDoctors = async (req, res) => {
    try {
        const { status } = req.query;
        // Location restricted filter
        const locFilter = getLocationFilter(req);
        const filter = { ...locFilter, ...(status && { profileStatus: status }) };
        
        const doctors = await Doctor.find(filter);
        res.json({ success: true, data: doctors });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getHospitals = async (req, res) => {
    try {
        const { status } = req.query;
        const locFilter = getLocationFilter(req);
        const filter = { ...locFilter, ...(status && { profileStatus: status }) };
        
        const hospitals = await Hospital.find(filter);
        res.json({ success: true, data: hospitals });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getProviders = async (req, res) => {
    try {
        const { category, status } = req.query;
        const locFilter = getLocationFilter(req);
        
        let filter = { ...locFilter };
        if (category) filter.category = category; 
        if (status) filter.profileStatus = status;

        const providers = await Provider.find(filter);
        res.json({ success: true, data: providers });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


// --- 2. VERIFY (APPROVE / REJECT) ---

const verifyDoctor = async (req, res) => {
    try {
        const { id, status, reason } = req.body;
        
        const updateData = { profileStatus: status };
        if (status === 'Rejected') updateData.rejectionReason = reason;

        const doctor = await Doctor.findByIdAndUpdate(id, updateData, { new: true });
        res.json({ success: true, message: `Doctor ${status}`, data: doctor });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const verifyHospital = async (req, res) => {
    try {
        const { id, status, reason } = req.body;
        
        const updateData = { profileStatus: status };
        if (status === 'Rejected') updateData.rejectionReason = reason;

        const hospital = await Hospital.findByIdAndUpdate(id, updateData, { new: true });
        res.json({ success: true, message: `Hospital ${status}`, data: hospital });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const verifyProvider = async (req, res) => {
    try {
        const { id, status, reason } = req.body;

        const provider = await Provider.findById(id);
        if (!provider) return res.status(404).json({ message: 'Provider not found' });

        provider.profileStatus = status;
        if (status === 'Rejected') provider.rejectionReason = reason;
        await provider.save();

        res.json({ success: true, message: `Provider (${provider.category}) ${status}`, data: provider });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getDoctors, getHospitals, getProviders,
    verifyDoctor, verifyHospital, verifyProvider
};