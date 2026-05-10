const Appointment = require('../../models/Appointment');
const Ambulance = require('../../models/Ambulance');


// 1. START RIDE (Driver clicks Start - Screenshot 37)
const startAmbulanceRide = async (req, res) => {
    try {
        const { appointmentId } = req.body;
        const appointment = await Appointment.findById(appointmentId);

        appointment.tracking.status = 'Ride Started';
        appointment.tracking.rideStartTime = new Date();
        appointment.status = 'In-Progress';
        
        await appointment.save();
        res.json({ success: true, message: "Ride started. Patient location shared." });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. REACHED HOSPITAL (Handover to Emergency - Screenshot 37)
const completeAmbulanceRide = async (req, res) => {
    try {
        const { appointmentId } = req.body;
        const appointment = await Appointment.findById(appointmentId);

        appointment.tracking.status = 'Admitted/Dropped to Hospital';
        appointment.tracking.rideEndTime = new Date();
        
        // Ambulance wapas free ho gayi
        await Ambulance.findByIdAndUpdate(appointment.tracking.ambulanceId, { availableForEmergency: true });

        await appointment.save();
        res.json({ success: true, message: "Handover successful. Ambulance is now free." });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 1. UPDATE LIVE LOCATION (Google Maps Sync)
// endpoint: PATCH /api/driver/ambulance/update-location
const updateLiveLocation = async (req, res) => {
    try {
        const { lat, lng, appointmentId } = req.body;

        await Appointment.findByIdAndUpdate(appointmentId, {
            'tracking.liveLocation': {
                lat, lng, lastUpdated: new Date()
            }
        });

        res.json({ success: true, message: "Location Synced" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. CHANGE JOURNEY STATUS (Timeline: Screenshot 37)
// status: 'Ride Started', 'On The Way', 'Admitted/Dropped'
const updateJourneyStatus = async (req, res) => {
    try {
        const { appointmentId, journeyStatus, eta } = req.body;

        const update = {
            'tracking.status': journeyStatus, // Custom timeline status
            'tracking.eta': eta || "10 mins"
        };

        if(journeyStatus === 'Admitted/Dropped') {
            update.status = 'In-Progress'; // Hospital admission process starts
        }

        const appointment = await Appointment.findByIdAndUpdate(appointmentId, update, { new: true });
        res.json({ success: true, message: `Status updated to ${journeyStatus}`, data: appointment });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = {startAmbulanceRide, completeAmbulanceRide, updateLiveLocation, updateJourneyStatus};