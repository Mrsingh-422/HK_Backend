const Appointment = require('../../models/Appointment');
const Ambulance = require('../../models/Ambulance');

// --- 1. START RIDE (Screenshot 37) ---
const startAmbulanceRide = async (req, res) => {
    try {
        const { appointmentId } = req.body;
        
        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment/Trip record not found." });
        }

        if (!appointment.tracking) appointment.tracking = {};
        appointment.tracking.status = 'Ride Started';
        appointment.tracking.rideStartTime = new Date();
        appointment.status = 'In-Progress';
        
        // Mark ambulance as On Duty (Busy)
        await Ambulance.findByIdAndUpdate(req.user.id, { $set: { availableForEmergency: false } });

        await appointment.save();
        res.json({ success: true, message: "Ride started. Patient and Fleet tracking active.", data: appointment });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- 2. REACHED HOSPITAL (Screenshot 37) ---
const completeAmbulanceRide = async (req, res) => {
    try {
        const { appointmentId } = req.body;
        
        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment/Trip record not found." });
        }

        if (!appointment.tracking) appointment.tracking = {};
        appointment.tracking.status = 'Admitted/Dropped to Hospital';
        appointment.tracking.rideEndTime = new Date();
        
        // Ambulance free ho gayi
        await Ambulance.findByIdAndUpdate(req.user.id, { $set: { availableForEmergency: true } });

        await appointment.save();
        res.json({ success: true, message: "Handover successful. Ambulance is now free.", data: appointment });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- 3. DYNAMIC GPS & LIVE LOCATION (Merged Logic) ---
/* 
   Yeh API do kaam karegi:
   1. Ambulance model ki global location badlegi (Admin Panel Map ke liye)
   2. Agar trip chal rahi hai, toh Appointment tracking badlegi (User App ke liye)
*/
const updateAmbulanceGPS = async (req, res) => {
    try {
        const { lat, lng, appointmentId, bookingId } = req.body;
        const driverId = req.user.id;

        if (!lat || !lng) {
            return res.status(400).json({ success: false, message: "Latitude and Longitude are required." });
        }

        const numericLat = Number(lat);
        const numericLng = Number(lng);

        // A. Update global position in Ambulance Model
        await Ambulance.findByIdAndUpdate(driverId, {
            $set: { location: { lat: numericLat, lng: numericLng } }
        });

        const activeRef = appointmentId || bookingId;

        // B. Update trip-specific position (CastError-Proof hybrid lookup)
        if (activeRef) {
            const isObjectId = mongoose.isValidObjectId(activeRef);
            const query = isObjectId ? { _id: activeRef } : { transactionId: activeRef };

            await Appointment.findOneAndUpdate(query, {
                $set: {
                    'tracking.liveLocation': {
                        lat: numericLat,
                        lng: numericLng,
                        lastUpdated: new Date()
                    }
                }
            });
        }

        res.json({ success: true, message: "Real-time location synced with System & User" });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- 4. CHANGE JOURNEY STATUS (Screenshot 37 Timeline) ---
const updateJourneyStatus = async (req, res) => {
    try {
        const { appointmentId, journeyStatus, eta } = req.body;

        const update = {
            'tracking.status': journeyStatus,
            'tracking.eta': eta || "10 mins"
        };

        if (journeyStatus === 'Admitted/Dropped to Hospital') {
            update.status = 'In-Progress';
        }

        const appointment = await Appointment.findByIdAndUpdate(appointmentId, { $set: update }, { new: true });
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment/Trip record not found." });
        }

        res.json({ success: true, message: `Timeline updated to: ${journeyStatus}`, data: appointment });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

module.exports = { startAmbulanceRide, completeAmbulanceRide, updateAmbulanceGPS, updateJourneyStatus };