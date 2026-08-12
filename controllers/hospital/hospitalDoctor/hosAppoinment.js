// controllers/hospital/hospitalDoctor/hosAppoinment.js

const Appointment = require('../../../models/Appointment');
const Ward = require('../../../models/Ward');
const Bed = require('../../../models/Bed');
const mongoose = require('mongoose');

// 1. GET ALL BOOKINGS
const getHospitalAllBookings = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { status, bookingType, triageLevel, page = 1, limit = 10 } = req.query; 

        let query = { hospitalId: hospitalId };

        if (status) query.status = status;
        if (bookingType) query.bookingType = bookingType;
        if (triageLevel) query.triageLevel = triageLevel;

        const appointments = await Appointment.find(query)
            .populate('doctorId', 'name speciality profileImage')
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay',
                populate: { path: 'wardId', select: 'name type' } 
            })
            .populate('userId', 'name phone email profilePic age gender')
            // 🚀 FIX: Populating bedsideCareTeam doctor profile info for counters desk
            .populate({
                path: 'bedsideCareTeam.doctorId',
                select: 'name speciality profileImage dutyStatus'
            })
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Appointment.countDocuments(query);

        res.json({ success: true, total, count: appointments.length, data: appointments });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. APPROVE & ASSIGN (Fixed: Bed status marked as 'Reserved' instead of premature 'Occupied')
const approveHospitalBooking = async (req, res) => {
    try {
        const { doctorId } = req.body; 
        const hospitalId = req.user.id;

        const appointment = await Appointment.findOne({ _id: req.params.id, hospitalId });
        if (!appointment) return res.status(404).json({ message: "Booking not found" });

        appointment.status = 'Confirmed'; // Awaiting physical arrival/admission
        if (doctorId) appointment.doctorId = doctorId;
        
        // FIX: Bed is reserved during approval, not occupied yet (Occupied will trigger at physical admission)
        if (appointment.bookingType === 'Admission' && appointment.bedId) {
             await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Reserved' } });
        }

        await appointment.save();
        res.json({ success: true, message: "Admission Confirmed & Bed Reserved", data: appointment });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. REJECT & RELEASE (Updated with automatic dispatched ambulance release)
const rejectHospitalBooking = async (req, res) => {
    try {
        const { reason } = req.body;
        const hospitalId = req.user.id;

        const appointment = await Appointment.findOne({ _id: req.params.id, hospitalId });
        if (!appointment) return res.status(404).json({ message: "Booking not found" });

        appointment.status = 'Cancelled-By-Hospital';
        appointment.paymentStatus = 'Refund-Initiated'; 
        appointment.cancellationDetails = {
            cancelledBy: hospitalId,
            reason: reason || "Hospital capacity full or medical mismatch",
            cancelledAt: new Date()
        };

        // 1. Release assigned physical Bed
        if (appointment.bedId) {
            const bed = await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Available' } });
            if (bed) {
                await Ward.findByIdAndUpdate(bed.wardId, { $inc: { availableBeds: 1 } });
            }
        }

        // 2. Auto-release assigned dispatched Ambulance and update Booking status
        if (appointment.ambulanceId) {
            const AmbulanceBooking = require('../../../models/AmbulanceBooking'); // Secure local load
            const Ambulance = require('../../../models/Ambulance');

            const activeBooking = await AmbulanceBooking.findOne({
                ambulanceId: appointment.ambulanceId,
                status: { $in: ['Searching', 'Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] }
            });

            if (activeBooking) {
                activeBooking.status = 'Cancelled';
                activeBooking.cancelledBy = 'System';
                activeBooking.cancellationReason = `Admission rejected by hospital: ${reason || 'Admission cancelled'}`;
                await activeBooking.save();
            }

            // Release driver back to available state
            await Ambulance.findByIdAndUpdate(appointment.ambulanceId, { 
                $set: { availableForEmergency: true } 
            });

            // Send push notification to Driver
            const { sendPushNotification } = require('../../../utils/notification');
            await sendPushNotification(
                appointment.ambulanceId,
                'driver',
                "Ride Cancelled by Hospital",
                "Hospital has rejected the admission. Your vehicle is released back to available state.",
                { type: 'booking_cancelled' }
            );
        }

        await appointment.save();
        res.json({ success: true, message: "Booking Rejected, Bed & Dispatched Ambulance Released successfully" });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 4. STATS (Fixed: Discharge counts track strictly clinically released 'Discharge-Pending' status)
const getHospitalStats = async (req, res) => {
    try {
        const hospitalId = req.user.id;

        const stats = await Appointment.aggregate([
            { $match: { hospitalId: new mongoose.Types.ObjectId(hospitalId) } },
            { $group: {
                _id: null,
                emergency: { $sum: { $cond: [{ $eq: ["$triageLevel", "Emergency"] }, 1, 0] } },
                admission: { $sum: { $cond: [{ $eq: ["$bookingType", "Admission"] }, 1, 0] } },
                discharge: { $sum: { $cond: [{ $eq: ["$status", "Discharge-Pending"] }, 1, 0] } } // 👈 FIXED
            }}
        ]);

        res.json({ success: true, data: stats[0] || { emergency: 0, admission: 0, discharge: 0 } });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { 
    getHospitalAllBookings, approveHospitalBooking, rejectHospitalBooking, getHospitalStats 
};