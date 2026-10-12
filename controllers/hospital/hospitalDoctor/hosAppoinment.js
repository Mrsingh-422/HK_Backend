// controllers/hospital/hospitalDoctor/hosAppoinment.js

const Appointment = require('../../../models/Appointment');
const Ward = require('../../../models/Ward');
const Bed = require('../../../models/Bed');
const mongoose = require('mongoose');

// @desc    Get All Hospital Bookings with OPD / IPD / Triage Filters & Search
// @route   GET /hospital/doctor/appointments/all-bookings
// @access  Private (Hospital)
const getHospitalAllBookings = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { status, bookingType, triageLevel, date, search, page = 1, limit = 20 } = req.query; 

        let query = { hospitalId };

        if (status && status !== 'All') query.status = status;
        if (bookingType && bookingType !== 'All') query.bookingType = bookingType; // 👈 'OPD' vs 'Admission'
        if (triageLevel && triageLevel !== 'All') query.triageLevel = triageLevel;

        if (date) {
            query.appointmentDate = {
                $gte: moment(date).startOf('day').toDate(),
                $lte: moment(date).endOf('day').toDate()
            };
        }

        if (search && search.trim() !== '') {
            query.$or = [
                { bookingId: { $regex: search.trim(), $options: 'i' } },
                { 'patients.patientName': { $regex: search.trim(), $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await Appointment.countDocuments(query);

        const appointments = await Appointment.find(query)
            .populate('doctorId', 'name speciality profileImage fees department')
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay',
                populate: { path: 'wardId', select: 'name type' } 
            })
            .populate('userId', 'name phone email profilePic age gender')
            .populate({
                path: 'bedsideCareTeam.doctorId',
                select: 'name speciality profileImage dutyStatus'
            })
            .sort({ tokenNumber: 1, createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        // Enriched mapping with clear OPD Token badges
        const formatted = appointments.map(a => ({
            ...a,
            isOpd: a.bookingType === 'OPD',
            isIpd: a.bookingType === 'Admission',
            displaySubtitle: a.bookingType === 'OPD' 
                ? `OPD Token #${a.tokenNumber || 'N/A'} - Dr. ${a.doctorId?.name || 'Doctor'}`
                : `Bed: ${a.bedNumber || 'Unassigned'} (${a.wardName || 'Ward'})`
        }));

        res.status(200).json({ 
            success: true, 
            total, 
            count: formatted.length, 
            pagination: {
                totalCount: total,
                totalPages: Math.ceil(total / parseInt(limit)),
                currentPage: parseInt(page),
                limit: parseInt(limit)
            },
            data: formatted 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// @desc    Hospital Admin Approves Booking (Reserves Bed for IPD / Assigns Token for OPD)
// @route   PATCH /hospital/doctor/appointments/approve/:id
// @access  Private (Hospital Admin)
const approveHospitalBooking = async (req, res) => {
    try {
        const { doctorId } = req.body; 
        const hospitalId = req.user.id;

        const appointment = await Appointment.findOne({ _id: req.params.id, hospitalId });
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        appointment.status = 'Confirmed';
        const now = new Date();

        // 1. IPD ADMISSION LOGIC
        if (appointment.bookingType === 'Admission') {
            if (doctorId) {
                appointment.doctorId = doctorId;
                appointment.treatmentHistory.push({
                    toDoctorId: doctorId,
                    action: 'Initial-Assignment',
                    notes: "Attending doctor assigned on hospital admission approval.",
                    timestamp: now,
                    startTime: now
                });
            }
            if (appointment.bedId) {
                await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Reserved' } });
            }

            // Alert Patient
            await sendPushNotification(
                appointment.userId,
                'user',
                "🏥 Admission Confirmed!",
                `Your IPD admission booking #${appointment.bookingId} has been confirmed. Bed is reserved for your arrival.`,
                { appointmentId: appointment._id.toString(), type: 'admission_confirmed' }
            );

            await appointment.save();

            return res.status(200).json({ 
                success: true, 
                message: "IPD Admission Confirmed, Bed Reserved, and Patient Notified.", 
                data: appointment 
            });
        }

        // 2. OPD CONSULTATION LOGIC
        if (appointment.bookingType === 'OPD') {
            if (doctorId) {
                appointment.doctorId = doctorId;
            }

            await appointment.save();

            // Alert Patient with Token Number & Room
            await sendPushNotification(
                appointment.userId,
                'user',
                `OPD Appointment Confirmed! (Token #${appointment.tokenNumber || '1'})`,
                `Your OPD consultation #${appointment.bookingId} is confirmed for ${appointment.appointmentTime}. Please proceed to ${appointment.opdRoomNumber || 'OPD Cabin'}.`,
                { appointmentId: appointment._id.toString(), type: 'opd_confirmed', tokenNumber: appointment.tokenNumber }
            );

            return res.status(200).json({ 
                success: true, 
                message: `OPD Appointment Confirmed! Token #${appointment.tokenNumber || '1'} generated and patient notified.`, 
                data: appointment 
            });
        }

        await appointment.save();
        res.status(200).json({ success: true, message: "Booking confirmed successfully.", data: appointment });

    } catch (error) { 
        console.error("Approve Booking Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
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

// @desc    Get Hospital Dashboard Counters (Counts Emergency, IPD Admission & OPD Consultations)
// @route   GET /hospital/doctor/appointments/stats
// @access  Private (Hospital)
const getHospitalStats = async (req, res) => {
    try {
        const hospitalId = req.user.id;

        const stats = await Appointment.aggregate([
            { $match: { hospitalId: new mongoose.Types.ObjectId(hospitalId) } },
            { $group: {
                _id: null,
                emergency: { $sum: { $cond: [{ $eq: ["$triageLevel", "Emergency"] }, 1, 0] } },
                admission: { $sum: { $cond: [{ $eq: ["$bookingType", "Admission"] }, 1, 0] } },
                opd: { $sum: { $cond: [{ $eq: ["$bookingType", "OPD"] }, 1, 0] } }, // 👈 Added OPD counter
                discharge: { $sum: { $cond: [{ $eq: ["$status", "Discharge-Pending"] }, 1, 0] } }
            }}
        ]);

        res.status(200).json({ 
            success: true, 
            data: stats[0] || { emergency: 0, admission: 0, opd: 0, discharge: 0 } 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

module.exports = { 
    getHospitalAllBookings, approveHospitalBooking, rejectHospitalBooking, getHospitalStats 
};