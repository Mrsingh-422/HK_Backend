const Availability = require('../../models/Availability');
const { generateTimeSlots } = require('../../utils/timeSlotHelper');

// @desc    Set/Update Independent Doctor Availability Slots (Blocks hospital-doctor override)
// @route   POST /doctor/availability/set
// @access  Private (Doctor)
const setDoctorSlots = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const role = req.user.role;

        // 🚨 FIX: Hospital doctors must be configured by Hospital Admin only
        if (role === 'hospital-doctor') {
            return res.status(403).json({
                success: false,
                isHospitalDoctor: true,
                message: "Access Denied: As a Hospital Doctor, your OPD cabin timings and fee are configured directly by the Hospital Management."
            });
        }

        if (req.body.startTime && req.body.endTime) {
            if (req.body.startTime >= req.body.endTime) {
                return res.status(400).json({ success: false, message: "Start time must be before End time." });
            }
        }

        const slots = await Availability.findOneAndUpdate(
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

        return res.status(200).json({ success: true, message: "Doctor availability saved successfully.", data: slots });
    } catch (error) { 
        return res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. GET DOCTOR'S CURRENT SLOTS (With Generated Slots)
const getDoctorSlots = async (req, res) => {
    try {
        const config = await Availability.findOne({ vendorId: req.user.id, vendorType: 'Doctor' });
        
        if (!config) {
            return res.json({ success: true, message: "No availability set", data: null });
        }

        // Generate actual time slots based on duration (15/30/60 min)
        const generatedSlots = generateTimeSlots(config);

        res.json({ success: true, config, generatedSlots });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 3. BLOCK A SPECIFIC TIME (e.g., Emergency or Break)
const blockDoctorSlot = async (req, res) => {
    try {
        const { time } = req.body; // e.g., "14:30"
        await Availability.findOneAndUpdate(
            { vendorId: req.user.id, vendorType: 'Doctor' },
            { $addToSet: { unavailableSlots: time } }
        );
        res.json({ success: true, message: `Time ${time} blocked for appointments` });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 4. UNBLOCK A PREVIOUSLY BLOCKED TIME
const unblockDoctorSlot = async (req, res) => {
    try {
        const { time } = req.body;
        await Availability.findOneAndUpdate(
            { vendorId: req.user.id, vendorType: 'Doctor' },
            { $pull: { unavailableSlots: time } }
        );
        res.json({ success: true, message: `Time ${time} is now available again` });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

module.exports = { setDoctorSlots, getDoctorSlots, blockDoctorSlot, unblockDoctorSlot };