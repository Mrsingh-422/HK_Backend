const mongoose = require('mongoose');
const Appointment = require('../../models/Appointment');
const Booking = require('../../models/AmbulanceBooking');
const Ambulance = require('../../models/Ambulance');

// --- 1. START RIDE (Figma Screen 37) ---
const startAmbulanceRide = async (req, res) => {
    try {
        const { bookingId } = req.body;
        const driverId = req.user.id;
        
        if (!bookingId) {
            return res.status(400).json({ success: false, message: "bookingId is required to start the ride." });
        }

        const isObjectId = mongoose.isValidObjectId(bookingId);
        const query = isObjectId ? { _id: bookingId } : { bookingId: String(bookingId).trim() };

        const booking = await Booking.findOne(query);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Ambulance trip record not found." });
        }

        booking.status = 'En-Route';
        booking.trackingTimeline.push({
            status: 'En-Route',
            timestamp: new Date(),
            note: "Ambulance driver started the journey to destination hospital."
        });
        
        // Lock driver busy state
        await Ambulance.findByIdAndUpdate(driverId, { 
            $set: { availableForEmergency: false, isOnline: true } 
        });
        await booking.save();

        // Sync linked hospital appointment if exists
        if (booking.bookingId) {
            await Appointment.findOneAndUpdate(
                { transactionId: booking.bookingId },
                { $set: { 'tracking.status': 'En-Route', 'tracking.rideStartTime': new Date() } }
            );
        }

        res.json({ 
            success: true, 
            message: "Ride started. Live patient and fleet tracking active.", 
            data: booking 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- 2. REACHED HOSPITAL (Handover Drop) ---
const completeAmbulanceRide = async (req, res) => {
    try {
        const { appointmentId, bookingId } = req.body;
        const driverId = req.user.id;

        const targetId = appointmentId || bookingId;
        if (!targetId) {
            return res.status(400).json({ success: false, message: "appointmentId or bookingId is required." });
        }

        const isObjectId = mongoose.isValidObjectId(targetId);
        const query = isObjectId ? { _id: targetId } : { bookingId: String(targetId).trim() };

        // 1. Sync Booking Model
        const booking = await Booking.findOne(query);
        if (booking) {
            booking.status = 'Delivered';
            if (booking.paymentMethod === 'COD') {
                booking.paymentStatus = 'Paid';
            }
            await booking.save();
        }

        // 2. Sync Appointment Model
        const apptQuery = isObjectId ? { _id: targetId } : { transactionId: String(targetId).trim() };
        const appointment = await Appointment.findOne(apptQuery);
        if (appointment) {
            if (!appointment.tracking) appointment.tracking = {};
            appointment.tracking.status = 'Admitted/Dropped to Hospital';
            appointment.tracking.rideEndTime = new Date();
            await appointment.save();
        }

        // Release Driver back to Available
        await Ambulance.findByIdAndUpdate(driverId, { 
            $set: { availableForEmergency: true, isOnline: true } 
        });

        res.json({ 
            success: true, 
            message: "Handover successful. Ambulance is now free and available for next trip.",
            data: booking || appointment 
        });
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
        const { lat, lng, bookingId } = req.body;
        const driverId = req.user.id;

        if (lat === undefined || lng === undefined) {
            return res.status(400).json({ success: false, message: "Latitude and Longitude are required." });
        }

        const numericLat = Number(lat);
        const numericLng = Number(lng);

        // A. Update global position in Ambulance Fleet Model
        await Ambulance.findByIdAndUpdate(driverId, {
            $set: { location: { lat: numericLat, lng: numericLng } }
        });

        // B. Update trip-specific position in AmbulanceBooking
        if (bookingId) {
            const isObjectId = mongoose.isValidObjectId(bookingId);
            const query = isObjectId ? { _id: bookingId } : { bookingId: String(bookingId).trim() };

            await Booking.findOneAndUpdate(query, {
                $set: {
                    'pickupLocation.lat': numericLat,
                    'pickupLocation.lng': numericLng
                }
            });

            // Also update linked hospital admission live coordinates
            await Appointment.findOneAndUpdate(
                { transactionId: bookingId },
                {
                    $set: {
                        'tracking.liveLocation': {
                            lat: numericLat,
                            lng: numericLng,
                            lastUpdated: new Date()
                        }
                    }
                }
            );
        }

        res.json({ success: true, message: "Real-time GPS location synced with fleet and patient." });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- 4. CHANGE JOURNEY STATUS (Screenshot 37 Timeline) ---
const updateJourneyStatus = async (req, res) => {
    try {
        const { appointmentId, journeyStatus, eta } = req.body;

        if (!appointmentId || !journeyStatus) {
            return res.status(400).json({ success: false, message: "appointmentId and journeyStatus are required." });
        }

        const update = {
            'tracking.status': journeyStatus,
            'tracking.eta': eta || "10 mins"
        };

        if (journeyStatus === 'Admitted/Dropped to Hospital') {
            update.status = 'In-Progress';
        }

        const appointment = await Appointment.findByIdAndUpdate(appointmentId, { $set: update }, { new: true });
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment record not found." });
        }

        res.json({ success: true, message: `Timeline updated to: ${journeyStatus}`, data: appointment });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

module.exports = { startAmbulanceRide, completeAmbulanceRide, updateAmbulanceGPS, updateJourneyStatus };