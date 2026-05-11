const Doctor = require('../../models/Doctor');

// 1. GET CURRENT FEES
// endpoint: GET /doctor/settings/fees
const getMyConsultationFees = async (req, res) => {
    try {
        const doctor = await Doctor.findById(req.user.id).select('fees');
        if (!doctor) return res.status(404).json({ message: "Doctor not found" });

        res.json({ success: true, fees: doctor.fees });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. UPDATE FEES (Screenshot 23/28 Mapping)
// endpoint: PUT /doctor/settings/update-fees
const updateConsultationFees = async (req, res) => {
    try {
        const { online, clinic, home } = req.body;

        // Validation: Check if values are numbers and not negative
        if ((online && online < 0) || (clinic && clinic < 0) || (home && home < 0)) {
            return res.status(400).json({ message: "Fees cannot be negative" });
        }

        // Professional Update Logic: Sirf wahi fields update hongi jo body mein aayengi
        const updateData = {};
        if (online !== undefined) updateData['fees.online'] = Number(online);
        if (clinic !== undefined) updateData['fees.clinic'] = Number(clinic);
        if (home !== undefined) updateData['fees.home'] = Number(home);

        const updatedDoctor = await Doctor.findByIdAndUpdate(
            req.user.id,
            { $set: updateData },
            { new: true, runValidators: true }
        ).select('fees');

        res.json({ 
            success: true, 
            message: "Consultation fees updated successfully", 
            data: updatedDoctor.fees 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
// 3. UPDATE CONSULTATION SETTINGS (Fees + On/Off Status)
// endpoint: PUT /doctor/settings/update-settings
const updateConsultationSettings = async (req, res) => {
    try {
        const { 
            onlinePrice, onlineStatus, 
            clinicPrice, clinicStatus, 
            homePrice, homeStatus 
        } = req.body;

        const updateData = {};

        // Price Updates
        if (onlinePrice !== undefined) updateData['fees.online'] = Number(onlinePrice);
        if (clinicPrice !== undefined) updateData['fees.clinic'] = Number(clinicPrice);
        if (homePrice !== undefined) updateData['fees.home'] = Number(homePrice);

        // Toggle (On/Off) Updates
        if (onlineStatus !== undefined) updateData['consultationStatus.online'] = onlineStatus;
        if (clinicStatus !== undefined) updateData['consultationStatus.clinic'] = clinicStatus;
        if (homeStatus !== undefined) updateData['consultationStatus.home'] = homeStatus;

        const updatedDoctor = await Doctor.findByIdAndUpdate(
            req.user.id,
            { $set: updateData },
            { new: true }
        ).select('fees consultationStatus');

        res.json({ 
            success: true, 
            message: "Settings updated successfully", 
            data: updatedDoctor 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { getMyConsultationFees, updateConsultationFees, updateConsultationSettings };