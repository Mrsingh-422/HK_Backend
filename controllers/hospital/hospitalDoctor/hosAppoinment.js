// controllers/hospital/hospitalDoctor/hosAppoinment.js

const Appointment = require('../../../models/Appointment');
const Ward = require('../../../models/Ward');
const Bed = require('../../../models/Bed');
const Doctor = require('../../../models/Doctor');
const User = require('../../../models/User'); 
const Coupon = require('../../../models/Coupon'); // Top-level import added
const mongoose = require('mongoose');
const moment = require('moment'); // Top-level import added for date filtering
const { refundBenefitCount } = require('../../../utils/subscriptionBenefitHelper'); // Top-level import added
const { sendPushNotification } = require('../../../utils/notification'); // Top-level import added

// @desc    Get All Hospital Bookings with OPD / IPD / Triage Filters & Smart Sorting
// @route   GET /hospital/doctor/appointments/all-bookings
// @access  Private (Hospital)
const getHospitalAllBookings = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { status, bookingType, triageLevel, date, search, page = 1, limit = 20 } = req.query; 

        let query = { hospitalId };

        if (status && status !== 'All') query.status = status;
        if (bookingType && bookingType !== 'All') query.bookingType = bookingType;
        if (triageLevel && triageLevel !== 'All') query.triageLevel = triageLevel;

        // Safely parse date boundaries
        if (date && date.trim() !== '') {
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

        // Smart sorting: OPD queues sort strictly ascending by tokenNumber, while general lists sort by newest
        const sortCriteria = (bookingType === 'OPD') ? { tokenNumber: 1, createdAt: -1 } : { createdAt: -1 };

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
            .sort(sortCriteria)
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

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

// @desc    Hospital Admin Approves Booking (Reserves Bed for IPD / Assigns Cabin & Token for OPD)
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

            if (appointment.userId) {
                try {
                    await sendPushNotification(
                        appointment.userId,
                        'user',
                        "Admission Confirmed!",
                        `Your IPD admission booking #${appointment.bookingId} has been confirmed. Bed is reserved for your arrival.`,
                        { appointmentId: appointment._id.toString(), type: 'admission_confirmed' }
                    );
                } catch (e) {}
            }

            await appointment.save();

            return res.status(200).json({ 
                success: true, 
                message: "IPD Admission Confirmed, Bed Reserved, and Patient Notified.", 
                data: appointment 
            });
        }

        // 2. OPD CONSULTATION LOGIC
        if (appointment.bookingType === 'OPD') {
            const assignedDoctorId = doctorId || appointment.doctorId;

            if (assignedDoctorId) {
                appointment.doctorId = assignedDoctorId;
                // Fetch Doctor to auto-map Cabin Room Number
                const docData = await Doctor.findById(assignedDoctorId).select('department');
                if (docData && docData.department?.roomNumber) {
                    appointment.opdRoomNumber = docData.department.roomNumber;
                }
            }

            // Ensure Token Number exists for this day if not yet assigned
            if (!appointment.tokenNumber) {
                const targetDate = appointment.appointmentDate || now;
                const startOfDay = moment(targetDate).startOf('day').toDate();
                const endOfDay = moment(targetDate).endOf('day').toDate();

                const dailyCount = await Appointment.countDocuments({
                    hospitalId,
                    doctorId: appointment.doctorId,
                    appointmentDate: { $gte: startOfDay, $lte: endOfDay },
                    bookingType: 'OPD',
                    tokenNumber: { $ne: null }
                });
                appointment.tokenNumber = dailyCount + 1;
            }

            await appointment.save();

            // Alert Patient with accurate Cabin Room Number and Token
            if (appointment.userId) {
                try {
                    const cabinInfo = appointment.opdRoomNumber ? `Cabin: ${appointment.opdRoomNumber}` : "OPD Waiting Lounge";
                    await sendPushNotification(
                        appointment.userId,
                        'user',
                        `OPD Confirmed! (Token #${appointment.tokenNumber})`,
                        `Your OPD consultation #${appointment.bookingId} is confirmed for ${appointment.appointmentTime}. Please proceed to ${cabinInfo}.`,
                        { appointmentId: appointment._id.toString(), type: 'opd_confirmed', tokenNumber: String(appointment.tokenNumber) }
                    );
                } catch (e) {}
            }

            return res.status(200).json({ 
                success: true, 
                message: `OPD Appointment Confirmed! Token #${appointment.tokenNumber} assigned at ${appointment.opdRoomNumber || 'Cabin'}.`, 
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

// @desc    Hospital Rejects / Cancels Booking (Distinguishes Online Gateway vs Counter Cash Refunds)
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

        // Check if payment was cash at counter vs online gateway
        const isCounterCash = appointment.paymentMethod === 'Cash' || (appointment.paymentDetails?.razorpayPaymentId || '').startsWith('COUNTER-REC-');
        
        let refundInstruction = "Full online refund initiated.";
        if (appointment.paymentStatus === 'Paid') {
            if (isCounterCash) {
                appointment.paymentStatus = 'Refunded'; // Cash returned at physical desk
                refundInstruction = "Please collect your refund from the Hospital Cash Counter.";
            } else if (appointment.paymentMethod !== 'COD') {
                appointment.paymentStatus = 'Refund-Initiated'; // Online gateway queue
            }
        } else {
            appointment.paymentStatus = 'Failed';
            refundInstruction = "No payment had been collected.";
        }

        appointment.cancellationDetails = {
            cancelledBy: hospitalId,
            reason: `${rejectReason} (${refundInstruction})`,
            cancelledAt: new Date()
        };

        // IPD Bed Release
        if (!isOPD && appointment.bedId) {
            const bed = await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Available' } });
            if (bed && bed.wardId) {
                await Ward.findByIdAndUpdate(bed.wardId, { $inc: { availableBeds: 1 } });
            }
        }

        // Rollback Subscription Benefit if applied
        if (appointment.subscriptionDetails?.isSubscriptionApplied && appointment.userId) {
            const benefitField = isOPD ? 'freeDoctorAppointmentsCount' : 'freeHospitalStaysCount';
            await refundBenefitCount(appointment.userId._id, benefitField);
        }

        // Rollback Coupon Usage Count if applied
        if (appointment.couponDetails?.couponId && appointment.userId) {
            await Coupon.updateOne(
                { _id: appointment.couponDetails.couponId, "usedBy.userId": appointment.userId._id },
                { $inc: { "usedBy.$.usageCount": -1 } }
            );
        }

        await appointment.save();

        // Push Notification to Patient
        if (appointment.userId) {
            try {
                const notifTitle = isOPD ? "OPD Appointment Cancelled by Hospital" : "Hospital Admission Declined";
                const notifBody = isOPD
                    ? `Your OPD consultation #${appointment.bookingId} (Token #${appointment.tokenNumber || 'N/A'}) was cancelled. Reason: "${rejectReason}". ${refundInstruction}`
                    : `Your hospital bed admission #${appointment.bookingId} was declined. Reason: "${rejectReason}".`;

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
            message: `${appointment.bookingType} booking rejected successfully. ${refundInstruction}`,
            refundInstruction,
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

// @desc    Hospital Reception Desk Marks OPD Fees as Paid (Safe normalization of payment keys)
// @route   PATCH /hospital/doctor/appointments/collect-payment/:id
// @access  Private (Hospital Admin)
const collectHospitalOpdCounterPayment = async (req, res) => {
    try {
        const { id } = req.params;
        const hospitalId = req.user.id;
        // Accept either paymentMode or paymentMethod from frontend safely
        const rawPaymentMode = req.body.paymentMode || req.body.paymentMethod || 'Cash';
        const { remarks, transactionReference } = req.body;

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

        // Standardize payment method capitalization
        const cleanPaymentMode = String(rawPaymentMode).charAt(0).toUpperCase() + String(rawPaymentMode).slice(1).toLowerCase();

        appointment.paymentStatus = 'Paid';
        appointment.paymentMethod = cleanPaymentMode;
        appointment.status = 'Confirmed';
        appointment.paymentDetails = {
            method: cleanPaymentMode,
            amount: appointment.totalAmount,
            currency: 'INR',
            status: 'captured',
            paidAt: new Date(),
            bank: remarks || "Hospital Reception Desk Collection",
            razorpayPaymentId: transactionReference || `COUNTER-REC-${Date.now().toString().slice(-6)}`
        };

        await appointment.save();

        // Notify Doctor in cabin that patient has paid at counter and is in the waiting queue
        if (appointment.doctorId) {
            try {
                await sendPushNotification(
                    appointment.doctorId._id,
                    'doctor',
                    `Patient Paid at Counter! (Token #${appointment.tokenNumber || '1'})`,
                    `Patient ${appointment.patients[0]?.patientName} paid OPD fee at reception. Waiting outside cabin.`,
                    { appointmentId: appointment._id.toString(), type: 'opd_patient_paid_counter', tokenNumber: String(appointment.tokenNumber || '1') }
                );
            } catch (e) {}
        }

        res.status(200).json({
            success: true,
            message: `Payment of ₹${appointment.totalAmount} recorded successfully via ${cleanPaymentMode}. Token #${appointment.tokenNumber} is ready for consultation.`,
            tokenNumber: appointment.tokenNumber,
            data: appointment
        });

    } catch (error) {
        console.error("Collect OPD Counter Payment Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    OPD Triage Nurse / Reception Records Pre-Consultation Vitals (BP, Pulse, Temp, SpO2 strictly matching schema)
// @route   PATCH /hospital/doctor/appointments/opd-vitals/:id
// @access  Private (Hospital Admin or Hospital Doctor)
const recordOpdPatientVitals = async (req, res) => {
    try {
        const { id } = req.params;
        const hospitalId = req.user.id;
        const { bp, pulse, temp, spo2, notes } = req.body;

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

        // Strictly capture only the 4 fields configured in Appointment schema vitals
        const recordedVitals = {
            bp: bp ? String(bp).trim() : (appointment.clinicalSummary?.vitals?.bp || ""),
            pulse: pulse ? String(pulse).trim() : (appointment.clinicalSummary?.vitals?.pulse || ""),
            temp: temp ? String(temp).trim() : (appointment.clinicalSummary?.vitals?.temp || ""),
            spo2: spo2 ? String(spo2).trim() : (appointment.clinicalSummary?.vitals?.spo2 || "")
        };

        if (!appointment.clinicalSummary) appointment.clinicalSummary = {};
        appointment.clinicalSummary.vitals = recordedVitals;
        
        if (notes && notes.trim() !== "") {
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

// @desc    Hospital Reception Desk Collects Admission Deposit (Cash/Card/UPI) & Locks Bed Permanently
// @route   PATCH /hospital/doctor/appointments/admission/collect-payment/:id
// @access  Private (Hospital Admin / Reception)
const collectAdmissionCounterPayment = async (req, res) => {
    try {
        const { id } = req.params;
        const hospitalId = req.user.id;
        const rawPaymentMode = req.body.paymentMode || req.body.paymentMethod || 'Cash';
        const { transactionReference, remarks } = req.body;

        const isObjectId = mongoose.isValidObjectId(id);
        const query = {
            hospitalId,
            bookingType: 'Admission', // Strictly operates on Bed Admission bookings
            ...(isObjectId ? { _id: id } : { bookingId: String(id).trim() })
        };

        const appointment = await Appointment.findOne(query)
            .populate('userId', 'name phone fcmToken')
            .populate('doctorId', 'name speciality department');

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Bed admission record not found." });
        }

        if (appointment.paymentStatus === 'Paid') {
            return res.status(400).json({ success: false, message: "Deposit for this bed is already paid." });
        }

        const now = new Date();

        // 1. Verify 30-Minute Hold Window
        if (appointment.admissionHoldExpiresAt && now > new Date(appointment.admissionHoldExpiresAt)) {
            if (appointment.bedId) {
                await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Available' } });
            }
            appointment.status = 'Cancelled-By-Hospital';
            appointment.cancellationDetails = {
                reason: "30-Minute admission deposit window expired. Bed was released.",
                cancelledAt: now
            };
            await appointment.save();

            return res.status(400).json({
                success: false,
                isExpired: true,
                message: "The 30-minute hold window for this bed has expired. Bed was released. Please ask doctor to re-assign a bed."
            });
        }

        // 2. Lock Bed to Occupied
        const bed = await Bed.findById(appointment.bedId);
        if (!bed) {
            return res.status(404).json({ success: false, message: "Assigned bed record not found." });
        }

        bed.status = 'Occupied';
        await bed.save();

        if (bed.wardId) {
            await Ward.findByIdAndUpdate(bed.wardId, { $inc: { availableBeds: -1 } });
        }

        // 3. Mark Payment Captured
        const cleanPaymentMode = String(rawPaymentMode).charAt(0).toUpperCase() + String(rawPaymentMode).slice(1).toLowerCase();

        appointment.paymentStatus = 'Paid';
        appointment.paymentMethod = cleanPaymentMode;
        appointment.status = 'In-Progress'; // Patient is now actively admitted
        appointment.admissionHoldExpiresAt = null; // Clear hold timer

        appointment.paymentDetails = {
            method: cleanPaymentMode,
            amount: appointment.totalAmount,
            currency: 'INR',
            status: 'captured',
            paidAt: now,
            bank: remarks || "Hospital In-Patient Cash/POS Counter",
            razorpayPaymentId: transactionReference || `COUNTER-ADM-${Date.now().toString().slice(-6)}`
        };

        await appointment.save();

        // 4. Alert Patient
        if (appointment.userId) {
            try {
                await sendPushNotification(
                    appointment.userId._id,
                    'user',
                    "Admission Confirmed! 🏥",
                    `Payment of ₹${appointment.totalAmount} received via ${cleanPaymentMode}. Bed ${appointment.bedNumber} (${appointment.wardName}) is now occupied.`,
                    { appointmentId: appointment._id.toString(), type: 'admission_confirmed' }
                );
            } catch (e) {}
        }

        res.status(200).json({
            success: true,
            message: `Bed Admission confirmed! Deposit of ₹${appointment.totalAmount} collected via ${cleanPaymentMode}. Bed ${appointment.bedNumber} is Occupied.`,
            bookingId: appointment.bookingId,
            bedNumber: appointment.bedNumber,
            wardName: appointment.wardName,
            paymentMode: cleanPaymentMode,
            data: appointment
        });

    } catch (error) {
        console.error("Collect Admission Counter Payment Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get All Doctor-Initiated Bed Admissions Pending Deposit Payment (Shows 30-min live hold timer)
// @route   GET /hospital/doctor/appointments/admissions/pending-holds
// @access  Private (Hospital Admin / Reception)
const getHospitalPendingAdmissionHolds = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const now = new Date();

        // 1. Lazy Release: Auto-release any bed holds where 30 minutes expired before querying
        const expiredHolds = await Appointment.find({
            hospitalId,
            bookingType: 'Admission',
            status: 'Hospital-Pending',
            paymentStatus: 'Pending',
            admissionHoldExpiresAt: { $lt: now, $ne: null },
            bedId: { $ne: null }
        });

        for (let exp of expiredHolds) {
            await Bed.findByIdAndUpdate(exp.bedId, { $set: { status: 'Available' } });
            exp.admissionHoldExpiresAt = null;
            exp.status = 'Cancelled-By-Hospital';
            exp.cancellationDetails = {
                reason: "30-Minute admission deposit window expired. Bed released automatically.",
                cancelledAt: now
            };
            await exp.save();
        }

        // 2. Fetch all active holds within the 30-minute window
        const pendingHolds = await Appointment.find({
            hospitalId,
            bookingType: 'Admission',
            status: 'Hospital-Pending',
            paymentStatus: 'Pending',
            admissionHoldExpiresAt: { $gt: now }
        })
        .populate('userId', 'name phone email profilePic age gender')
        .populate('doctorId', 'name speciality department profileImage')
        .populate({
            path: 'bedId',
            select: 'bedNumber pricePerDay isVentilatorAvailable wardId',
            populate: { path: 'wardId', select: 'name type' }
        })
        .populate('opdAppointmentId', 'bookingId tokenNumber appointmentDate') // Cross-link to parent OPD
        .sort({ admissionHoldExpiresAt: 1 }) // Urgency first (lowest time remaining at top)
        .lean();

        const formattedData = pendingHolds.map(item => {
            const holdDeadline = new Date(item.admissionHoldExpiresAt);
            const remainingMs = Math.max(0, holdDeadline.getTime() - now.getTime());
            const remainingSeconds = Math.floor(remainingMs / 1000);

            return {
                admissionAppointmentId: item._id,
                admissionBookingId: item.bookingId,
                parentOpdBooking: item.opdAppointmentId ? {
                    opdBookingId: item.opdAppointmentId.bookingId,
                    tokenNumber: item.opdAppointmentId.tokenNumber
                } : null,
                patient: {
                    name: item.patients?.[0]?.patientName || item.userId?.name || "Patient",
                    phone: item.userId?.phone || "N/A",
                    age: item.patients?.[0]?.patientAge || item.userId?.age || 30,
                    gender: item.patients?.[0]?.gender || item.userId?.gender || "Male"
                },
                doctor: {
                    doctorId: item.doctorId?._id,
                    name: item.doctorId?.name || "Doctor",
                    speciality: item.doctorId?.speciality || "Specialist",
                    cabinRoom: item.doctorId?.department?.roomNumber || "Cabin"
                },
                wardName: item.wardName || item.bedId?.wardId?.name,
                bedNumber: item.bedNumber || item.bedId?.bedNumber,
                bedId: item.bedId?._id,
                isVentilatorAvailable: item.bedId?.isVentilatorAvailable || false,
                depositPayable: item.totalAmount || item.pricingBreakdown?.depositPaidOnBooking || 1000,
                stayDays: item.stayDuration || 1,
                triageLevel: item.triageLevel || "Emergency",
                bookingReason: item.bookingReason || "Admitted from OPD consultation",
                holdExpiresAt: item.admissionHoldExpiresAt,
                remainingSeconds: remainingSeconds,
                formattedRemainingTime: `${Math.floor(remainingSeconds / 60)}m ${remainingSeconds % 60}s`,
                vitalsAtAdmission: item.clinicalSummary?.vitals || null
            };
        });

        res.status(200).json({
            success: true,
            count: formattedData.length,
            message: "Pending admission holds fetched successfully.",
            data: formattedData
        });

    } catch (error) {
        console.error("Get Pending Admission Holds Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Hospital Receptionist Switches Held Bed Before Payment (Releases old bed, locks new bed & recalculates deposit)
// @route   PATCH /hospital/doctor/appointments/admission/switch-bed/:id
// @access  Private (Hospital Admin / Reception)
const switchAdmissionHeldBedAtCounter = async (req, res) => {
    try {
        const { id } = req.params;
        const hospitalId = req.user.id;
        const { newBedId } = req.body;

        if (!newBedId) {
            return res.status(400).json({ success: false, message: "newBedId parameter is required." });
        }

        const isObjectId = mongoose.isValidObjectId(id);
        const query = {
            hospitalId,
            bookingType: 'Admission',
            ...(isObjectId ? { _id: id } : { bookingId: String(id).trim() })
        };

        const appointment = await Appointment.findOne(query).populate('userId', 'name phone fcmToken');
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Bed admission record not found." });
        }

        if (appointment.paymentStatus === 'Paid') {
            return res.status(400).json({ success: false, message: "Deposit is already paid for this bed. To transfer an occupied bed, use Bed Transfer API." });
        }

        const now = new Date();
        // Check if hold window already expired
        if (appointment.admissionHoldExpiresAt && now > new Date(appointment.admissionHoldExpiresAt)) {
            if (appointment.bedId) {
                await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Available' } });
            }
            appointment.status = 'Cancelled-By-Hospital';
            await appointment.save();

            return res.status(400).json({ success: false, message: "Hold has expired. Please ask doctor to re-initiate admission." });
        }

        // Verify new bed is available
        const newTargetBed = await Bed.findById(newBedId).populate('wardId');
        if (!newTargetBed || newTargetBed.status !== 'Available') {
            return res.status(400).json({ success: false, message: "Target bed is not available." });
        }

        // 1. Release previous held bed immediately back to Available pool
        if (appointment.bedId) {
            await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Available' } });
        }

        // 2. Lock new bed to Reserved
        newTargetBed.status = 'Reserved';
        await newTargetBed.save();

        const days = Number(appointment.stayDuration || 1);
        const newDeposit = Number(newTargetBed.pricePerDay || 1000) * days;
        const newWardTitle = newTargetBed.wardId?.name || "General Ward";

        // 3. Update appointment with new bed details and recalculated deposit
        appointment.bedId = newTargetBed._id;
        appointment.bedNumber = newTargetBed.bedNumber;
        appointment.wardName = newWardTitle;
        appointment.totalAmount = newDeposit;
        if (!appointment.pricingBreakdown) appointment.pricingBreakdown = {};
        appointment.pricingBreakdown.baseFee = newDeposit;
        appointment.pricingBreakdown.subtotal = newDeposit;
        appointment.pricingBreakdown.depositPaidOnBooking = newDeposit;

        await appointment.save();

        // 4. Alert Patient Mobile App with updated bed & new deposit
        if (appointment.userId) {
            try {
                await sendPushNotification(
                    appointment.userId._id,
                    'user',
                    "Bed Changed by Reception Desk",
                    `Your held bed has been updated to ${newWardTitle} (${newTargetBed.bedNumber}). New deposit payable: ₹${newDeposit}.`,
                    { appointmentId: appointment._id.toString(), type: 'admission_bed_switched', newDeposit: String(newDeposit) }
                );
            } catch (e) {}
        }

        res.status(200).json({
            success: true,
            message: `Bed successfully changed to ${newWardTitle} (${newTargetBed.bedNumber}). New deposit: ₹${newDeposit}.`,
            bookingId: appointment.bookingId,
            newBedNumber: newTargetBed.bedNumber,
            newWardName: newWardTitle,
            newDepositPayable: newDeposit,
            data: appointment
        });

    } catch (error) {
        console.error("Switch Admission Bed Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { 
    getHospitalAllBookings, approveHospitalBooking, rejectHospitalBooking, getHospitalStats, collectHospitalOpdCounterPayment, recordOpdPatientVitals,
    collectAdmissionCounterPayment,getHospitalPendingAdmissionHolds,switchAdmissionHeldBedAtCounter
};