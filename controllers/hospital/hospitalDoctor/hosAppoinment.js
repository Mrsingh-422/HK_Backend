// controllers/hospital/hospitalDoctor/hosAppoinment.js
const Appointment = require('../../../models/Appointment');
const Ward = require('../../../models/Ward');
const Bed = require('../../../models/Bed');
const Doctor = require('../../../models/Doctor');
const User = require('../../../models/User'); 
const Coupon = require('../../../models/Coupon');
const Insurance = require('../../../models/Insurance'); // Top-level model import
const mongoose = require('mongoose');
const moment = require('moment');
const { refundBenefitCount } = require('../../../utils/subscriptionBenefitHelper');
const { sendPushNotification } = require('../../../utils/notification');
const { syncHospitalWardAndBedCapacity } = require('../../../utils/helpers');

// @desc    OPD Triage Nurse / Reception Records Pre-Consultation Vitals (Strictly 4 standard vitals)
// @route   PATCH /hospital/doctor/appointments/opd-vitals/:id OR PATCH /hospital-doctor/panel/opd/vitals/:id
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

        return res.status(200).json({
            success: true,
            message: `Vitals recorded successfully for Token #${appointment.tokenNumber || '1'}.`,
            tokenNumber: appointment.tokenNumber,
            vitals: recordedVitals,
            data: appointment
        });

    } catch (error) {
        console.error("Record OPD Patient Vitals Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get All Doctor-Initiated Bed Admissions Pending Deposit Payment (With Populated Insurance Details)
// @route   GET /hospital/doctor/appointments/admissions/pending-holds
// @access  Private (Hospital Admin / Reception)
const getHospitalPendingAdmissionHolds = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const now = new Date();

        // 1. Auto-release any expired 30-minute bed holds & sync capacity
        await syncHospitalWardAndBedCapacity(hospitalId);

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
        .populate('opdAppointmentId', 'bookingId tokenNumber appointmentDate')
        .populate('insuranceDetails.masterInsuranceId', 'provider insuranceName type') // Populated Insurance
        .sort({ admissionHoldExpiresAt: 1 })
        .lean();

        const formattedData = pendingHolds.map(item => {
            const holdDeadline = new Date(item.admissionHoldExpiresAt);
            const remainingMs = Math.max(0, holdDeadline.getTime() - now.getTime());
            const remainingSeconds = Math.floor(remainingMs / 1000);
            const isInsured = Boolean(item.insuranceDetails?.hasInsurance);

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
                vitalsAtAdmission: item.clinicalSummary?.vitals || null,
                
                // 🚨 HIGHLIGHTED INSURANCE FIELDS
                hasInsurance: isInsured,
                insuranceClaimStatus: isInsured 
                    ? (item.insuranceDetails?.approvalStatus || 'Pending') 
                    : 'Self-Pay (No Insurance)',
                insuranceDetails: item.insuranceDetails || null,
                insuranceSummary: isInsured ? {
                    hasInsurance: true,
                    insuranceNumber: item.insuranceDetails?.insuranceNumber || "N/A",
                    companyName: item.insuranceDetails?.companyName || item.insuranceDetails?.masterInsuranceId?.insuranceName || "N/A",
                    provider: item.insuranceDetails?.masterInsuranceId?.provider || "N/A",
                    insuranceType: item.insuranceDetails?.insuranceType || item.insuranceDetails?.masterInsuranceId?.type || "Cashless",
                    approvalStatus: item.insuranceDetails?.approvalStatus || 'Pending',
                    approvalLetterPdf: item.insuranceDetails?.approvalLetterPdf || null,
                    cardFrontImage: item.insuranceDetails?.insuranceDocumentFront || null,
                    cardBackImage: item.insuranceDetails?.insuranceDocumentBack || null,
                    cardDocument: item.insuranceDetails?.insuranceDocument || null
                } : null
            };
        });

        return res.status(200).json({
            success: true,
            count: formattedData.length,
            message: "Pending admission holds fetched successfully.",
            data: formattedData
        });

    } catch (error) {
        console.error("Get Pending Admission Holds Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Hospital Reception Desk Collects Admission Deposit (Safe Enum Parsing & Ward Capacity Sync)
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
            bookingType: 'Admission',
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

        // Verify 30-Minute Hold Window
        if (appointment.admissionHoldExpiresAt && now > new Date(appointment.admissionHoldExpiresAt)) {
            if (appointment.bedId) {
                await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Available' } });
            }
            appointment.status = 'Cancelled-By-Hospital';
            appointment.admissionHoldExpiresAt = null;
            appointment.cancellationDetails = {
                reason: "30-Minute admission deposit window expired. Bed was released.",
                cancelledAt: now
            };
            await appointment.save();

            await syncHospitalWardAndBedCapacity(hospitalId);

            return res.status(400).json({
                success: false,
                isExpired: true,
                message: "The 30-minute hold window for this bed has expired. Bed was released."
            });
        }

        // Lock Bed to Occupied
        const bed = await Bed.findById(appointment.bedId);
        if (!bed) {
            return res.status(404).json({ success: false, message: "Assigned bed record not found." });
        }

        bed.status = 'Occupied';
        await bed.save();

        const modeInput = String(rawPaymentMode).trim().toUpperCase();
        let cleanPaymentMode = 'Cash';
        if (modeInput === 'UPI') cleanPaymentMode = 'UPI';
        else if (modeInput === 'CARD') cleanPaymentMode = 'Card';
        else if (modeInput === 'ONLINE') cleanPaymentMode = 'Online';
        else if (modeInput === 'COD') cleanPaymentMode = 'COD';
        else if (modeInput === 'NETBANKING') cleanPaymentMode = 'Netbanking';

        appointment.paymentStatus = 'Paid';
        appointment.paymentMethod = cleanPaymentMode;
        appointment.status = 'In-Progress';
        appointment.admissionHoldExpiresAt = null;

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

        // Sync Ward & Bed Capacity
        await syncHospitalWardAndBedCapacity(hospitalId, bed.wardId);

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

        return res.status(200).json({
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
        return res.status(500).json({ success: false, message: error.message });
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
            return res.status(400).json({ 
                success: false, 
                message: "Deposit is already paid for this bed. To transfer an occupied bed, use Bed Transfer API." 
            });
        }

        const now = new Date();
        if (appointment.admissionHoldExpiresAt && now > new Date(appointment.admissionHoldExpiresAt)) {
            if (appointment.bedId) {
                await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Available' } });
            }
            appointment.status = 'Cancelled-By-Hospital';
            appointment.admissionHoldExpiresAt = null;
            await appointment.save();

            await syncHospitalWardAndBedCapacity(hospitalId);

            return res.status(400).json({ 
                success: false, 
                isExpired: true,
                message: "Hold has expired. Please ask doctor to re-initiate admission." 
            });
        }

        const newTargetBed = await Bed.findOne({ _id: newBedId, hospitalId }).populate('wardId');
        if (!newTargetBed || newTargetBed.status !== 'Available') {
            return res.status(400).json({ success: false, message: "Target bed is not available." });
        }

        // Release old bed
        if (appointment.bedId) {
            await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Available' } });
        }

        // Lock new bed to Reserved
        newTargetBed.status = 'Reserved';
        await newTargetBed.save();

        const days = Number(appointment.stayDuration || 1);
        const newDeposit = Number(newTargetBed.pricePerDay || 1000) * days;
        const newWardTitle = newTargetBed.wardId?.name || "General Ward";

        appointment.bedId = newTargetBed._id;
        appointment.bedNumber = newTargetBed.bedNumber;
        appointment.wardName = newWardTitle;
        appointment.totalAmount = newDeposit;
        if (!appointment.pricingBreakdown) appointment.pricingBreakdown = {};
        appointment.pricingBreakdown.baseFee = newDeposit;
        appointment.pricingBreakdown.subtotal = newDeposit;
        appointment.pricingBreakdown.depositPaidOnBooking = newDeposit;

        await appointment.save();

        // Sync ward bed counters
        await syncHospitalWardAndBedCapacity(hospitalId);

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

        return res.status(200).json({
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
        return res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Hospital Rejects / Cancels Booking (Auto-syncs Ward and Bed availability)
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

        const isCounterCash = appointment.paymentMethod === 'Cash' || 
                              String(appointment.paymentMethod).toUpperCase() === 'CASH' || 
                              (appointment.paymentDetails?.razorpayPaymentId || '').startsWith('COUNTER-REC-');
        
        let refundInstruction = "Full online refund initiated.";
        if (appointment.paymentStatus === 'Paid') {
            if (isCounterCash) {
                appointment.paymentStatus = 'Refunded';
                refundInstruction = "Please collect your refund from the Hospital Cash Counter.";
            } else if (appointment.paymentMethod !== 'COD') {
                appointment.paymentStatus = 'Refund-Initiated';
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

        const targetBedId = appointment.bedId;

        if (!isOPD && targetBedId) {
            await Bed.findByIdAndUpdate(targetBedId, { $set: { status: 'Available' } });
        }

        if (appointment.subscriptionDetails?.isSubscriptionApplied && appointment.userId) {
            const benefitField = isOPD ? 'freeDoctorAppointmentsCount' : 'freeHospitalStaysCount';
            await refundBenefitCount(appointment.userId._id, benefitField);
        }

        if (appointment.couponDetails?.couponId && appointment.userId) {
            await Coupon.updateOne(
                { _id: appointment.couponDetails.couponId, "usedBy.userId": appointment.userId._id },
                { $inc: { "usedBy.$.usageCount": -1 } }
            );
        }

        await appointment.save();

        await syncHospitalWardAndBedCapacity(hospitalId);

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

        return res.status(200).json({ 
            success: true, 
            message: `${appointment.bookingType} booking rejected successfully. ${refundInstruction}`,
            refundInstruction,
            data: appointment 
        });

    } catch (error) { 
        console.error("Reject Hospital Booking Error:", error);
        return res.status(500).json({ success: false, message: error.message }); 
    }
};

module.exports = { 
    recordOpdPatientVitals,
    getHospitalPendingAdmissionHolds,
    collectAdmissionCounterPayment,
    switchAdmissionHeldBedAtCounter,
    rejectHospitalBooking
};