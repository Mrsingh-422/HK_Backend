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

// @desc    Update Independent Doctor Consultation Fees (Blocks hospital-doctor from enabling Video/Home visit)
// @route   PUT /doctor/settings/update-fees
// @access  Private (Doctor)
const updateConsultationFees = async (req, res) => {
    try {
        if (req.user.role === 'hospital-doctor') {
            return res.status(403).json({ 
                success: false, 
                isHospitalDoctor: true,
                message: "Access Denied: Hospital Doctors only support Hospital Visit (OPD) bookings. Video Call and Home Visit are strictly for Independent Doctors." 
            });
        }

        const { online, clinic, home } = req.body;

        if ((online !== undefined && Number(online) < 0) || 
            (clinic !== undefined && Number(clinic) < 0) || 
            (home !== undefined && Number(home) < 0)) {
            return res.status(400).json({ success: false, message: "Fees cannot be negative." });
        }

        const updateData = {};
        if (online !== undefined) updateData['fees.online'] = Number(online);
        if (clinic !== undefined) updateData['fees.clinic'] = Number(clinic);
        if (home !== undefined) updateData['fees.home'] = Number(home);

        const updatedDoctor = await Doctor.findByIdAndUpdate(
            req.user.id,
            { $set: updateData },
            { new: true, runValidators: true }
        ).select('fees');

        return res.status(200).json({ 
            success: true, 
            message: "Consultation fees updated successfully", 
            data: updatedDoctor.fees 
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Update Independent Doctor Consultation Settings (Fees + On/Off Status)
// @route   PUT /doctor/settings/update-settings
// @access  Private (Doctor)
const updateConsultationSettings = async (req, res) => {
    try {
        if (req.user.role === 'hospital-doctor') {
            return res.status(403).json({ 
                success: false, 
                isHospitalDoctor: true,
                message: "Access Denied: Hospital Doctors only support Hospital Visit (OPD) bookings configured by the Hospital." 
            });
        }

        const { 
            onlinePrice, onlineStatus, 
            clinicPrice, clinicStatus, 
            homePrice, homeStatus 
        } = req.body;

        const updateData = {};

        if (onlinePrice !== undefined) updateData['fees.online'] = Math.max(0, Number(onlinePrice));
        if (clinicPrice !== undefined) updateData['fees.clinic'] = Math.max(0, Number(clinicPrice));
        if (homePrice !== undefined) updateData['fees.home'] = Math.max(0, Number(homePrice));

        if (onlineStatus !== undefined) {
            updateData['consultationStatus.online'] = (onlineStatus === true || onlineStatus === 'true');
        }
        if (clinicStatus !== undefined) {
            updateData['consultationStatus.clinic'] = (clinicStatus === true || clinicStatus === 'true');
        }
        if (homeStatus !== undefined) {
            updateData['consultationStatus.home'] = (homeStatus === true || homeStatus === 'true');
        }

        const updatedDoctor = await Doctor.findByIdAndUpdate(
            req.user.id,
            { $set: updateData },
            { new: true }
        ).select('fees consultationStatus');

        return res.status(200).json({ 
            success: true, 
            message: "Settings updated successfully", 
            data: updatedDoctor 
        });
    } catch (error) { 
        return res.status(500).json({ success: false, message: error.message }); 
    }
};

module.exports = { getMyConsultationFees, updateConsultationFees, updateConsultationSettings };