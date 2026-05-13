const Appointment = require('../../models/Appointment');
const Ambulance = require('../../models/Ambulance');

// --- 1. START RIDE (Screenshot 37) ---
const startAmbulanceRide = async (req, res) => {
    try {
        const { appointmentId } = req.body;
        const appointment = await Appointment.findById(appointmentId);

        appointment.tracking.status = 'Ride Started';
        appointment.tracking.rideStartTime = new Date();
        appointment.status = 'In-Progress';
        
        // Mark ambulance as On Duty (Busy)
        await Ambulance.findByIdAndUpdate(req.user.id, { availableForEmergency: false });

        await appointment.save();
        res.json({ success: true, message: "Ride started. Patient and Fleet tracking active." });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 2. REACHED HOSPITAL (Screenshot 37) ---
const completeAmbulanceRide = async (req, res) => {
    try {
        const { appointmentId } = req.body;
        const appointment = await Appointment.findById(appointmentId);

        appointment.tracking.status = 'Admitted/Dropped to Hospital';
        appointment.tracking.rideEndTime = new Date();
        
        // Ambulance wapas free ho gayi
        await Ambulance.findByIdAndUpdate(req.user.id, { availableForEmergency: true });

        await appointment.save();
        res.json({ success: true, message: "Handover successful. Ambulance is now free." });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 3. DYNAMIC GPS & LIVE LOCATION (Merged Logic) ---
/* 
   Yeh API do kaam karegi:
   1. Ambulance model ki global location badlegi (Admin Panel Map ke liye)
   2. Agar trip chal rahi hai, toh Appointment tracking badlegi (User App ke liye)
*/
const updateAmbulanceGPS = async (req, res) => {
    try {
        const { lat, lng, appointmentId } = req.body;

        // A. Update global position in Ambulance Model
        await Ambulance.findByIdAndUpdate(req.user.id, {
            location: { lat: Number(lat), lng: Number(lng) }
        });

        // B. Update trip-specific position in Appointment Model (If active)
        if (appointmentId) {
            await Appointment.findByIdAndUpdate(appointmentId, {
                'tracking.liveLocation': {
                    lat: Number(lat),
                    lng: Number(lng),
                    lastUpdated: new Date()
                }
            });
        }

        res.json({ success: true, message: "Real-time location synced with System & User" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 4. CHANGE JOURNEY STATUS (Screenshot 37 Timeline) ---
const updateJourneyStatus = async (req, res) => {
    try {
        const { appointmentId, journeyStatus, eta } = req.body;

        const update = {
            'tracking.status': journeyStatus, // e.g., 'On The Way'
            'tracking.eta': eta || "10 mins"
        };

        if(journeyStatus === 'Admitted/Dropped to Hospital') {
            update.status = 'In-Progress'; // Admission process starts
        }

        const appointment = await Appointment.findByIdAndUpdate(appointmentId, update, { new: true });
        res.json({ success: true, message: `Timeline updated to: ${journeyStatus}` });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { startAmbulanceRide, completeAmbulanceRide, updateAmbulanceGPS, updateJourneyStatus };