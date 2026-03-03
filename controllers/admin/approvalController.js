const Doctor = require('../../models/Doctor');
const Hospital = require('../../models/Hospital');
const Provider = require('../../models/Provider');
const User = require('../../models/User');

// --- 1. GET PENDING LISTS (Based on Permission) ---

// Get Doctors
const getDoctors = async (req, res) => {
    try {
        const { status } = req.query; // ?status=Pending or ?status=Approved
        const filter = status ? { profileStatus: status } : {};
        
        const doctors = await Doctor.find(filter);
        res.json(doctors);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get Hospitals
// endpoint /api/admin/approval/hospitals?status=Pending
const getHospitals = async (req, res) => {
    try {
        const { status } = req.query;
        const filter = status ? { profileStatus: status } : {};
        
        const hospitals = await Hospital.find(filter);
        res.json(hospitals);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get Providers (Dynamic Category Filter)
// Example: /api/admin/providers?category=Pharmacy&status=Pending
const getProviders = async (req, res) => {
    try {
        const { category, status } = req.query;
        
        let filter = {};
        if (category) filter.category = category; // Nursing, Pharmacy, Lab
        if (status) filter.profileStatus = status;

        const providers = await Provider.find(filter);
        res.json(providers);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


// --- 2. VERIFY (APPROVE / REJECT) APIS ---

// Approve/Reject Doctor
const verifyDoctor = async (req, res) => {
    try {
        const { id, status, reason } = req.body; // status: 'Approved' or 'Rejected'
        
        const updateData = { profileStatus: status };
        if (status === 'Rejected') updateData.rejectionReason = reason;

        const doctor = await Doctor.findByIdAndUpdate(id, updateData, { new: true });
        res.json({ success: true, message: `Doctor ${status}`, data: doctor });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Approve/Reject Hospital
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

// Approve/Reject Provider (Logic to check category permission inside)
const verifyProvider = async (req, res) => {
    try {
        const { id, status, reason } = req.body;

        // 1. Find Provider to check Category
        const provider = await Provider.findById(id);
        if (!provider) return res.status(404).json({ message: 'Provider not found' });

        // 2. Dynamic Permission Check for Sub-Admin
        // Agar user SuperAdmin nahi hai, to permission check karo
        if (req.user.role !== 'superadmin') {
            const categoryMap = {
                'Pharmacy': 'pharmacy',
                'Lab': 'lab',
                'Nursing': 'nursing'
            };
            
            const permissionKey = categoryMap[provider.category];
            
            // Check specific permission (e.g., permissions.pharmacy.canVerify)
            if (!req.user.permissions[permissionKey] || !req.user.permissions[permissionKey].canVerify) {
                return res.status(403).json({ message: `You do not have permission to verify ${provider.category} vendors.` });
            }
        }

        // 3. Update Status
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