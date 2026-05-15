const Booking = require('../../models/AmbulanceBooking');
const Ambulance = require('../../models/Ambulance');

// 1. GET NEW REQUESTS (PAGINATED)
const getIncomingRequests = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;

        const requests = await Booking.find({ status: 'Searching' })
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .populate('userId', 'name phone profilePic');

        res.json({ success: true, page, data: requests });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. ACCEPT REQUEST (Figma Screen 35)
const acceptBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const ambulanceId = req.user.id;

        // Check if driver is already on duty
        const driver = await Ambulance.findById(ambulanceId);
        if (!driver.availableForEmergency) return res.status(400).json({ message: "You are already on a trip" });

        const booking = await Booking.findByIdAndUpdate(bookingId, {
            ambulanceId: ambulanceId,
            status: 'Confirmed',
            $push: { trackingTimeline: { status: 'Driver Assigned', note: `${driver.name} is on the way` } }
        }, { new: true });

        // Mark driver busy
        driver.availableForEmergency = false;
        await driver.save();

        res.json({ success: true, message: "Trip Confirmed", data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. UPDATE TRIP PROGRESS (Figma Screen 37 Timeline)
// Status flow: Arrived -> Picked-Up -> En-Route -> Delivered
const updateTripStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, note, patientCondition } = req.body; 

        const booking = await Booking.findById(id);
        if (!booking) return res.status(404).json({ message: "Trip not found" });

        booking.status = status;
        if (patientCondition) booking.patientDetails.condition = patientCondition;

        // Push to Figma Timeline
        booking.trackingTimeline.push({ 
            status: status, 
            timestamp: new Date(),
            note: note || `Patient marked as ${status}`
        });

        if (status === 'Delivered') {
            await Ambulance.findByIdAndUpdate(booking.ambulanceId, { availableForEmergency: true });
        }

        await booking.save();
        res.json({ success: true, message: `Status: ${status}`, data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. CAPTURE INCIDENT PHOTO (Figma Screen 33)
const uploadIncidentPhoto = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No photo uploaded" });
        
        const booking = await Booking.findByIdAndUpdate(req.params.id, {
            'patientDetails.incidentPhoto': `/uploads/incidents/${req.file.filename}`
        }, { new: true });

        res.json({ success: true, message: "Photo uploaded", data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const finalizeTripHandoff = async (req, res) => {
    try {
        const { id } = req.params; // Booking ID
        const { doctorName, wardName, duration, reason } = req.body;

        const booking = await Booking.findById(id);
        if (!booking) return res.status(404).json({ message: "Booking not found" });

        // 1. Save Handoff Details
        booking.handoffDetails = {
            doctorName,
            wardName,
            duration,
            reasonAtHandoff: reason,
            completedAt: new Date()
        };

        // 2. Mark Trip as Delivered/Completed
        booking.status = 'Delivered';
        
        // 3. Update Timeline
        booking.trackingTimeline.push({
            status: 'Patient delivered to hospital',
            timestamp: new Date(),
            note: `Handoff done to ${doctorName} in ${wardName}`
        });

        // 4. Ambulance ko free karein (On Duty -> Available)
        await Ambulance.findByIdAndUpdate(booking.ambulanceId, { availableForEmergency: true });

        await booking.save();
        res.json({ success: true, message: "Trip Finalized Successfully", data: booking });

    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 1. VERIFY OTP (Figma Screen 36) ---
const verifyPickupOtp = async (req, res) => {
    try {
        const { id } = req.params;
        const { otp } = req.body;

        const booking = await Booking.findById(id);
        if (booking.otp !== otp) return res.status(400).json({ message: "Invalid OTP" });

        booking.isOtpVerified = true;
        booking.status = 'Picked-Up';
        booking.trackingTimeline.push({ status: 'Patient pickup confirmed', timestamp: new Date() });
        await booking.save();

        res.json({ success: true, message: "OTP Verified. Start Navigation." });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { getIncomingRequests, acceptBooking, updateTripStatus, uploadIncidentPhoto,
    finalizeTripHandoff,verifyPickupOtp
 };