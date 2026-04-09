const Availability = require('../../models/Availability');
const { generateTimeSlots } = require('../../utils/timeSlotHelper');

// 1. SET/UPDATE DOCTOR SLOTS
// Doctors usually use slotDuration (e.g., 15 or 30 mins per patient)
const setDoctorSlots = async (req, res) => {
    try {
        const doctorId = req.user.id;
        const role = req.user.role; // Should be 'Doctor'

        // Validation: Start time must be before end time
        if (req.body.startTime && req.body.endTime) {
            if (req.body.startTime >= req.body.endTime) {
                return res.status(400).json({ message: "Start time must be before End time" });
            }
        }

        const slots = await Availability.findOneAndUpdate(
            { vendorId: doctorId }, 
            { 
                $set: { 
                    ...req.body, 
                    vendorId: doctorId, 
                    vendorType: 'Doctor' // Hardcoded for Doctor flow
                } 
            }, 
            { upsert: true, new: true }
        );

        res.json({ success: true, message: "Doctor availability saved", data: slots });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
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