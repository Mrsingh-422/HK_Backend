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

// @desc    Hospital Rejects / Cancels Booking (Handles OPD vs IPD, Restores Benefits & Alerts Patient)
// @route   PATCH /hospital/doctor/appointments/reject/:id
// @access  Private (Hospital Admin)
const rejectHospitalBooking = async (req, res) => {
    try {
        const { reason } = req.body;
        const hospitalId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(req.params.id);
        const query = {
            hospitalId,
            ...(isObjectId ? { _id: req.params.id } : { bookingId: String(req.params.id).trim() })
        };

        const appointment = await Appointment.findOne(query).populate('userId', 'name phone fcmToken');
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Booking record not found or access denied." });
        }

        const isOPD = appointment.bookingType === 'OPD';
        const rejectReason = reason || (isOPD ? "Doctor unavailable / OPD clinic closed" : "Hospital capacity full or medical mismatch");

        appointment.status = 'Cancelled-By-Hospital';
        appointment.cancellationDetails = {
            cancelledBy: hospitalId,
            reason: rejectReason,
            cancelledAt: new Date()
        };

        // 1. Payment Refund Queueing (Only if online paid)
        if (appointment.paymentStatus === 'Paid' && appointment.paymentMethod !== 'COD') {
            appointment.paymentStatus = 'Refund-Initiated';
        } else {
            appointment.paymentStatus = 'Failed';
        }

        // 2. IPD Bed Release (If IPD admission had a bed reserved)
        if (!isOPD && appointment.bedId) {
            const bed = await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Available' } });
            if (bed && bed.wardId) {
                await Ward.findByIdAndUpdate(bed.wardId, { $inc: { availableBeds: 1 } });
            }
        }

        // 3. Rollback Subscription Benefit if applied
        if (appointment.subscriptionDetails?.isSubscriptionApplied) {
            const benefitField = isOPD ? 'freeDoctorAppointmentsCount' : 'freeHospitalStaysCount';
            await refundBenefitCount(appointment.userId._id, benefitField);
        }

        // 4. Rollback Coupon Usage Count if applied
        if (appointment.couponDetails?.couponId) {
            await Coupon.updateOne(
                { _id: appointment.couponDetails.couponId, "usedBy.userId": appointment.userId._id },
                { $inc: { "usedBy.$.usageCount": -1 } }
            );
        }

        // 5. Release Ambulance if attached
        if (appointment.ambulanceId) {
            const AmbulanceBooking = require('../../../models/AmbulanceBooking');
            const Ambulance = require('../../../models/Ambulance');

            await AmbulanceBooking.findOneAndUpdate(
                { ambulanceId: appointment.ambulanceId, status: { $in: ['Searching', 'Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] } },
                { $set: { status: 'Cancelled', cancellationReason: `Admission rejected by hospital: ${rejectReason}` } }
            );

            await Ambulance.findByIdAndUpdate(appointment.ambulanceId, { 
                $set: { availableForEmergency: true, isOnline: true } 
            });
        }

        await appointment.save();

        // 6. Push Notification to Patient (Mandatory)
        if (appointment.userId) {
            try {
                const notifTitle = isOPD ? "OPD Appointment Cancelled by Hospital" : "Hospital Admission Declined";
                const notifBody = isOPD
                    ? `Your OPD consultation #${appointment.bookingId} (Token #${appointment.tokenNumber || 'N/A'}) was cancelled by hospital. Reason: "${rejectReason}". Any online payment has been initiated for refund.`
                    : `Your hospital bed admission #${appointment.bookingId} was declined. Reason: "${rejectReason}". Full refund initiated.`;

                await sendPushNotification(
                    appointment.userId._id,
                    'user',
                    notifTitle,
                    notifBody,
                    { appointmentId: appointment._id.toString(), type: 'hospital_booking_rejected' }
                );
            } catch (e) {}
        }

        res.status(200).json({ 
            success: true, 
            message: `${appointment.bookingType} booking rejected successfully. Patient notified and benefits restored.`,
            data: appointment 
        });

    } catch (error) { 
        console.error("Reject Hospital Booking Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
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

// @desc    Hospital Reception Desk Marks OPD Fees as Paid (Collects Cash, Card, or POS at Counter)
// @route   PATCH /hospital/doctor/appointments/collect-payment/:id
// @access  Private (Hospital Admin)
const collectHospitalOpdCounterPayment = async (req, res) => {
    try {
        const { id } = req.params;
        const hospitalId = req.user.id;
        const { paymentMode = 'Cash', remarks, transactionReference } = req.body; // paymentMode: 'Cash' | 'Card' | 'UPI'

        const isObjectId = mongoose.isValidObjectId(id);
        const query = {
            hospitalId,
            bookingType: 'OPD',
            ...(isObjectId ? { _id: id } : { bookingId: String(id).trim() })
        };

        const appointment = await Appointment.findOne(query).populate('doctorId', 'name speciality');
        if (!appointment) {
            return res.status(404).json({ success: false, message: "OPD Appointment record not found in this hospital." });
        }

        if (appointment.paymentStatus === 'Paid') {
            return res.status(400).json({ success: false, message: "Payment for this appointment is already marked as Paid." });
        }

        // Mark payment captured at hospital counter
        appointment.paymentStatus = 'Paid';
        appointment.paymentMethod = paymentMode;
        appointment.status = 'Confirmed'; // Automatically confirmed upon counter payment
        appointment.paymentDetails = {
            method: paymentMode,
            amount: appointment.totalAmount,
            currency: 'INR',
            status: 'captured',
            paidAt: new Date(),
            bank: remarks || "Hospital Reception Desk Collection",
            razorpayPaymentId: transactionReference || `COUNTER-REC-${Date.now().toString().slice(-6)}`
        };

        await appointment.save();

        // Notify Doctor in cabin that patient has paid at counter and is entering waiting lounge
        if (appointment.doctorId) {
            try {
                await sendPushNotification(
                    appointment.doctorId._id,
                    'doctor',
                    `Patient Paid at Counter! (Token #${appointment.tokenNumber || '1'})`,
                    `Patient ${appointment.patients[0]?.patientName} paid OPD fee at reception. Waiting outside cabin.`,
                    { appointmentId: appointment._id.toString(), type: 'opd_patient_paid_counter', tokenNumber: appointment.tokenNumber }
                );
            } catch (e) {}
        }

        res.status(200).json({
            success: true,
            message: `Payment of ₹${appointment.totalAmount} recorded successfully via ${paymentMode}. Token #${appointment.tokenNumber} is ready for consultation.`,
            tokenNumber: appointment.tokenNumber,
            data: appointment
        });

    } catch (error) {
        console.error("Collect OPD Counter Payment Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    OPD Triage Nurse / Reception Records Pre-Consultation Vitals (BP, Pulse, Temp, SpO2, Weight)
// @route   PATCH /hospital/doctor/appointments/opd-vitals/:id
// @access  Private (Hospital Admin or Hospital Doctor)
const recordOpdPatientVitals = async (req, res) => {
    try {
        const { id } = req.params;
        const hospitalId = req.user.id;
        const { bp, pulse, temp, spo2, weight, notes } = req.body;

        const isObjectId = mongoose.isValidObjectId(id);
        const query = {
            ...(req.user.role === 'hospital' ? { hospitalId } : { doctorId: req.user.id }),
            bookingType: 'OPD',
            ...(isObjectId ? { _id: id } : { bookingId: String(id).trim() })
        };

        const appointment = await Appointment.findOne(query).populate('doctorId', 'name speciality');
        if (!appointment) {
            return res.status(404).json({ success: false, message: "OPD Appointment record not found." });
        }

        const recordedVitals = {
            bp: bp ? String(bp).trim() : (appointment.clinicalSummary?.vitals?.bp || ""),
            pulse: pulse ? String(pulse).trim() : (appointment.clinicalSummary?.vitals?.pulse || ""),
            temp: temp ? String(temp).trim() : (appointment.clinicalSummary?.vitals?.temp || ""),
            spo2: spo2 ? String(spo2).trim() : (appointment.clinicalSummary?.vitals?.spo2 || ""),
            weight: weight ? String(weight).trim() : (appointment.clinicalSummary?.vitals?.weight || "")
        };

        if (!appointment.clinicalSummary) appointment.clinicalSummary = {};
        appointment.clinicalSummary.vitals = recordedVitals;
        if (notes) {
            appointment.clinicalSummary.admissionNote = `[Triage Vitals Log]: ${notes.trim()}`;
        }

        await appointment.save();

        res.status(200).json({
            success: true,
            message: `Vitals recorded successfully for Token #${appointment.tokenNumber || '1'}. Available live in doctor's cabin.`,
            tokenNumber: appointment.tokenNumber,
            vitals: recordedVitals,
            data: appointment
        });

    } catch (error) {
        console.error("Record OPD Patient Vitals Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { 
    getHospitalAllBookings, approveHospitalBooking, rejectHospitalBooking, getHospitalStats, collectHospitalOpdCounterPayment, recordOpdPatientVitals
};