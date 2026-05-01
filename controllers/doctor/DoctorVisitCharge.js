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

// 1. SAVE/UPDATE VISIT CHARGES
const saveDoctorVisitCharges = async (req, res) => {
    try {
        const doctorId = req.user.id;

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

        res.json({ success: true, message: "Visit/Travel charges saved successfully", data: charges });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. GET DOCTOR'S VISIT CHARGES
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