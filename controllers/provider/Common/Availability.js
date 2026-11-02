// controllers/provider/Common/Availability.js
const Availability = require('../../../models/Availability');
const { generateTimeSlots, generateNurseSlots } = require('../../../utils/timeSlotHelper');
const NurseService = require('../../../models/NurseService');

// lab ke liye
// {
//     "morningSlots": true,
//     "afternoonSlots": true,
//     "eveningSlots": false,
//     "startTime": "09:00",
//     "endTime": "18:00",
//     "slotDuration": 30,
//     "maxClientsPerSlot": 2,
//     "offDays": ["Sunday"]
// }

// pharmacy ke liye
// {
//     "morningSlots": true,
//     "afternoonSlots": true,
//     "eveningSlots": true,
//     "startTime": "10:00",
//     "endTime": "22:00",
//     "offDays": []
// }

// 1. SET/UPDATE SLOTS (Production Ready)
const setSlots = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const vendorType = req.user.role;

        // Validation: Start time must be before end time
        if (req.body.startTime && req.body.endTime) {
            if (req.body.startTime >= req.body.endTime) {
                return res.status(400).json({ message: "Start time must be before End time" });
            }
        }

        const slots = await Availability.findOneAndUpdate(
            { vendorId }, 
            { $set: { ...req.body, vendorId, vendorType } }, 
            { upsert: true, new: true }
        );

        res.json({ success: true, message: "Availability settings saved", data: slots });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// 2. GET MY SLOTS
const getMySlots = async (req, res) => {
    try {
        const config = await Availability.findOne({ vendorId: req.user.id });
        if (!config) return res.json({ success: true, data: null });

        let generatedSlots = [];
        if (config.vendorType !== 'Pharmacy') {
            generatedSlots = generateTimeSlots(config);
        }

        res.json({ success: true, config, generatedSlots });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. BLOCK/HIDE A SLOT
const blockSlot = async (req, res) => {
    try {
        const { time } = req.body;
        await Availability.findOneAndUpdate(
            { vendorId: req.user.id },
            { $addToSet: { unavailableSlots: time } }
        );
        res.json({ success: true, message: "Slot hidden" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. UNBLOCK A SLOT
const unblockSlot = async (req, res) => {
    try {
        const { time } = req.body;
        await Availability.findOneAndUpdate(
            { vendorId: req.user.id },
            { $pull: { unavailableSlots: time } }
        );
        res.json({ success: true, message: "Slot visible again" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};



// 1. SET NURSE AVAILABILITY (Figma Screen 2, 7)
const setNurseAvailability = async (req, res) => {
    try {
        const nurseId = req.user.id;
        const { premiumDates, ...rest } = req.body;

        const config = await Availability.findOneAndUpdate(
            { vendorId: nurseId },
            { 
                $set: { 
                    ...rest, 
                    vendorId: nurseId, 
                    vendorType: 'Nurse',
                    premiumDates: premiumDates // Array of {date: "2026-05-03", extraFee: 500}
                } 
            },
            { upsert: true, new: true }
        );

        res.json({ success: true, message: "Settings saved", data: config });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// @desc    Get Nurse Availability & Generated Hourly/Regular Slots (Fixed NaN Price Calculation)
// @route   GET /provider/availability/my-nurse-slots
// @access  Private (Nurse)
const getMyNurseSlots = async (req, res) => {
    try {
        const { serviceId } = req.query;
        const nurseId = req.user.id;

        const config = await Availability.findOne({ vendorId: nurseId });
        if (!config) {
            return res.status(200).json({ 
                success: true, 
                message: "No availability settings configured yet.", 
                config: null, 
                slots: { regular: [], hourly: [], premiumDates: [] } 
            });
        }

        // Fetch specific service if serviceId is passed, otherwise pick first active service of this nurse
        let service = null;
        if (serviceId) {
            service = await NurseService.findById(serviceId);
        } else {
            service = await NurseService.findOne({ nurseId, status: 'Approved' });
        }

        const serviceFinalPrice = Number(service?.pricing?.oneDay?.final || 500);
        const hourlyFinalPrice = Number(service?.pricing?.hourly?.final || 200);

        // Fixed: Pass (config, numericBasePrice) matching timeSlotHelper signature
        const slots = {
            regular: generateNurseSlots(config, serviceFinalPrice),
            hourly: generateNurseSlots(config, hourlyFinalPrice),
            premiumDates: (config.premiumDates || []).map(pd => ({
                date: pd.date,
                additionalFee: Number(pd.extraFee || 0),
                totalPriceOnDate: serviceFinalPrice + Number(pd.extraFee || 0)
            }))
        };

        return res.status(200).json({ success: true, config, slots });
    } catch (e) { 
        return res.status(500).json({ success: false, message: e.message }); 
    }
};



// 3. TOGGLE SLOT STATUS (Block/Unblock)
const toggleNurseSlot = async (req, res) => {
    try {
        const { time, action } = req.body; // action: 'block' or 'unblock'
        const update = action === 'block' 
            ? { $addToSet: { unavailableSlots: time } }
            : { $pull: { unavailableSlots: time } };

        await Availability.findOneAndUpdate({ vendorId: req.user.id }, update);
        res.json({ success: true, message: `Slot ${action}ed successfully` });
    } catch (error) { res.status(500).json({ message: error.message }); }
};



module.exports = { setSlots, getMySlots, blockSlot, unblockSlot, setNurseAvailability, getMyNurseSlots, toggleNurseSlot };