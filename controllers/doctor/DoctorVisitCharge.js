const DeliveryCharge = require('../../models/DeliveryCharge');

const DEFAULT_DOCTOR_CHARGES = {
    fixedPrice: 100, // Doctor base travel fee thoda zyada ho sakta hai
    fixedDistance: 3,
    pricePerKM: 10,
    fastDeliveryExtra: 200, // Emergency visit
    freeDeliveryThreshold: 0,
    taxPercentage: 0,
    taxInRupees: 0
};

// @desc    Save/Update Home Visit Travel Charges (Strictly for Independent Doctors)
// @route   POST /doctor/visit-charges/save
// @access  Private (Doctor)
const saveDoctorVisitCharges = async (req, res) => {
    try {
        const doctorId = req.user.id;

        if (req.user.role === 'hospital-doctor') {
            return res.status(403).json({
                success: false,
                isHospitalDoctor: true,
                message: "Access Denied: Home Visit is only available for Independent Doctors. Hospital Doctors only support Hospital Visit (OPD)."
            });
        }

        const charges = await DeliveryCharge.findOneAndUpdate(
            { vendorId: doctorId },
            { 
                $set: { 
                    ...req.body, 
                    vendorId: doctorId, 
                    vendorType: 'Doctor' 
                } 
            },
            { upsert: true, new: true }
        );

        return res.status(200).json({ 
            success: true, 
            message: "Visit/Travel charges saved successfully", 
            data: charges 
        });
    } catch (error) { 
        return res.status(500).json({ success: false, message: error.message }); 
    }
};

// @desc    Get Doctor's Visit Charges
// @route   GET /doctor/visit-charges
// @access  Private (Doctor)
const getDoctorVisitCharges = async (req, res) => {
    try {
        const charges = await DeliveryCharge.findOne({ vendorId: req.user.id });

        if (!charges) {
            return res.json({ 
                success: true, 
                data: { ...DEFAULT_DOCTOR_CHARGES, vendorType: 'Doctor' }, 
                isDefault: true 
            });
        }
        
        res.json({ success: true, data: charges, isDefault: false });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

module.exports = { saveDoctorVisitCharges, getDoctorVisitCharges };