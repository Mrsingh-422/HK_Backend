// controllers/hospital/HospitalPanel.js
const Hospital = require('../../models/Hospital');
const Ward = require('../../models/Ward');
const Bed = require('../../models/Bed');
const HospitalService = require('../../models/HospitalService');
const Appointment = require('../../models/Appointment');
const Coupon = require('../../models/Coupon');
const Specialization = require('../../models/Specialization');
const Ambulance = require('../../models/Ambulance');
const Doctor = require('../../models/Doctor');
const Wallet = require('../../models/Wallet');
const Review = require('../../models/Review');
const Availability = require('../../models/Availability');
const AmbulanceBooking = require('../../models/AmbulanceBooking');
const { deleteFile } = require('../../utils/fileHandler');
const { getDistance } = require('../../utils/helpers');
const mongoose = require('mongoose');
const { generateTimeSlots } = require('../../utils/timeSlotHelper');
const Booking = require('../../models/AmbulanceBooking');
const moment = require('moment');
const path = require('path');
const fs = require('fs');
const NoShowConfig = require('../../models/NoShowConfig');
const Prescription = require('../../models/Prescription');
const Insurance = require('../../models/Insurance');
const InsuranceType = require('../../models/InsuranceType');
const { sendPushNotification } = require('../../utils/notification');
const User = require('../../models/User');
const crypto = require('crypto');
const { syncHospitalWardAndBedCapacity } = require('../../utils/helpers');

const getShortName = (name) => {
    return name.split(' ').map(word => word[0]).join('').toUpperCase();
};
const generateCaseRef = (type) => {
    const prefix = type === 'Accident emergency' ? 'ACC' : (type === 'Referral Ambulance' ? 'REF' : 'MED');
    const randomHex = crypto.randomBytes(2).toString('hex').toUpperCase();
    const timeSlice = Date.now().toString().slice(-4);
    return `HK-${new Date().getFullYear()}-${prefix}-${timeSlice}${randomHex}`;
};

// Helper: Calculate human-readable duration between two timestamps
const formatShiftDuration = (startTime, endTime = new Date()) => {
    if (!startTime) return "0 mins";
    const diffMs = Math.max(0, new Date(endTime).getTime() - new Date(startTime).getTime());
    const totalMinutes = Math.floor(diffMs / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const mins = totalMinutes % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours} hr${hours > 1 ? 's' : ''}`);
    parts.push(`${mins} min${mins !== 1 ? 's' : ''}`);
    return parts.join(' ');
};

// Helper: Enrich treatmentHistory array + build a dedicated doctorAssignmentSummary for Hospital Admin UI
const buildHospitalDoctorAuditTrail = (historyArray = [], appointmentStatus = 'Pending') => {
    const now = new Date();
    const isCaseClosed = ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital', 'No-Show'].includes(appointmentStatus);

    const enrichedHistory = (historyArray || []).map((item, index) => {
        const assignedTime = item.assignedAt || item.startTime || item.timestamp;
        const acceptedTime = item.acceptedAt || null;
        const endedTime = item.endTime || null;
        const status = item.acceptanceStatus || 'Pending-Acceptance';
        const isLastEntry = index === historyArray.length - 1;

        let computedUnacceptedWait = item.unacceptedWaitDuration || "";
        let computedActiveDuty = "";
        let liveStatusLabel = item.durationDisplay || "";

        if (status === 'Pending-Acceptance') {
            if (!endedTime && !isCaseClosed && isLastEntry) {
                computedUnacceptedWait = formatShiftDuration(assignedTime, now);
                liveStatusLabel = `Unaccepted for ${computedUnacceptedWait} (Awaiting Doctor Acceptance)`;
            } else {
                const refEnd = endedTime || now;
                computedUnacceptedWait = item.unacceptedWaitDuration || formatShiftDuration(assignedTime, refEnd);
                liveStatusLabel = `Did Not Accept for ${computedUnacceptedWait}`;
            }
        } else if (status === 'Unaccepted-Reassigned') {
            const refEnd = endedTime || now;
            computedUnacceptedWait = item.unacceptedWaitDuration || formatShiftDuration(assignedTime, refEnd);
            liveStatusLabel = item.durationDisplay || `Did Not Accept for ${computedUnacceptedWait} (Reassigned)`;
        } else if (status === 'Rejected-By-Doctor') {
            const refEnd = endedTime || now;
            computedUnacceptedWait = item.unacceptedWaitDuration || formatShiftDuration(assignedTime, refEnd);
            liveStatusLabel = item.durationDisplay || `Rejected after ${computedUnacceptedWait}`;
        } else if (status === 'Accepted' || status === 'Replaced-After-Acceptance' || status === 'Completed') {
            const dutyStart = acceptedTime || assignedTime;
            if (!endedTime && !isCaseClosed && isLastEntry) {
                computedActiveDuty = formatShiftDuration(dutyStart, now);
                liveStatusLabel = `${computedActiveDuty} (Active Duty)`;
            } else {
                const dutyEnd = endedTime || now;
                computedActiveDuty = formatShiftDuration(dutyStart, dutyEnd);
                liveStatusLabel = item.durationDisplay || `${computedActiveDuty} (Shift Completed)`;
            }
        }

        return {
            ...item,
            attemptNumber: index + 1,
            fromDoctorName: item.fromDoctorId?.name || null,
            fromDoctorSpeciality: item.fromDoctorId?.speciality || null,
            toDoctorName: item.toDoctorId?.name || "Assigned Doctor",
            toDoctorSpeciality: item.toDoctorId?.speciality || "",
            toDoctorPhone: item.toDoctorId?.phone || "",
            toDoctorRoom: item.toDoctorId?.department?.roomNumber || "",
            assignmentSource: item.assignmentSource || 'Hospital-Admin',
            acceptanceStatus: status,
            assignedAt: assignedTime,
            acceptedAt: acceptedTime,
            endedAt: endedTime,
            unacceptedWaitDuration: computedUnacceptedWait,
            activeDutyDuration: computedActiveDuty,
            isCurrentlyActive: Boolean(!endedTime && !isCaseClosed && isLastEntry && status === 'Accepted'),
            isAwaitingAcceptance: Boolean(!endedTime && !isCaseClosed && isLastEntry && status === 'Pending-Acceptance'),
            durationDisplay: liveStatusLabel
        };
    });

    const summaryStats = {
        totalAssignmentAttempts: enrichedHistory.length,
        unacceptedOrRejectedCount: enrichedHistory.filter(h =>
            ['Unaccepted-Reassigned', 'Rejected-By-Doctor'].includes(h.acceptanceStatus)
        ).length,
        wasPreSelectedByUserAtBooking: enrichedHistory.some(h => h.assignmentSource === 'User-Selected-At-Booking'),
        currentAssignmentStatus: enrichedHistory.length > 0
            ? enrichedHistory[enrichedHistory.length - 1].acceptanceStatus
            : 'Unassigned'
    };

    return { enrichedHistory, summaryStats };
};

// 🛡️ REUSABLE DTO HELPER: Resolves accurate single patient profile & bloodGroup without data leaks
const resolvePatientDTO = (appt) => {
    const user = appt.userId;
    const primaryPatient = appt.patients?.[0] || {};
    const isSelf = !primaryPatient.relation || 
                   primaryPatient.relation.toLowerCase() === 'self' || 
                   (user?.name && primaryPatient.patientName && primaryPatient.patientName.trim().toLowerCase() === user.name.trim().toLowerCase());

    let matchedFamilyMember = null;
    if (!isSelf && user?.familyMember && Array.isArray(user.familyMember)) {
        matchedFamilyMember = user.familyMember.find(fm => 
            (fm.memberName && primaryPatient.patientName && fm.memberName.trim().toLowerCase() === primaryPatient.patientName.trim().toLowerCase()) ||
            (fm.relation && primaryPatient.relation && fm.relation.trim().toLowerCase() === primaryPatient.relation.trim().toLowerCase())
        );
    }

    let resolvedBloodGroup = "N/A";
    if (appt.clinicalSummary?.bloodGroup && appt.clinicalSummary.bloodGroup.trim() !== "") {
        resolvedBloodGroup = appt.clinicalSummary.bloodGroup;
    } else if (primaryPatient.bloodGroup && primaryPatient.bloodGroup.trim() !== "") {
        resolvedBloodGroup = primaryPatient.bloodGroup;
    } else if (!isSelf && matchedFamilyMember?.bloodGroup) {
        resolvedBloodGroup = matchedFamilyMember.bloodGroup;
    } else if (isSelf && user?.bloodGroup) {
        resolvedBloodGroup = user.bloodGroup;
    }

    const resolvedProfilePic = (!isSelf && matchedFamilyMember?.profilePic) 
        ? matchedFamilyMember.profilePic 
        : (user?.profilePic || null);

    const resolvedAge = primaryPatient.patientAge || 
        (matchedFamilyMember?.dob ? moment().diff(moment(matchedFamilyMember.dob), 'years') : (user?.age || "N/A"));

    return {
        patientName: primaryPatient.patientName || (isSelf ? user?.name : "Admitted Patient"),
        age: resolvedAge,
        gender: primaryPatient.gender || matchedFamilyMember?.gender || (isSelf ? user?.gender : "N/A"),
        relation: matchedFamilyMember?.relation || primaryPatient.relation || (isSelf ? "Self" : "Family Member"),
        bloodGroup: resolvedBloodGroup, // 👈 Single, clean, accurate Blood Group!
        reasonForVisit: primaryPatient.reasonForVisit || appt.bookingReason || "Hospital Admission",
        profilePic: resolvedProfilePic
    };
};



// --- MASTER DATA/Enums FOR HOSPITAL PANEL (Screenshot 6) ---
const getHospitalMasterData = async (req, res) => {
    try {
        const Insurance = require('../../models/Insurance'); // Safe dynamic load

        // 1. Fetch Specializations and Master Insurance Plans in parallel
        const [specialities, insurancePlans] = await Promise.all([
            Specialization.find({ isActive: true }).select('name'),
            Insurance.find({ isActive: true }).select('provider insuranceName type')
        ]);

        // 2. Extract Enums dynamically from Mongoose Schemas
        const hospitalTypes = Hospital.schema.path('type').enumValues || ['Govt', 'Private', 'Charity'];
        const ambulanceTypes = Ambulance.schema.path('vehicleType').enumValues || ['Van', 'Mini Van', 'Advance Life Support', 'ICU Ambulance'];
        const wardTypes = Ward.schema.path('type').enumValues || ['ICU', 'Ward'];
        
        // 3. Extract unique insurance provider brand names dynamically
        const dbInsuranceCompanies = [...new Set(insurancePlans.map(p => p.provider).filter(Boolean))];
        const finalInsuranceCompanies = dbInsuranceCompanies.length > 0 
            ? dbInsuranceCompanies 
            : ['HDFC ERGO', 'LIC Health', 'SBI General', 'Star Health', 'Care Health'];

        res.json({
            success: true,
            data: {
                specialities,
                hospitalTypes,
                ambulanceTypes,
                wardTypes,
                insuranceCompanies: finalInsuranceCompanies, // 👈 Dynamic from DB
                insurancePlans // 👈 Full insurance catalog details
            }
        });
    } catch (error) { 
        console.error("getHospitalMasterData Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// @desc    Get Hospital Vendor Main Dashboard Metrics (Accurate Real-Time Bed Tallies & Daily Inpatients)
// @route   GET /hospital/panel/dashboard-stats
// @access  Private (Hospital Admin)
const getHospitalDashboardStats = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const now = new Date();

        // 1. Auto-sync holds & bed statuses before calculating dashboard numbers
        await syncHospitalWardAndBedCapacity(hospitalId);

        // 2. Fetch all hospital beds
        const allBeds = await Bed.find({ hospitalId }).lean();

        const totalBeds = allBeds.length;
        const occupiedBeds = allBeds.filter(b => b.status === 'Occupied').length;
        const reservedBeds = allBeds.filter(b => b.status === 'Reserved').length;
        const maintenanceBeds = allBeds.filter(b => b.status === 'Maintenance').length;
        const availableBeds = allBeds.filter(b => b.status === 'Available').length;
        const ventilatorBedsTotal = allBeds.filter(b => Boolean(b.isVentilatorAvailable)).length;
        const ventilatorBedsAvailable = allBeds.filter(b => Boolean(b.isVentilatorAvailable) && b.status === 'Available').length;

        // Safe occupancy calculation
        const activeInUse = occupiedBeds + reservedBeds;
        const occupancyRateNumeric = totalBeds > 0 ? Math.round((activeInUse / totalBeds) * 100) : 0;

        // 3. Today's patient movement metrics (IST midnight boundary)
        const startOfToday = moment().startOf('day').toDate();
        const endOfToday = moment().endOf('day').toDate();

        const [
            todayAdmissions,
            activeInpatientsCount,
            pendingHoldsCount,
            pendingDischargesCount,
            todayDischarges,
            activeEmergencyCases
        ] = await Promise.all([
            // Admitted today
            Appointment.countDocuments({
                hospitalId,
                bookingType: 'Admission',
                status: { $in: ['In-Progress', 'Discharge-Pending', 'Completed'] },
                startDate: { $gte: startOfToday, $lte: endOfToday }
            }),
            // Currently admitted (occupying bed right now)
            Appointment.countDocuments({
                hospitalId,
                bookingType: 'Admission',
                status: { $in: ['In-Progress', 'Discharge-Pending'] }
            }),
            // 30-min holds waiting deposit
            Appointment.countDocuments({
                hospitalId,
                bookingType: 'Admission',
                status: 'Hospital-Pending',
                admissionHoldExpiresAt: { $gt: now }
            }),
            // Doctors submitted discharge summary, waiting final admin billing
            Appointment.countDocuments({
                hospitalId,
                bookingType: 'Admission',
                status: 'Discharge-Pending'
            }),
            // Successfully discharged today
            Appointment.countDocuments({
                hospitalId,
                bookingType: 'Admission',
                status: 'Completed',
                $or: [
                    { 'clinicalSummary.dischargedAt': { $gte: startOfToday, $lte: endOfToday } },
                    { updatedAt: { $gte: startOfToday, $lte: endOfToday } }
                ]
            }),
            // Emergency / 108 cases today
            Appointment.countDocuments({
                hospitalId,
                bookingType: 'Admission',
                status: { $in: ['Hospital-Pending', 'Confirmed', 'In-Progress'] },
                $or: [
                    { triageLevel: 'Emergency' },
                    { bedBookingType: 'Emergency-Bed' }
                ],
                createdAt: { $gte: startOfToday, $lte: endOfToday }
            })
        ]);

        const bedCapacitySummary = {
            totalBeds,
            availableBeds,
            occupiedBeds,
            reservedBeds,
            maintenanceBeds,
            ventilatorBedsTotal,
            ventilatorBedsAvailable,
            occupancyRate: `${occupancyRateNumeric}%`,
            occupancyRateNumeric
        };

        const inpatientFlow = {
            todayAdmissions,
            activeInpatients: activeInpatientsCount,
            pendingDepositHolds: pendingHoldsCount,
            pendingDischarges: pendingDischargesCount,
            todayDischarges,
            activeEmergencyCases
        };

        res.status(200).json({
            success: true,
            data: {
                // Flat keys for direct widget binding
                totalBeds,
                availableBeds,
                occupiedBeds,
                reservedBeds,
                maintenanceBeds,
                occupancyRate: `${occupancyRateNumeric}%`,
                // Structured objects for modular cards
                bedCapacity: bedCapacitySummary,
                inpatientFlow
            }
        });

    } catch (error) {
        console.error("Get Hospital Dashboard Stats Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch dashboard stats: " + error.message
        });
    }
};

// --- 2. WARD & BED MANAGEMENT (Strict Sync) ---
const createWardUnit = async (req, res) => {
    try {
        const { name, type, totalBeds, pricePerDay } = req.body;
        const ward = await Ward.create({ hospitalId: req.user.id, name, type, totalBeds, availableBeds: totalBeds });

        const shortName = getShortName(name);
        const bedData = [];
        for (let i = 1; i <= totalBeds; i++) {
            bedData.push({
                hospitalId: req.user.id,
                wardId: ward._id,
                bedNumber: `${shortName}-${i.toString().padStart(2, '0')}`,
                status: 'Available',
                pricePerDay: Number(pricePerDay)
            });
        }
        await Bed.insertMany(bedData);
        res.status(201).json({ success: true, message: "Ward & Beds Generated", ward });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// @desc    Get All Beds in a Ward with Inpatient Metadata (Optimized 2-Query Bulk Populate)
// @route   GET /hospital/panel/ward/:wardId/beds
// @access  Private (Hospital Admin)
const getBedsInWard = async (req, res) => {
    try {
        const { wardId } = req.params;
        const hospitalId = req.user.id;

        if (!mongoose.isValidObjectId(wardId)) {
            return res.status(400).json({ success: false, message: "Invalid wardId format." });
        }

        const wardObjId = new mongoose.Types.ObjectId(wardId);
        const hospObjId = new mongoose.Types.ObjectId(hospitalId);

        // 1. Fetch Ward & Beds in parallel
        const [ward, beds] = await Promise.all([
            Ward.findOne({ _id: wardObjId, hospitalId: hospObjId }).select('name type totalBeds availableBeds').lean(),
            Bed.find({ wardId: wardObjId, hospitalId: hospObjId }).sort({ bedNumber: 1 }).lean()
        ]);

        if (!ward) {
            return res.status(404).json({ success: false, message: "Ward not found in this hospital." });
        }

        // 2. Identify occupied or reserved beds
        const busyBedIds = beds
            .filter(b => b.status === 'Occupied' || b.status === 'Reserved')
            .map(b => b._id);

        // 3. FAST BULK POPULATE: 1 single query for ALL inpatients in this ward
        const activeAppointments = busyBedIds.length > 0 ? await Appointment.find({
            hospitalId: hospObjId,
            bedId: { $in: busyBedIds },
            bookingType: 'Admission',
            status: { $in: ['In-Progress', 'Discharge-Pending', 'Hospital-Pending', 'Confirmed'] }
        })
        .populate('userId', 'name phone profilePic')
        .populate('doctorId', 'name speciality')
        .select('bookingId bedId wardName bedNumber status startDate endDate triageLevel patients admissionHoldExpiresAt')
        .lean() : [];

        // 4. In-Memory Map (Instant O(1) correlation)
        const apptMap = new Map();
        const now = new Date();

        activeAppointments.forEach(appt => {
            const isHold = Boolean(appt.admissionHoldExpiresAt && new Date(appt.admissionHoldExpiresAt) > now);
            let daysStayed = 1;
            if (appt.startDate) {
                daysStayed = Math.max(1, moment().diff(moment(appt.startDate), 'days') + 1);
            }

            apptMap.set(String(appt.bedId), {
                appointmentId: appt._id,
                bookingId: appt.bookingId,
                patientName: appt.patients?.[0]?.patientName || appt.userId?.name || "Patient",
                patientPhone: appt.userId?.phone || "N/A",
                admittedDate: appt.startDate,
                targetDischargeDate: appt.endDate,
                daysStayed,
                doctorName: appt.doctorId?.name || "Doctor",
                doctorSpeciality: appt.doctorId?.speciality || "",
                status: isHold ? 'Hold-Reserved' : appt.status,
                triageLevel: appt.triageLevel || 'Routine',
                isHold,
                holdExpiresAt: isHold ? appt.admissionHoldExpiresAt : null
            });
        });

        // 5. Assemble response
        let availableCount = 0;
        let occupiedCount = 0;
        let reservedCount = 0;
        let maintenanceCount = 0;

        const enrichedBeds = beds.map(bed => {
            const bIdStr = String(bed._id);
            if (bed.status === 'Available') availableCount++;
            else if (bed.status === 'Occupied') occupiedCount++;
            else if (bed.status === 'Reserved') reservedCount++;
            else if (bed.status === 'Maintenance') maintenanceCount++;

            return {
                _id: bed._id,
                bedNumber: bed.bedNumber,
                pricePerDay: bed.pricePerDay,
                isVentilatorAvailable: Boolean(bed.isVentilatorAvailable),
                status: bed.status,
                activePatient: apptMap.get(bIdStr) || null
            };
        });

        return res.status(200).json({
            success: true,
            totalBeds: beds.length,
            availableBeds: availableCount,
            occupiedBeds: occupiedCount,
            reservedBeds: reservedCount,
            maintenanceBeds: maintenanceCount,
            ward: {
                _id: ward._id,
                name: ward.name,
                type: ward.type,
                totalBeds: beds.length,
                availableBeds: availableCount
            },
            data: enrichedBeds
        });

    } catch (error) {
        console.error("Fast Get Beds in Ward Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};
const updateBedDetails = async (req, res) => {
    try {
        const { bedId } = req.params;
        const { pricePerDay, status } = req.body;

        const bed = await Bed.findByIdAndUpdate(
            bedId,
            { pricePerDay: Number(pricePerDay), status },
            { new: true }
        );

        res.json({ success: true, message: "Bed details updated", data: bed });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
const deleteSpecificBed = async (req, res) => {
    try {
        const { bedId } = req.params;

        const bed = await Bed.findById(bedId);
        if (!bed) return res.status(404).json({ message: "Bed not found" });

        // Production Check: Occupied bed delete nahi hona chahiye
        if (bed.status !== 'Available') {
            return res.status(400).json({ message: "Cannot delete an occupied or reserved bed" });
        }

        const wardId = bed.wardId;

        // 1. Delete the bed document
        await Bed.findByIdAndDelete(bedId);

        // 2. Sync Ward model counts
        await Ward.findByIdAndUpdate(wardId, {
            $inc: { totalBeds: -1, availableBeds: -1 }
        });

        res.json({ success: true, message: "Specific bed removed and ward capacity updated" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// @desc    Hospital Admin Admits Walk-In / Emergency Patient Directly to a Bed (With Synced treatmentHistory)
// @route   POST /hospital/panel/ward/admit-patient
// @access  Private (Hospital Admin)
const admitPatientToBed = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const {
            bedId,
            doctorId,
            patientName,
            patientPhone,
            patientAge = 30,
            gender = 'Male',
            bloodGroup,
            triageLevel = 'Routine',
            stayDuration = 1,
            bookingReason,
            paymentMethod = 'Cash'
        } = req.body;

        if (!bedId || !patientName || !patientPhone) {
            return res.status(400).json({
                success: false,
                message: "bedId, patientName, and patientPhone are required."
            });
        }

        const bed = await Bed.findOne({ _id: bedId, hospitalId }).populate('wardId');
        if (!bed || bed.status !== 'Available') {
            return res.status(400).json({
                success: false,
                message: "Selected bed is not available."
            });
        }

        // Find or create patient User record
        const cleanPhone = String(patientPhone).trim().replace(/\D/g, "").slice(-10);
        let user = await User.findOne({ phone: cleanPhone });
        if (!user) {
            const hashedPassword = await bcrypt.hash('Patient@123', 10);
            user = await User.create({
                name: String(patientName).trim(),
                phone: cleanPhone,
                countryCode: '+91',
                password: hashedPassword,
                role: 'user',
                isPhoneVerified: true,
                profileStatus: 'Approved'
            });
        }

        let assignedDoctor = null;
        if (doctorId && mongoose.isValidObjectId(doctorId)) {
            assignedDoctor = await Doctor.findOne({ _id: doctorId, hospitalId }).select('_id name speciality department').lean();
        }

        const now = new Date();
        const days = Math.max(1, parseInt(stayDuration) || 1);
        const totalDeposit = Number(bed.pricePerDay || 1000) * days;
        const wardName = bed.wardId?.name || "General Ward";
        const bookingId = `HKH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        const initialHistory = [];
        if (assignedDoctor) {
            initialHistory.push({
                fromDoctorId: null,
                toDoctorId: assignedDoctor._id,
                action: 'Initial-Assignment',
                assignmentSource: 'Hospital-Admin',
                acceptanceStatus: 'Pending-Acceptance',
                assignedAt: now,
                acceptedAt: null,
                unacceptedWaitDuration: "",
                notes: `Assigned to Dr. ${assignedDoctor.name} (${assignedDoctor.speciality || 'Specialist'}) during walk-in admission at Hospital Desk. Awaiting acceptance.`,
                timestamp: now,
                startTime: now,
                endTime: null,
                durationDisplay: "Awaiting Doctor Acceptance"
            });
        }

        const appointment = await Appointment.create({
            userId: user._id,
            hospitalId,
            bedId: bed._id,
            doctorId: assignedDoctor ? assignedDoctor._id : null,
            bookingType: 'Admission',
            bedBookingType: triageLevel === 'Emergency' ? 'Emergency-Bed' : 'General-Bed',
            bookingId,
            bookingReason: bookingReason || "Direct Walk-In Hospital Admission",
            triageLevel,
            wardName,
            bedNumber: bed.bedNumber,
            stayDuration: days,
            startDate: now,
            endDate: moment(now).add(days, 'days').toDate(),
            appointmentDate: now,
            patients: [{
                patientName: String(patientName).trim(),
                patientAge: Number(patientAge) || 30,
                gender: ['Male', 'Female', 'Other'].includes(gender) ? gender : 'Male',
                relation: 'Self',
                reasonForVisit: bookingReason || "Direct Hospital Admission",
                bloodGroup: bloodGroup || null,
                isMainUser: true
            }],
            pricingBreakdown: {
                baseFee: totalDeposit,
                originalBaseFee: totalDeposit,
                subtotal: totalDeposit,
                bookedDurationDays: days,
                depositPaidOnBooking: totalDeposit
            },
            totalAmount: totalDeposit,
            paymentMethod: paymentMethod || 'Cash',
            paymentStatus: 'Paid',
            status: 'In-Progress',
            transactionId: `COUNTER-ADM-${Date.now().toString().slice(-6)}`,
            treatmentHistory: initialHistory
        });

        bed.status = 'Occupied';
        await bed.save();
        await syncHospitalWardAndBedCapacity(hospitalId, bed.wardId?._id);

        if (assignedDoctor) {
            sendPushNotification(
                assignedDoctor._id,
                'doctor',
                "🏥 New Walk-In Admission Assigned",
                `Patient ${patientName} admitted to ${wardName} (${bed.bedNumber}, #${bookingId}). Please accept and take charge.`,
                { appointmentId: String(appointment._id), bookingId, type: 'CASE_ASSIGNED' }
            ).catch(() => {});
        }

        return res.status(201).json({
            success: true,
            message: `Patient admitted to ${wardName} (${bed.bedNumber}) successfully.`,
            data: appointment
        });

    } catch (error) {
        console.error("Admit Patient To Bed Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

const updateWardBeds = async (req, res) => {
    try {
        const { wardId, action, bedCount, pricePerDay } = req.body;
        const ward = await Ward.findById(wardId);
        if (!ward) return res.status(404).json({ message: "Ward not found" });

        const count = Number(bedCount);

        if (action === 'add') {
            const currentTotal = ward.totalBeds;
            const shortName = getShortName(ward.name);
            const bedData = [];
            
            // Use provided price or ward's default price
            const price = pricePerDay ? Number(pricePerDay) : 500; 

            for (let i = 1; i <= count; i++) {
                bedData.push({
                    hospitalId: req.user.id,
                    wardId: ward._id,
                    bedNumber: `${shortName}-${(currentTotal + i).toString().padStart(2, '0')}`,
                    status: 'Available',
                    pricePerDay: price // 👈 Price saved here
                });
            }
            await Bed.insertMany(bedData);
            ward.totalBeds += count;
            ward.availableBeds += count;

        } else if (action === 'remove') {
            // Bulk remove from the end (Last in, first out)
            const removableBeds = await Bed.find({ wardId, status: 'Available' })
                .sort({ createdAt: -1 })
                .limit(count);

            if (removableBeds.length < count) {
                return res.status(400).json({ message: `Only ${removableBeds.length} available beds can be removed.` });
            }

            const idsToRemove = removableBeds.map(b => b._id);
            await Bed.deleteMany({ _id: { $in: idsToRemove } });
            
            ward.totalBeds -= count;
            ward.availableBeds -= count;
        }

        await ward.save();
        res.json({ success: true, message: "Bulk update successful", data: ward });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// @desc    Get Hospital Bed & Ward Occupancy Overview
// @route   GET /hospital/panel/ward-status
// @access  Private (Hospital Admin)
const getWardStatus = async (req, res) => {
    try {
        const hospitalId = req.user.id;

        // Auto-sync all capacity
        await syncHospitalWardAndBedCapacity(hospitalId);

        const wards = await Ward.find({ hospitalId, isActive: true }).lean();
        const allBeds = await Bed.find({ hospitalId }).lean();

        const totalBeds = allBeds.length;
        const occupied = allBeds.filter(b => b.status === 'Occupied').length;
        const reserved = allBeds.filter(b => b.status === 'Reserved').length;
        const maintenance = allBeds.filter(b => b.status === 'Maintenance').length;
        const available = allBeds.filter(b => b.status === 'Available').length;

        const wardBreakdown = wards.map(w => {
            const wardBeds = allBeds.filter(b => String(b.wardId) === String(w._id));
            return {
                wardId: w._id,
                name: w.name,
                type: w.type,
                total: wardBeds.length,
                available: wardBeds.filter(b => b.status === 'Available').length,
                occupied: wardBeds.filter(b => b.status === 'Occupied').length,
                reserved: wardBeds.filter(b => b.status === 'Reserved').length,
                maintenance: wardBeds.filter(b => b.status === 'Maintenance').length
            };
        });

        res.status(200).json({
            success: true,
            overview: {
                totalBeds,
                availableBeds: available,
                occupiedBeds: occupied,
                reservedBeds: reserved,
                maintenanceBeds: maintenance,
                occupancyRate: totalBeds > 0 ? `${Math.round(((occupied + reserved) / totalBeds) * 100)}%` : "0%"
            },
            wards: wardBreakdown
        });
    } catch (error) {
        console.error("Get Ward Status Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Hospital Admin Toggles / Updates Bed Operational Status (Available, Maintenance, Occupied)
// @route   PATCH /hospital/panel/bed/status
// @access  Private (Hospital Admin)
const updateBedStatus = async (req, res) => {
    try {
        const { bedId, status } = req.body;
        const hospitalId = req.user.id;

        if (!bedId || !status) {
            return res.status(400).json({ success: false, message: "bedId and status are required." });
        }

        const allowed = ['Available', 'Occupied', 'Reserved', 'Maintenance'];
        if (!allowed.includes(status)) {
            return res.status(400).json({ success: false, message: `Invalid status. Allowed values: ${allowed.join(', ')}` });
        }

        const bed = await Bed.findOne({ _id: bedId, hospitalId });
        if (!bed) {
            return res.status(404).json({ success: false, message: "Bed not found in this hospital." });
        }

        bed.status = status;
        await bed.save();

        // Re-sync ward totals immediately
        await syncHospitalWardAndBedCapacity(hospitalId, bed.wardId);

        const updatedWard = await Ward.findById(bed.wardId).lean();

        res.status(200).json({
            success: true,
            message: `Bed ${bed.bedNumber} marked as ${status}. Ward availability re-synchronized.`,
            bed,
            ward: {
                totalBeds: updatedWard.totalBeds,
                availableBeds: updatedWard.availableBeds
            }
        });
    } catch (error) {
        console.error("Update Bed Status Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 1. ASSIGN DOCTOR TO ADMISSION (Preserves Previous Unaccepted/Pre-Selected Doctor Logs)
// Endpoint: POST /hospital/panel/admissions/assign-doctor
const assignDoctorToAdmission = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { appointmentId, doctorId, notes, reason } = req.body;

        if (!appointmentId || !doctorId) {
            return res.status(400).json({
                success: false,
                message: "appointmentId and doctorId are required."
            });
        }

        const isApptObjId = mongoose.isValidObjectId(appointmentId);
        const apptQuery = {
            hospitalId,
            ...(isApptObjId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const [appointment, newDoctor] = await Promise.all([
            Appointment.findOne(apptQuery).populate('doctorId', 'name speciality'),
            Doctor.findOne({ _id: doctorId, hospitalId }).select('name speciality department phone profileImage').lean()
        ]);

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Admission record not found in this hospital." });
        }
        if (!newDoctor) {
            return res.status(404).json({ success: false, message: "Doctor not found in this hospital." });
        }

        const now = new Date();
        const previousDoctorId = appointment.doctorId?._id || appointment.doctorId || null;
        const previousDoctorName = appointment.doctorId?.name || "Previous Doctor";

        if (!Array.isArray(appointment.treatmentHistory)) {
            appointment.treatmentHistory = [];
        }

        // 🚨 CLOSE PREVIOUS OPEN DOCTOR LOG (Track whether previous doctor failed to accept or was replaced after accepting)
        if (appointment.treatmentHistory.length > 0) {
            const lastLog = appointment.treatmentHistory[appointment.treatmentHistory.length - 1];
            if (lastLog && !lastLog.endTime) {
                const prevAssignedTime = lastLog.assignedAt || lastLog.startTime || lastLog.timestamp;
                lastLog.endTime = now;

                if (lastLog.acceptanceStatus === 'Pending-Acceptance' || !lastLog.acceptedAt) {
                    const waitTimeStr = formatShiftDuration(prevAssignedTime, now);
                    lastLog.acceptanceStatus = 'Unaccepted-Reassigned';
                    lastLog.unacceptedWaitDuration = waitTimeStr;
                    lastLog.durationDisplay = `Did Not Accept for ${waitTimeStr} (Reassigned to Dr. ${newDoctor.name})`;
                    lastLog.notes = `${lastLog.notes || ''} | [Reassigned at ${moment(now).format('hh:mm A')}: Did not accept for ${waitTimeStr}]`.trim();
                } else {
                    const dutyTimeStr = formatShiftDuration(lastLog.acceptedAt || prevAssignedTime, now);
                    lastLog.acceptanceStatus = 'Replaced-After-Acceptance';
                    lastLog.durationDisplay = `${dutyTimeStr} (Shift Ended - Reassigned to Dr. ${newDoctor.name})`;
                }
            }
        }

        const isReassignment = Boolean(previousDoctorId && String(previousDoctorId) !== String(newDoctor._id));
        const customNote = notes || reason;

        // Push new assignment entry into treatmentHistory
        appointment.treatmentHistory.push({
            fromDoctorId: previousDoctorId || null,
            toDoctorId: newDoctor._id,
            action: isReassignment ? 'Reassigned-By-Hospital' : 'Initial-Assignment',
            assignmentSource: 'Hospital-Admin',
            acceptanceStatus: 'Pending-Acceptance',
            assignedAt: now,
            acceptedAt: null,
            unacceptedWaitDuration: "",
            notes: customNote
                ? String(customNote).trim()
                : (isReassignment
                    ? `Hospital Admin reassigned case from Dr. ${previousDoctorName} to Dr. ${newDoctor.name} (${newDoctor.speciality || 'Specialist'}). Awaiting acceptance.`
                    : `Assigned to Dr. ${newDoctor.name} (${newDoctor.speciality || 'Specialist'}) by Hospital Management. Awaiting acceptance.`),
            timestamp: now,
            startTime: now,
            endTime: null,
            durationDisplay: "Awaiting Doctor Acceptance"
        });

        appointment.doctorId = newDoctor._id;
        appointment.pendingDoctorId = null;

        if (appointment.status === 'Hospital-Pending' || appointment.status === 'Pending') {
            appointment.status = 'Confirmed';
        }

        await appointment.save();

        // Dispatch Push Notifications in background
        Promise.allSettled([
            sendPushNotification(
                newDoctor._id,
                'doctor',
                "🏥 New IPD Case Assigned - Action Required",
                `Hospital Admin assigned you to patient ${appointment.patients?.[0]?.patientName || 'Patient'} (#${appointment.bookingId}, Bed: ${appointment.bedNumber || 'Assigned'}). Please accept/take charge.`,
                { appointmentId: String(appointment._id), bookingId: String(appointment.bookingId), type: 'CASE_ASSIGNED' }
            ),
            (isReassignment && previousDoctorId) ? sendPushNotification(
                previousDoctorId,
                'doctor',
                "ℹ️ Case Reassigned by Hospital",
                `Case #${appointment.bookingId} has been reassigned to Dr. ${newDoctor.name} by Hospital Management.`,
                { appointmentId: String(appointment._id), bookingId: String(appointment.bookingId), type: 'CASE_REASSIGNED_AWAY' }
            ) : Promise.resolve(),
            appointment.userId ? sendPushNotification(
                appointment.userId,
                'user',
                "👨‍⚕️ Attending Doctor Assigned",
                `Dr. ${newDoctor.name} (${newDoctor.speciality || 'Specialist'}) has been assigned to your hospital care (#${appointment.bookingId}).`,
                { appointmentId: String(appointment._id), bookingId: String(appointment.bookingId), type: 'DOCTOR_ASSIGNED' }
            ) : Promise.resolve()
        ]);

        // Populate and enrich history so Hospital UI updates immediately
        const updatedPopulated = await Appointment.findById(appointment._id)
            .populate('doctorId', 'name speciality qualification phone profileImage department')
            .populate('treatmentHistory.fromDoctorId', 'name speciality profileImage phone department')
            .populate('treatmentHistory.toDoctorId', 'name speciality profileImage phone department')
            .lean();

        const { enrichedHistory, summaryStats } = buildHospitalDoctorAuditTrail(updatedPopulated.treatmentHistory, updatedPopulated.status);

        return res.status(200).json({
            success: true,
            message: `Dr. ${newDoctor.name} assigned to case #${appointment.bookingId} successfully.`,
            doctorAssignmentSummary: summaryStats,
            data: {
                ...updatedPopulated,
                treatmentHistory: enrichedHistory
            }
        });

    } catch (error) {
        console.error("Assign Doctor To Admission Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};


// --- 2. MANAGE SERVICES (Screenshot 11, 12, 31) ---
const addHospitalService = async (req, res) => {
    try {
        const { serviceName, price, description } = req.body;
        const service = await HospitalService.create({
            hospitalId: req.user.id,
            serviceName,
            price,
            description,
            image: req.file ? `/uploads/hospital_services/${req.file.filename}` : null
        });
        res.status(201).json({ success: true, data: service });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const updateHospitalService = async (req, res) => {
    try {
        const { id } = req.params;
        const service = await HospitalService.findOne({ _id: id, hospitalId: req.user.id });
        if (!service) return res.status(404).json({ message: "Service not found" });

        if (req.file) {
            deleteFile(service.image); // Purana icon delete karein
            service.image = `/uploads/hospital_services/${req.file.filename}`;
        }
        service.serviceName = req.body.serviceName || service.serviceName;
        service.price = req.body.price || service.price;
        service.description = req.body.description || service.description;

        await service.save();
        res.json({ success: true, message: "Service Updated", data: service });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// 1. GET ALL SERVICES (Screenshot 31)
const getHospitalServices = async (req, res) => {
    try {
        const services = await HospitalService.find({ hospitalId: req.user.id });
        res.json({ success: true, data: services });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// helper funciton for generate final bill and discharge
const calcDuration = (start, end) => {
    if (!start || !end) return "";
    const duration = moment.duration(moment(end).diff(moment(start)));
    const hours = Math.floor(duration.asHours());
    const minutes = duration.minutes();
    return hours > 0 ? `${hours} hr ${minutes} mins` : `${minutes} mins`;
};
// @desc    Generate 24-Hour Dynamic Final Bill & Discharge Patient (Closes Open Shift in treatmentHistory)
// @route   POST /hospital/panel/discharge/finalize
// @access  Private (Hospital Admin)
const generateFinalBillAndDischarge = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const {
            appointmentId,
            extraCharges = 0,
            discountAmount = 0,
            dischargeNote,
            paymentMethod
        } = req.body;

        if (!appointmentId) {
            return res.status(400).json({
                success: false,
                message: "appointmentId is required to finalize discharge."
            });
        }

        const isObjId = mongoose.isValidObjectId(appointmentId);
        const query = {
            hospitalId,
            ...(isObjId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const appointment = await Appointment.findOne(query)
            .populate('bedId')
            .populate('userId', 'name phone fcmToken')
            .populate('doctorId', 'name speciality');

        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Admission record not found in this hospital."
            });
        }

        const now = new Date();
        const admissionStart = appointment.startDate ? new Date(appointment.startDate) : new Date(appointment.createdAt);

        // 1. 24-Hour Dynamic Stay Calculation
        const diffMs = Math.max(0, now.getTime() - admissionStart.getTime());
        const actualStayHours = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
        const actualStayDays = Math.max(1, Math.ceil(actualStayHours / 24));
        const bookedDays = Math.max(1, Number(appointment.stayDuration || appointment.pricingBreakdown?.bookedDurationDays || 1));

        const bedPricePerDay = Number(
            appointment.bedId?.pricePerDay ||
            (Number(appointment.pricingBreakdown?.baseFee || 1000) / bookedDays)
        );

        const specialServicesSum = (appointment.specialServices || []).reduce(
            (sum, s) => sum + Number(s.price || 0),
            0
        );

        const actualRoomCharges = bedPricePerDay * actualStayDays;
        const visitCharges = Number(appointment.pricingBreakdown?.visitCharges || 0);
        const totalExtra = Number(extraCharges || 0) + specialServicesSum;
        const totalDiscount = Number(discountAmount || appointment.pricingBreakdown?.discountAmount || 0);

        const finalActualBill = Math.max(0, Math.round(actualRoomCharges + visitCharges + totalExtra - totalDiscount));
        const depositAlreadyPaid = appointment.paymentStatus === 'Paid'
            ? Number(appointment.pricingBreakdown?.depositPaidOnBooking || appointment.totalAmount || 0)
            : 0;

        let unusedDaysRefund = 0;
        let pendingDepartureBalance = 0;
        let settlementStatus = 'Settled';

        if (depositAlreadyPaid > finalActualBill) {
            unusedDaysRefund = Math.round(depositAlreadyPaid - finalActualBill);
            settlementStatus = 'Refund-Initiated';
            appointment.paymentStatus = 'Refund-Initiated';
        } else if (finalActualBill > depositAlreadyPaid) {
            pendingDepartureBalance = Math.round(finalActualBill - depositAlreadyPaid);
            settlementStatus = 'Settled';
            appointment.paymentStatus = 'Paid';
        } else {
            settlementStatus = 'Settled';
            appointment.paymentStatus = 'Paid';
        }

        if (paymentMethod) {
            appointment.paymentMethod = paymentMethod;
        }

        // 2. Update Pricing Breakdown Ledger
        if (!appointment.pricingBreakdown) appointment.pricingBreakdown = {};
        appointment.pricingBreakdown.bookedDurationDays = bookedDays;
        appointment.pricingBreakdown.actualStayHours = actualStayHours;
        appointment.pricingBreakdown.actualStayDays = actualStayDays;
        appointment.pricingBreakdown.depositPaidOnBooking = depositAlreadyPaid;
        appointment.pricingBreakdown.unusedDaysRefund = unusedDaysRefund;
        appointment.pricingBreakdown.refundDueToUser = unusedDaysRefund;
        appointment.pricingBreakdown.pendingDepartureBalance = pendingDepartureBalance;
        appointment.pricingBreakdown.extraCharges = totalExtra;
        appointment.pricingBreakdown.discountAmount = totalDiscount;
        appointment.pricingBreakdown.subtotal = actualRoomCharges + visitCharges + totalExtra;
        appointment.pricingBreakdown.settlementStatus = settlementStatus;

        appointment.totalAmount = finalActualBill;
        appointment.status = 'Completed';
        appointment.endDate = now;

        if (!appointment.clinicalSummary) appointment.clinicalSummary = {};
        appointment.clinicalSummary.dischargedAt = now;
        if (dischargeNote) {
            appointment.clinicalSummary.dischargeNote = dischargeNote;
        }

        // 3. 🚨 CLOSE OPEN SHIFT IN treatmentHistory & APPEND FINAL DISCHARGE LOG
        if (!Array.isArray(appointment.treatmentHistory)) {
            appointment.treatmentHistory = [];
        }

        let alreadyHasDischargedLog = false;
        for (let i = appointment.treatmentHistory.length - 1; i >= 0; i--) {
            const logItem = appointment.treatmentHistory[i];
            if (!logItem) continue;

            if (logItem.action === 'Discharged') {
                alreadyHasDischargedLog = true;
            }

            if (!logItem.endTime) {
                const startRef = logItem.acceptedAt || logItem.assignedAt || logItem.startTime || logItem.timestamp;
                const durStr = formatShiftDuration(startRef, now);
                logItem.endTime = now;

                if (logItem.acceptanceStatus === 'Pending-Acceptance') {
                    logItem.acceptanceStatus = 'Unaccepted-Reassigned';
                    logItem.unacceptedWaitDuration = durStr;
                    logItem.durationDisplay = `Did Not Accept for ${durStr} (Case Discharged)`;
                } else {
                    logItem.acceptanceStatus = 'Completed';
                    logItem.durationDisplay = `${durStr} (Shift Completed on Final Discharge)`;
                }
            }
        }

        if (!alreadyHasDischargedLog) {
            appointment.treatmentHistory.push({
                fromDoctorId: appointment.doctorId?._id || appointment.doctorId || null,
                toDoctorId: appointment.doctorId?._id || appointment.doctorId || null,
                action: 'Discharged',
                assignmentSource: 'Hospital-Admin',
                acceptanceStatus: 'Completed',
                assignedAt: now,
                acceptedAt: now,
                endTime: now,
                unacceptedWaitDuration: "0 mins",
                durationDisplay: "Final Bill Settled & Discharged",
                notes: dischargeNote || `Final discharge completed by Hospital Billing Desk. Actual Stay: ${actualStayDays} day(s) (${actualStayHours} hrs).`,
                timestamp: now,
                startTime: now
            });
        }

        // 4. Release Bed to Available & Sync Ward Capacity
        if (appointment.bedId) {
            const bedMongoId = appointment.bedId._id || appointment.bedId;
            await Bed.findByIdAndUpdate(bedMongoId, { $set: { status: 'Available' } });
        }

        await appointment.save();
        await syncHospitalWardAndBedCapacity(hospitalId);

        // 5. Notify Patient
        if (appointment.userId) {
            const notifMsg = unusedDaysRefund > 0
                ? `Your hospital stay (#${appointment.bookingId}) is complete. Early discharge refund of ₹${unusedDaysRefund} has been initiated.`
                : `Your hospital discharge (#${appointment.bookingId}) is complete. Wishing you a speedy recovery!`;

            sendPushNotification(
                appointment.userId._id || appointment.userId,
                'user',
                "🏥 Hospital Discharge Completed",
                notifMsg,
                {
                    type: 'HOSPITAL_DISCHARGE_COMPLETED',
                    serviceType: 'Hospital',
                    appointmentId: String(appointment._id),
                    bookingId: String(appointment.bookingId)
                }
            ).catch(() => {});
        }

        return res.status(200).json({
            success: true,
            message: unusedDaysRefund > 0
                ? `Discharge finalized! Unused stay refund of ₹${unusedDaysRefund} initiated for patient.`
                : "Patient discharged and final bill settled successfully.",
            settlementSummary: {
                bookedDays,
                actualStayHours,
                actualStayDays,
                depositAlreadyPaid,
                finalActualBill,
                unusedDaysRefund,
                pendingDepartureBalance,
                settlementStatus
            },
            data: appointment
        });

    } catch (error) {
        console.error("Generate Final Bill And Discharge Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// // @desc    Finalize Discharge Alias Route (Uses the exact same 24-Hour Dynamic Ledger & treatmentHistory Sync)
// // @route   POST /hospital/panel/finalize-discharge
// // @access  Private (Hospital Admin)
// const finalizeDischarge = async (req, res) => {
//     try {
//         return await generateFinalBillAndDischarge(req, res);
//     } catch (error) {
//         return res.status(500).json({
//             success: false,
//             message: error.message
//         });
//     }
// };




/////////////// --- 4. COUPON MANAGEMENT (Screenshot 18, 19) --- //////////////
const generateHospitalCoupon = async (req, res) => {
    try {
        const { 
            couponName, 
            discountPercentage, 
            maxDiscount, 
            minOrderAmount, 
            maxUsagePerUser, 
            startDate, 
            expiryDate 
        } = req.body;

        // Validation: Ensure required fields are present
        if (!couponName || !discountPercentage || !maxDiscount || !expiryDate) {
            return res.status(400).json({ message: "Please provide all required coupon fields" });
        }

        const coupon = await Coupon.create({
            creatorId: req.user.id,
            vendorId: req.user.id,
            vendorType: 'Hospital',
            couponName,
            discountPercentage,
            maxDiscount,
            minOrderAmount: minOrderAmount || 0,
            maxUsagePerUser: maxUsagePerUser || 1,
            startDate: startDate || Date.now(),
            expiryDate,
            isAdminCreated: false,
            isActive: true
        });

        res.status(201).json({ 
            success: true, 
            message: "Coupon Generated Successfully", 
            data: coupon 
        });
    } catch (error) { 
        // Handle unique constraint error (e.g., duplicate coupon code)
        if (error.code === 11000) {
            return res.status(400).json({ message: "Coupon code already exists" });
        }
        res.status(500).json({ message: error.message }); 
    }
};

const getHospitalCoupons = async (req, res) => {
    try {
        const hospitalId = req.user.id;

        // Query: 
        // 1. Jo is hospital ne banaye hain (vendorId === hospitalId)
        // 2. YA jo Admin ne banaye hain aur 'All' vendorType ke liye hain
        const coupons = await Coupon.find({
            $or: [
                { vendorId: hospitalId }, // Hospital ke khud ke coupons
                { isAdminCreated: true, vendorType: { $in: ['Hospital', 'All'] } } // Admin ke coupons
            ]
        }).sort({ createdAt: -1 });

        res.json({ 
            success: true, 
            count: coupons.length,
            data: coupons 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};
// EDIT COUPON
const updateHospitalCoupon = async (req, res) => {
    try {
        const { id } = req.params;
        const updated = await Coupon.findOneAndUpdate(
            { _id: id, vendorId: req.user.id },
            { $set: req.body },
            { new: true }
        );
        res.json({ success: true, message: "Coupon updated", data: updated });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// TOGGLE COUPON
const toggleCouponStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const coupon = await Coupon.findOne({ _id: id, vendorId: req.user.id });
        coupon.isActive = !coupon.isActive;
        await coupon.save();
        res.json({ success: true, message: `Coupon now ${coupon.isActive ? 'Active' : 'Inactive'}` });
    } catch (error) { res.status(500).json({ message: error.message }); }
};



// 1. LIST AMBULANCE DRIVERS FOR ASSIGNMENT (Screenshot 34)
const getAvailableDrivers = async (req, res) => {
    try {
        // 🚀 SYNC FIX: Strictly filters out inactive or unapproved ambulances
        const drivers = await Ambulance.find({ 
            hospitalId: req.user.id, 
            availableForEmergency: true,
            isActive: true,
            profileStatus: 'Approved'
        }).select('name phone vehicleNumber vehicleType experienceYears pricing');
        
        res.json({ success: true, count: drivers.length, data: drivers });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};
// 2. ASSIGN DRIVER TO CASE (Screenshot 35)
const assignDriverToCase = async (req, res) => {
    try {
        const { appointmentId, ambulanceId } = req.body;

        if (!appointmentId || !ambulanceId) {
            return res.status(400).json({ success: false, message: "Both appointmentId and ambulanceId are required." });
        }

        // 1. Fetch & Verify Ambulance
        const ambulance = await Ambulance.findById(ambulanceId);
        if (!ambulance) {
            return res.status(404).json({ success: false, message: "Ambulance not found." });
        }

        // 2. Mark Ambulance as Busy (Duty ON)
        ambulance.availableForEmergency = false;
        await ambulance.save();

        // 3. 🚀 SYNC FIX: Correctly link root-level ambulanceId & update status
        const appointment = await Appointment.findByIdAndUpdate(
            appointmentId,
            {
                $set: {
                    ambulanceId: ambulanceId, // 👈 Root-level reference
                    status: 'Confirmed',
                    'tracking.status': 'Driver Assigned'
                }
            },
            { new: true }
        );

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment record not found." });
        }

        // 4. Notify Driver via Push Notification
        const { sendPushNotification } = require('../../utils/notification');
        await sendPushNotification(
            ambulanceId,
            'ambulance',
            "🚨 New Case Assigned to You!",
            `Hospital has assigned you to emergency case #${appointment.bookingId}. Prepare for transit.`,
            { appointmentId: appointment._id.toString(), type: 'case_assigned' }
        );

        res.json({ 
            success: true, 
            message: "Driver Assigned successfully. Ambulance is now On Duty.",
            data: appointment
        });

    } catch (error) { 
        console.error("Assign Driver Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};


// 1. GET INCOMING REFERRALS (Screenshot 28)
// Updated: Added dynamic pagination and full bed population
const getIncomingReferrals = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { page = 1, limit = 10 } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 10);
        const skip = (pageNum - 1) * limitNum;

        const query = { 
            hospitalId: hospitalId, 
            bookingType: 'Admission', 
            status: 'Hospital-Pending' 
        };

        const totalRecords = await Appointment.countDocuments(query);

        const referrals = await Appointment.find(query)
            .populate('userId', 'name phone email profilePic age gender bloodGroup familyMember')
            .populate('ambulanceId', 'name vehicleNumber vehicleType')
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay status',
                populate: { path: 'wardId', select: 'name type' }
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum);

        const cleanedReferrals = referrals.map(appt => ({
            _id: appt._id,
            bookingId: appt.bookingId,
            status: appt.status,
            startDate: appt.startDate,
            endDate: appt.endDate,
            stayDuration: appt.stayDuration || 1,

            patientDetails: resolvePatientDTO(appt),

            bedDetails: appt.bedId ? {
                _id: appt.bedId._id,
                bedNumber: appt.bedId.bedNumber,
                pricePerDay: appt.bedId.pricePerDay,
                wardName: appt.bedId.wardId?.name || appt.wardName || "N/A"
            } : null,

            ambulanceDetails: appt.ambulanceId ? {
                _id: appt.ambulanceId._id,
                name: appt.ambulanceId.name,
                vehicleNumber: appt.ambulanceId.vehicleNumber || "N/A"
            } : null,

            billing: {
                totalAmount: appt.totalAmount || 0,
                paymentMethod: appt.paymentMethod || 'Online',
                paymentStatus: appt.paymentStatus || 'Pending'
            },

            bookedBy: appt.userId ? {
                userId: appt.userId._id,
                name: appt.userId.name,
                phone: appt.userId.phone,
                email: appt.userId.email
            } : null,

            createdAt: appt.createdAt
        }));

        res.json({ 
            success: true, 
            totalRecords,
            totalPages: Math.ceil(totalRecords / limitNum),
            currentPage: pageNum,
            count: cleanedReferrals.length,
            data: cleanedReferrals 
        });
    } catch (error) { 
        console.error("getIncomingReferrals Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};


// @desc    Get All Hospital Wards with Dynamic Available Beds & Hospital-Wide Bed Totals
// @route   GET /hospital/panel/wards/list
// @access  Private (Hospital Admin)
const getHospitalWards = async (req, res) => {
    try {
        const hospitalId = req.user.id;

        // 1. Sync holds and bed tallies before fetching
        await syncHospitalWardAndBedCapacity(hospitalId);

        // 2. Fetch all active wards for this hospital
        const wards = await Ward.find({ hospitalId, isActive: true }).sort({ createdAt: -1 }).lean();

        if (!wards || wards.length === 0) {
            return res.status(200).json({
                success: true,
                count: 0,
                totalBedsAllWards: 0,
                availableBedsAllWards: 0,
                summary: {
                    totalBeds: 0,
                    availableBeds: 0,
                    occupiedBeds: 0,
                    reservedBeds: 0,
                    maintenanceBeds: 0,
                    occupancyRate: "0%"
                },
                data: []
            });
        }

        // 3. Fetch all beds belonging to this hospital
        const allHospitalBeds = await Bed.find({ hospitalId }).lean();

        // 4. Calculate tallies per ward
        const enrichedWards = wards.map(ward => {
            const wardBeds = allHospitalBeds.filter(b => String(b.wardId) === String(ward._id));
            
            const totalCount = wardBeds.length;
            const occupiedCount = wardBeds.filter(b => b.status === 'Occupied').length;
            const reservedCount = wardBeds.filter(b => b.status === 'Reserved').length;
            const maintenanceCount = wardBeds.filter(b => b.status === 'Maintenance').length;
            const availableCount = wardBeds.filter(b => b.status === 'Available').length;
            const ventilatorCount = wardBeds.filter(b => Boolean(b.isVentilatorAvailable)).length;

            const activeInUse = occupiedCount + reservedCount;
            const rateNumeric = totalCount > 0 ? Math.round((activeInUse / totalCount) * 100) : 0;

            const prices = wardBeds.map(b => Number(b.pricePerDay || 0)).filter(p => p > 0);
            const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
            const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

            return {
                _id: ward._id,
                hospitalId: ward.hospitalId,
                name: ward.name,
                type: ward.type, // 'Ward' or 'ICU'
                totalBeds: totalCount,
                availableBeds: availableCount,
                occupiedBeds: occupiedCount,
                reservedBeds: reservedCount,
                maintenanceBeds: maintenanceCount,
                ventilatorBedsCount: ventilatorCount,
                occupancyRate: `${rateNumeric}%`,
                occupancyRateNumeric: rateNumeric,
                pricePerDay: minPrice,
                priceRange: minPrice === maxPrice ? `₹${minPrice}` : `₹${minPrice} - ₹${maxPrice}`,
                isActive: ward.isActive !== false,
                createdAt: ward.createdAt,
                updatedAt: ward.updatedAt
            };
        });

        // 5. Calculate Hospital-Wide Totals across all wards
        const totalBedsAll = allHospitalBeds.length;
        const availableBedsAll = allHospitalBeds.filter(b => b.status === 'Available').length;
        const occupiedBedsAll = allHospitalBeds.filter(b => b.status === 'Occupied').length;
        const reservedBedsAll = allHospitalBeds.filter(b => b.status === 'Reserved').length;
        const maintenanceBedsAll = allHospitalBeds.filter(b => b.status === 'Maintenance').length;
        const overallRate = totalBedsAll > 0 ? Math.round(((occupiedBedsAll + reservedBedsAll) / totalBedsAll) * 100) : 0;

        res.status(200).json({
            success: true,
            count: enrichedWards.length,
            // Direct summary for top of the screen
            totalBedsAllWards: totalBedsAll,
            availableBedsAllWards: availableBedsAll,
            occupiedBedsAllWards: occupiedBedsAll,
            reservedBedsAllWards: reservedBedsAll,
            maintenanceBedsAllWards: maintenanceBedsAll,
            summary: {
                totalBeds: totalBedsAll,
                availableBeds: availableBedsAll,
                occupiedBeds: occupiedBedsAll,
                reservedBeds: reservedBedsAll,
                maintenanceBeds: maintenanceBedsAll,
                occupancyRate: `${overallRate}%`,
                occupancyRateNumeric: overallRate
            },
            data: enrichedWards
        });

    } catch (error) {
        console.error("Get Hospital Wards Error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch wards list: " + error.message
        });
    }
};

// 2. UPDATE WARD INFO
const updateWardInfo = async (req, res) => {
    try {
        const { wardId } = req.params;
        const { name, type, isActive } = req.body;
        
        const ward = await Ward.findOneAndUpdate(
            { _id: wardId, hospitalId: req.user.id },
            { $set: { name, type, isActive } },
            { new: true }
        );

        if (!ward) return res.status(404).json({ message: "Ward not found" });
        res.json({ success: true, message: "Ward updated", data: ward });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. DELETE WARD (Only if empty)
const deleteWard = async (req, res) => {
    try {
        const { wardId } = req.params;
        const hospitalId = req.user.id;

        // Check if any bed is occupied
        const occupiedBeds = await Bed.findOne({ wardId, status: { $ne: 'Available' } });
        if (occupiedBeds) {
            return res.status(400).json({ message: "Cannot delete ward while beds are occupied or reserved." });
        }

        await Bed.deleteMany({ wardId }); // Pehle beds delete karein
        await Ward.findOneAndDelete({ _id: wardId, hospitalId });

        res.json({ success: true, message: "Ward and its beds removed successfully." });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// @desc    Get All Hospital IPD Admissions (With Selected Doctor, Special Services, Bed & Lightweight Insurance Details)
// @route   GET /hospital/panel/admissions/all
// @access  Private (Hospital Admin)
const getAllHospitalAdmissions = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { status, triageLevel, search, page = 1, limit = 20, startDate, endDate } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 20);
        const skip = (pageNum - 1) * limitNum;

        // Auto-sync holds before querying
        await syncHospitalWardAndBedCapacity(hospitalId);

        let query = {
            hospitalId,
            bookingType: 'Admission'
        };

        if (status && status !== 'All') {
            query.status = status;
        }

        if (triageLevel && triageLevel !== 'All') {
            query.triageLevel = triageLevel;
        }

        if (startDate && endDate) {
            query.startDate = {
                $gte: moment(startDate).startOf('day').toDate(),
                $lte: moment(endDate).endOf('day').toDate()
            };
        }

        if (search && search.trim() !== '') {
            const cleanSearch = search.trim();
            query.$or = [
                { bookingId: { $regex: cleanSearch, $options: 'i' } },
                { 'patients.patientName': { $regex: cleanSearch, $options: 'i' } },
                { bedNumber: { $regex: cleanSearch, $options: 'i' } },
                { wardName: { $regex: cleanSearch, $options: 'i' } }
            ];
        }

        const totalRecords = await Appointment.countDocuments(query);

        // Fetch admissions with deep population of Doctor, Special Services, Bed, Ambulance, and Master Insurance
        const admissions = await Appointment.find(query)
            .populate('userId', 'name phone email profilePic gender dob age')
            .populate('doctorId', 'name speciality department profileImage qualification phone fees')
            .populate({
                path: 'bedId',
                select: 'bedNumber status pricePerDay isVentilatorAvailable wardId',
                populate: { path: 'wardId', select: 'name type' }
            })
            .populate('ambulanceId', 'name vehicleNumber vehicleType phone driverInfo')
            .populate('specialServices.serviceId', 'serviceName price image description')
            .populate('opdAppointmentId', 'bookingId tokenNumber opdRoomNumber')
            .populate('insuranceDetails.masterInsuranceId', 'provider insuranceName type') // 👈 Populated Master Insurance
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean();

        const formattedData = admissions.map(item => {
            const primaryPatient = (Array.isArray(item.patients) && item.patients.length > 0)
                ? item.patients[0]
                : { patientName: item.userId?.name || "Patient", patientAge: "N/A", gender: "N/A", relation: "Self" };

            // 🚨 RESOLVE & FORMAT SPECIAL SERVICES SELECTED AT BOOKING
            const formattedServices = (item.specialServices || []).map(srv => ({
                serviceId: srv.serviceId?._id || srv.serviceId || null,
                serviceName: srv.serviceId?.serviceName || srv.serviceName || "Special Service",
                price: Number(srv.price || srv.serviceId?.price || 0),
                image: srv.serviceId?.image || null,
                description: srv.serviceId?.description || ""
            }));

            const totalSpecialServicesCharges = formattedServices.reduce((sum, s) => sum + s.price, 0);

            // Compute stay duration
            let stayDays = Number(item.stayDuration || 1);
            if (item.startDate && item.endDate) {
                stayDays = Math.max(1, moment(item.endDate).diff(moment(item.startDate), 'days') + 1);
            }

            const isInsured = Boolean(item.insuranceDetails?.hasInsurance);

            return {
                _id: item._id,
                bookingId: item.bookingId,
                status: item.status,
                triageLevel: item.triageLevel || 'Routine',
                bookingReason: item.bookingReason || "Hospital In-Patient Admission",
                startDate: item.startDate,
                endDate: item.endDate,
                stayDurationDays: stayDays,

                // Primary Patient Details
                patient: {
                    name: primaryPatient.patientName,
                    age: primaryPatient.patientAge,
                    gender: primaryPatient.gender,
                    relation: primaryPatient.relation,
                    phone: item.address?.phone || item.userId?.phone || "N/A",
                    bloodGroup: primaryPatient.bloodGroup || item.userId?.bloodGroup || null
                },
                allPatients: item.patients || [],

                // 🩺 SELECTED DOCTOR DETAILS (From Booking)
                doctor: item.doctorId ? {
                    _id: item.doctorId._id,
                    name: item.doctorId.name,
                    speciality: item.doctorId.speciality,
                    department: item.doctorId.department?.roomNumber || "Cabin",
                    qualification: item.doctorId.qualification || "",
                    phone: item.doctorId.phone || "",
                    profileImage: item.doctorId.profileImage || null
                } : null,
                doctorDisplayName: item.doctorId ? `Dr. ${item.doctorId.name} (${item.doctorId.speciality})` : "Unassigned",

                // 🛎️ SELECTED SPECIAL SERVICES (From Booking)
                specialServices: formattedServices,
                totalSpecialServicesCharges,
                hasSpecialServices: formattedServices.length > 0,

                // 🛏️ BED & WARD DETAILS
                bed: {
                    bedId: item.bedId?._id || null,
                    bedNumber: item.bedNumber || item.bedId?.bedNumber || "Unassigned",
                    wardName: item.wardName || item.bedId?.wardId?.name || "General Ward",
                    wardType: item.bedId?.wardId?.type || "Ward",
                    pricePerDay: Number(item.bedId?.pricePerDay || 0),
                    isVentilatorAvailable: Boolean(item.bedId?.isVentilatorAvailable)
                },

                // 🚑 AMBULANCE ARRIVAL DETAILS (If transferred or accidental)
                ambulance: item.ambulanceId ? {
                    _id: item.ambulanceId._id,
                    name: item.ambulanceId.name,
                    vehicleNumber: item.ambulanceId.vehicleNumber,
                    vehicleType: item.ambulanceId.vehicleType,
                    phone: item.ambulanceId.phone
                } : null,

                // Financials & Payment
                pricingBreakdown: item.pricingBreakdown || {},
                totalAmount: Number(item.totalAmount || 0),
                paymentMethod: item.paymentMethod || 'COD',
                paymentStatus: item.paymentStatus || 'Pending',

                // 🚨 PRESERVED & HIGHLIGHTED INSURANCE DETAILS (Lightweight DTO)
                hasInsurance: isInsured,
                insuranceApprovalStatus: item.insuranceDetails?.approvalStatus || 'None',
                insuranceClaimStatus: isInsured 
                    ? (item.insuranceDetails?.approvalStatus || 'Pending') 
                    : 'Self-Pay (No Insurance)',
                insurance: isInsured ? {
                    insuranceNumber: item.insuranceDetails?.insuranceNumber || "N/A",
                    companyName: item.insuranceDetails?.companyName || item.insuranceDetails?.masterInsuranceId?.insuranceName || "N/A",
                    provider: item.insuranceDetails?.masterInsuranceId?.provider || "N/A",
                    insuranceType: item.insuranceDetails?.insuranceType || item.insuranceDetails?.masterInsuranceId?.type || "Cashless",
                    approvalStatus: item.insuranceDetails?.approvalStatus || 'Pending',
                    approvalLetterPdf: item.insuranceDetails?.approvalLetterPdf || null,
                    cardFrontImage: item.insuranceDetails?.insuranceDocumentFront || null,
                    cardBackImage: item.insuranceDetails?.insuranceDocumentBack || null
                } : null,

                // 30-Minute Hold Window Metadata
                admissionHoldExpiresAt: item.admissionHoldExpiresAt,
                isHoldActive: Boolean(item.admissionHoldExpiresAt && new Date(item.admissionHoldExpiresAt) > new Date()),

                createdAt: item.createdAt,
                updatedAt: item.updatedAt
            };
        });

        return res.status(200).json({
            success: true,
            totalRecords,
            totalPages: Math.ceil(totalRecords / limitNum),
            currentPage: pageNum,
            count: formattedData.length,
            data: formattedData
        });

    } catch (error) {
        console.error("Get All Hospital Admissions Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch admissions list: " + error.message
        });
    }
};


// --- GET EMERGENCY CASES (Strictly Cases Brought by Ambulance) ---
// Endpoint: GET /hospital/panel/emergency-cases?page=1&limit=10
const getEmergencyCases = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { page = 1, limit = 10 } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 10);
        const skip = (pageNum - 1) * limitNum;

        // 🚨 Strict Filter: ONLY Cases with an Ambulance
        const query = { 
            hospitalId: hospitalId, 
            ambulanceId: { $ne: null, $exists: true },
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending', 'Discharge-Pending'] }
        };

        const totalRecords = await Appointment.countDocuments(query);

        const appointments = await Appointment.find(query)
            .populate('userId', 'name profilePic phone age gender email bloodGroup familyMember')
            .populate('ambulanceId', 'name vehicleNumber vehicleType')
            .populate('doctorId', 'name speciality profileImage')
            .populate({
                path: 'bedId',
                select: 'bedNumber status pricePerDay',
                populate: { path: 'wardId', select: 'name type' }
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum);

        const cleanedEmergency = await Promise.all(appointments.map(async (appt) => {
            const booking = await AmbulanceBooking.findOne({
                $or: [
                    { bookingId: appt.bookingId },
                    { bookingId: appt.transactionId } 
                ]
            }).select('patientDetails caseReference serviceType triageLevel').lean();

            return {
                _id: appt._id,
                bookingId: appt.bookingId,
                caseReference: booking ? booking.caseReference : null,
                serviceType: booking ? booking.serviceType : "Emergency Ambulance",
                caseCategory: "Emergency",
                triageLevel: appt.triageLevel || "Emergency",
                status: appt.status,
                startDate: appt.startDate,

                patientDetails: resolvePatientDTO(appt),

                bedDetails: appt.bedId ? {
                    _id: appt.bedId._id,
                    bedNumber: appt.bedId.bedNumber || appt.bedNumber || "N/A",
                    status: appt.bedId.status,
                    wardName: appt.bedId.wardId?.name || appt.wardName || "Emergency Ward"
                } : null,

                ambulanceDetails: appt.ambulanceId ? {
                    _id: appt.ambulanceId._id,
                    name: appt.ambulanceId.name,
                    vehicleNumber: appt.ambulanceId.vehicleNumber || "N/A",
                    vehicleType: appt.ambulanceId.vehicleType || "ALS"
                } : null,

                assignedDoctor: appt.doctorId ? {
                    _id: appt.doctorId._id,
                    name: appt.doctorId.name,
                    speciality: appt.doctorId.speciality,
                    profileImage: appt.doctorId.profileImage || null
                } : null,

                emergencyPhotos: booking?.patientDetails ? {
                    userIncidentPhoto: booking.patientDetails.incidentPhoto || null,
                    driverOnSpotPhoto: booking.patientDetails.driverOnSpotPhoto || null,
                    referralCard: booking.patientDetails.referralCard || null,
                    emergencyDescription: booking.patientDetails.emergencyDescription || ""
                } : null,

                createdAt: appt.createdAt
            };
        }));

        res.json({ 
            success: true, 
            totalRecords,
            totalPages: Math.ceil(totalRecords / limitNum),
            currentPage: pageNum,
            count: cleanedEmergency.length, 
            data: cleanedEmergency 
        });
    } catch (error) { 
        console.error("getEmergencyCases Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- TRACK AMBULANCES (Hospital Admin Fleet Map) ---
// Updated: Calculates live distance between hospital base and ambulance coordinates instead of static "2.3 km"
const trackAllAmbulances = async (req, res) => {
    try {
        const hospitalId = req.user.id;

        const [hospital, ambulances] = await Promise.all([
            Hospital.findById(hospitalId).select('location'),
            Ambulance.find({ hospitalId: hospitalId })
                .select('name vehicleNumber vehicleType availableForEmergency location driverInfo phone')
        ]);

        const hospLat = hospital?.location?.lat || 30.7046;
        const hospLng = hospital?.location?.lng || 76.7179;

        const stats = {
            total: ambulances.length,
            available: ambulances.filter(a => a.availableForEmergency).length,
            onDuty: ambulances.filter(a => !a.availableForEmergency).length,
            maintenance: 0
        };

        // 🚀 DYNAMIC DISTANCE CALCULATION for each ambulance relative to hospital base
        const formattedData = await Promise.all(ambulances.map(async (amb) => {
            let distanceStr = "At Base";
            let etaStr = "Stationary";

            if (!amb.availableForEmergency && amb.location?.lat) {
                const rawDist = await getDistance(hospLat, hospLng, amb.location.lat, amb.location.lng);
                distanceStr = `${rawDist.toFixed(1)} km`;
                etaStr = `${Math.max(1, Math.round(rawDist * 3))} mins`;
            }

            return {
                _id: amb._id,
                ambulanceCode: amb.name,
                driverName: amb.driverInfo?.fullName || "Not Assigned",
                vehicleNumber: amb.vehicleNumber || "N/A",
                type: amb.vehicleType,
                status: amb.availableForEmergency ? 'Available' : 'On Duty',
                contactNumber: amb.phone,
                liveLocation: {
                    lat: amb.location?.lat || 0,
                    lng: amb.location?.lng || 0
                },
                eta: etaStr,
                distance: distanceStr
            };
        }));

        res.json({ 
            success: true, 
            stats, 
            data: formattedData 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


const toggleAmbulanceStatus = async (req, res) => {
    try {
        const { ambulanceId, status } = req.body; // status: 'Available' or 'Maintenance'

        const update = {
            availableForEmergency: status === 'Available' ? true : false,
            // Agar status maintenance hai toh is key ko hum use kar sakte hain logic mein
        };

        const amb = await Ambulance.findByIdAndUpdate(ambulanceId, update, { new: true });
        res.json({ success: true, message: `Ambulance is now ${status}`, data: amb });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// --- 1. MANAGE TERMS & CONDITIONS (Screenshot 31) ---
const updateHospitalTerms = async (req, res) => {
    try {
        const { terms } = req.body;
        const hospital = await Hospital.findByIdAndUpdate(
            req.user.id,
            { $set: { termsAndConditions: terms } },
            { new: true }
        );
        res.json({ success: true, message: "Terms & Conditions Updated", data: hospital.termsAndConditions });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getHospitalTerms = async (req, res) => {
    try {
        const hospital = await Hospital.findById(req.params.id || req.user.id).select('termsAndConditions');
        res.json({ success: true, data: hospital.termsAndConditions });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 2. GET HOSPITAL & AMBULANCE RATINGS (Screenshot 25, 26) ---
// Endpoint: GET /hospital/panel/ratings?targetType=Hospital (or ?targetType=Ambulance or ?targetType=All)
const getHospitalPanelRatings = async (req, res) => {
    try {
        const { targetType = 'Hospital' } = req.query; // 👈 Defaults cleanly to 'Hospital'
        const hospitalId = req.user.id;

        let query = {};
        if (targetType === 'Hospital') {
            query = { targetId: hospitalId, targetType: 'Hospital' };
        } else if (targetType === 'Ambulance') {
            const ambulances = await Ambulance.find({ hospitalId }).select('_id');
            const ambIds = ambulances.map(a => a._id);
            query = { targetId: { $in: ambIds }, targetType: 'Ambulance' };
        } else {
            // All reviews (Hospital + All Fleet Ambulances)
            const ambulances = await Ambulance.find({ hospitalId }).select('_id');
            const allTargetIds = [hospitalId, ...ambulances.map(a => a._id)];
            query = { targetId: { $in: allTargetIds } };
        }

        const reviews = await Review.find(query)
            .populate('userId', 'name profilePic')
            .sort({ createdAt: -1 });

        res.json({ success: true, count: reviews.length, targetType, data: reviews });
    } catch (error) { 
        console.error("getHospitalPanelRatings Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- GET DAILY WARD BED OCCUPANCY (Strict Day-Boundary Overlap Sync) ---
// Endpoint: GET /hospital/panel/daily-occupancy?wardId=...&date=YYYY-MM-DD
// @desc    Get Comprehensive Daily Hospital Bed Occupancy Analytics & Today's Inpatient Movement
// @route   GET /hospital/panel/daily-occupancy
// @access  Private (Hospital Admin)
const getDailyOccupancy = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const now = new Date();

        // 1. Run sync to ensure holds and bed statuses match live reality
        await syncHospitalWardAndBedCapacity(hospitalId);

        // 2. Fetch all hospital wards and beds
        const [wards, allBeds] = await Promise.all([
            Ward.find({ hospitalId, isActive: true }).lean(),
            Bed.find({ hospitalId }).sort({ bedNumber: 1 }).lean()
        ]);

        const totalBeds = allBeds.length;
        const occupiedBeds = allBeds.filter(b => b.status === 'Occupied').length;
        const reservedBeds = allBeds.filter(b => b.status === 'Reserved').length;
        const maintenanceBeds = allBeds.filter(b => b.status === 'Maintenance').length;
        const availableBeds = allBeds.filter(b => b.status === 'Available').length;
        const ventilatorBedsTotal = allBeds.filter(b => Boolean(b.isVentilatorAvailable)).length;
        const ventilatorBedsAvailable = allBeds.filter(b => Boolean(b.isVentilatorAvailable) && b.status === 'Available').length;

        // Overall hospital occupancy percentage (Safe from division by zero)
        const totalActiveInUse = occupiedBeds + reservedBeds;
        const occupancyRateNumeric = totalBeds > 0 ? Math.round((totalActiveInUse / totalBeds) * 100) : 0;
        const availableRateNumeric = totalBeds > 0 ? Math.round((availableBeds / totalBeds) * 100) : 0;

        // 3. Calculate Today's Activity (Strict IST midnight boundaries)
        const startOfToday = moment().startOf('day').toDate();
        const endOfToday = moment().endOf('day').toDate();

        const [admissionsToday, dischargesToday, pendingDischargesCount, emergencyAdmissionsToday] = await Promise.all([
            // Admissions checked-in today
            Appointment.countDocuments({
                hospitalId,
                bookingType: 'Admission',
                status: { $in: ['In-Progress', 'Discharge-Pending', 'Completed'] },
                startDate: { $gte: startOfToday, $lte: endOfToday }
            }),
            // Discharged finalized today
            Appointment.countDocuments({
                hospitalId,
                bookingType: 'Admission',
                status: 'Completed',
                $or: [
                    { 'clinicalSummary.dischargedAt': { $gte: startOfToday, $lte: endOfToday } },
                    { updatedAt: { $gte: startOfToday, $lte: endOfToday } }
                ]
            }),
            // Currently pending discharge approval
            Appointment.countDocuments({
                hospitalId,
                bookingType: 'Admission',
                status: 'Discharge-Pending'
            }),
            // Admissions that came via 108/Emergency
            Appointment.countDocuments({
                hospitalId,
                bookingType: 'Admission',
                status: { $in: ['In-Progress', 'Discharge-Pending'] },
                $or: [
                    { triageLevel: 'Emergency' },
                    { bedBookingType: 'Emergency-Bed' }
                ],
                startDate: { $gte: startOfToday, $lte: endOfToday }
            })
        ]);

        const routineAdmissionsToday = Math.max(0, admissionsToday - emergencyAdmissionsToday);

        // 4. Ward-by-ward detailed occupancy breakdown
        const wardsOccupancy = wards.map(ward => {
            const wardBeds = allBeds.filter(b => String(b.wardId) === String(ward._id));
            const wTotal = wardBeds.length;
            const wOccupied = wardBeds.filter(b => b.status === 'Occupied').length;
            const wReserved = wardBeds.filter(b => b.status === 'Reserved').length;
            const wMaintenance = wardBeds.filter(b => b.status === 'Maintenance').length;
            const wAvailable = wardBeds.filter(b => b.status === 'Available').length;
            const wVentilator = wardBeds.filter(b => Boolean(b.isVentilatorAvailable)).length;

            const wActiveInUse = wOccupied + wReserved;
            const wRate = wTotal > 0 ? Math.round((wActiveInUse / wTotal) * 100) : 0;

            return {
                wardId: ward._id,
                wardName: ward.name,
                type: ward.type,
                totalBeds: wTotal,
                availableBeds: wAvailable,
                occupiedBeds: wOccupied,
                reservedBeds: wReserved,
                maintenanceBeds: wMaintenance,
                ventilatorBeds: wVentilator,
                occupancyRate: `${wRate}%`,
                occupancyRateNumeric: wRate
            };
        });

        // 5. Fetch Active Inpatient Bed Occupants list for quick hospital inspection
        const occupiedBedIds = allBeds.filter(b => b.status === 'Occupied' || b.status === 'Reserved').map(b => b._id);
        const activeAppointments = await Appointment.find({
            hospitalId,
            bedId: { $in: occupiedBedIds },
            bookingType: 'Admission',
            status: { $in: ['In-Progress', 'Discharge-Pending', 'Hospital-Pending', 'Confirmed'] }
        })
        .populate('userId', 'name phone profilePic')
        .populate('doctorId', 'name speciality department')
        .select('bookingId bedId wardName bedNumber status startDate endDate triageLevel patients admissionHoldExpiresAt')
        .lean();

        const currentInpatients = activeAppointments.map(appt => {
            const isHold = Boolean(appt.admissionHoldExpiresAt && new Date(appt.admissionHoldExpiresAt) > now);
            const patientName = appt.patients?.[0]?.patientName || appt.userId?.name || "Patient";
            const patientAge = appt.patients?.[0]?.patientAge || "N/A";
            const gender = appt.patients?.[0]?.gender || "N/A";

            let daysStayed = 1;
            if (appt.startDate) {
                daysStayed = Math.max(1, moment().diff(moment(appt.startDate), 'days') + 1);
            }

            return {
                appointmentId: appt._id,
                bookingId: appt.bookingId,
                bedId: appt.bedId,
                bedNumber: appt.bedNumber,
                wardName: appt.wardName,
                patientName,
                patientAge,
                gender,
                doctorName: appt.doctorId?.name || "Unassigned",
                doctorSpeciality: appt.doctorId?.speciality || "",
                admittedDate: appt.startDate,
                daysStayed,
                status: isHold ? 'Hold-Reserved' : appt.status,
                triageLevel: appt.triageLevel || 'Routine',
                holdExpiresAt: isHold ? appt.admissionHoldExpiresAt : null
            };
        });

        // 6. Final Consolidated Response (Both flat & structured for 100% frontend safety)
        const summaryObj = {
            totalBeds,
            occupiedBeds,
            reservedBeds,
            availableBeds,
            maintenanceBeds,
            ventilatorBedsTotal,
            ventilatorBedsAvailable,
            occupancyRate: `${occupancyRateNumeric}%`,
            occupancyRateNumeric,
            availableRate: `${availableRateNumeric}%`,
            availableRateNumeric
        };

        const todayActivityObj = {
            admissionsToday,
            dischargesToday,
            pendingDischarges: pendingDischargesCount,
            emergencyAdmissions: emergencyAdmissionsToday,
            routineAdmissions: routineAdmissionsToday
        };

        return res.status(200).json({
            success: true,
            data: {
                date: moment().format('YYYY-MM-DD'),
                // Flat keys for direct access:
                totalBeds,
                occupiedBeds,
                reservedBeds,
                availableBeds,
                maintenanceBeds,
                occupancyRate: `${occupancyRateNumeric}%`,
                // Structured groups for dashboard blocks:
                summary: summaryObj,
                todayActivity: todayActivityObj,
                wardsOccupancy,
                wardBreakdown: wardsOccupancy, // Alias for backward compatibility
                currentInpatients
            }
        });

    } catch (error) {
        console.error("Get Daily Occupancy Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch daily occupancy: " + error.message
        });
    }
};

// @desc    Finalize Patient Discharge, Settle 24-Hour Dynamic Ledger, Close Active Doctor Shift & Release Bed
// @route   POST /hospital/panel/finalize-discharge
// @access  Private (Hospital Admin)
const finalizeDischarge = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const {
            appointmentId,
            extraCharges = 0,
            discountAmount = 0,
            dischargeNote,
            paymentMethod
        } = req.body;

        if (!appointmentId) {
            return res.status(400).json({
                success: false,
                message: "appointmentId is required to finalize discharge."
            });
        }

        const isObjId = mongoose.isValidObjectId(appointmentId);
        const query = {
            hospitalId,
            ...(isObjId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const appointment = await Appointment.findOne(query)
            .populate('bedId')
            .populate('userId', 'name phone fcmToken')
            .populate('doctorId', 'name speciality');

        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Admission record not found in this hospital."
            });
        }

        const now = new Date();
        const admissionStart = appointment.startDate
            ? new Date(appointment.startDate)
            : new Date(appointment.createdAt);

        // 1. 24-Hour Dynamic Stay Calculation
        const diffMs = Math.max(0, now.getTime() - admissionStart.getTime());
        const actualStayHours = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
        const actualStayDays = Math.max(1, Math.ceil(actualStayHours / 24));
        const bookedDays = Math.max(
            1,
            Number(appointment.stayDuration || appointment.pricingBreakdown?.bookedDurationDays || 1)
        );

        const bedPricePerDay = Number(
            appointment.bedId?.pricePerDay ||
            (Number(appointment.pricingBreakdown?.baseFee || 1000) / bookedDays)
        );

        const specialServicesSum = (appointment.specialServices || []).reduce(
            (sum, s) => sum + Number(s.price || 0),
            0
        );

        const actualRoomCharges = bedPricePerDay * actualStayDays;
        const visitCharges = Number(appointment.pricingBreakdown?.visitCharges || 0);
        const totalExtra = Number(extraCharges || 0) + specialServicesSum;
        const totalDiscount = Number(discountAmount || appointment.pricingBreakdown?.discountAmount || 0);

        const finalActualBill = Math.max(
            0,
            Math.round(actualRoomCharges + visitCharges + totalExtra - totalDiscount)
        );

        const depositAlreadyPaid = appointment.paymentStatus === 'Paid'
            ? Number(appointment.pricingBreakdown?.depositPaidOnBooking || appointment.totalAmount || 0)
            : 0;

        let unusedDaysRefund = 0;
        let pendingDepartureBalance = 0;
        let settlementStatus = 'Settled';

        if (depositAlreadyPaid > finalActualBill) {
            unusedDaysRefund = Math.round(depositAlreadyPaid - finalActualBill);
            settlementStatus = 'Refund-Initiated';
            appointment.paymentStatus = 'Refund-Initiated';
        } else if (finalActualBill > depositAlreadyPaid) {
            pendingDepartureBalance = Math.round(finalActualBill - depositAlreadyPaid);
            settlementStatus = 'Settled';
            appointment.paymentStatus = 'Paid';
        } else {
            settlementStatus = 'Settled';
            appointment.paymentStatus = 'Paid';
        }

        if (paymentMethod) {
            appointment.paymentMethod = paymentMethod;
        }

        // 2. Update Pricing Breakdown Ledger
        if (!appointment.pricingBreakdown) appointment.pricingBreakdown = {};
        appointment.pricingBreakdown.bookedDurationDays = bookedDays;
        appointment.pricingBreakdown.actualStayHours = actualStayHours;
        appointment.pricingBreakdown.actualStayDays = actualStayDays;
        appointment.pricingBreakdown.depositPaidOnBooking = depositAlreadyPaid;
        appointment.pricingBreakdown.unusedDaysRefund = unusedDaysRefund;
        appointment.pricingBreakdown.refundDueToUser = unusedDaysRefund;
        appointment.pricingBreakdown.pendingDepartureBalance = pendingDepartureBalance;
        appointment.pricingBreakdown.extraCharges = totalExtra;
        appointment.pricingBreakdown.discountAmount = totalDiscount;
        appointment.pricingBreakdown.subtotal = actualRoomCharges + visitCharges + totalExtra;
        appointment.pricingBreakdown.settlementStatus = settlementStatus;

        appointment.totalAmount = finalActualBill;
        appointment.status = 'Completed';
        appointment.endDate = now;

        if (!appointment.clinicalSummary) appointment.clinicalSummary = {};
        appointment.clinicalSummary.dischargedAt = now;
        if (dischargeNote) {
            appointment.clinicalSummary.dischargeNote = dischargeNote;
        }

        // 3. Close any open shift in treatmentHistory & record final Discharged log
        if (!Array.isArray(appointment.treatmentHistory)) {
            appointment.treatmentHistory = [];
        }

        let alreadyHasDischargedLog = false;
        for (let i = appointment.treatmentHistory.length - 1; i >= 0; i--) {
            const logItem = appointment.treatmentHistory[i];
            if (!logItem) continue;

            if (logItem.action === 'Discharged') {
                alreadyHasDischargedLog = true;
            }

            if (!logItem.endTime) {
                const startRef = logItem.acceptedAt || logItem.assignedAt || logItem.startTime || logItem.timestamp;
                const durStr = formatShiftDuration(startRef, now);
                logItem.endTime = now;

                if (logItem.acceptanceStatus === 'Pending-Acceptance') {
                    logItem.acceptanceStatus = 'Unaccepted-Reassigned';
                    logItem.unacceptedWaitDuration = durStr;
                    logItem.durationDisplay = `Did Not Accept for ${durStr} (Case Discharged)`;
                } else {
                    logItem.acceptanceStatus = 'Completed';
                    logItem.durationDisplay = `${durStr} (Shift Completed on Final Discharge)`;
                }
            }
        }

        if (!alreadyHasDischargedLog) {
            appointment.treatmentHistory.push({
                fromDoctorId: appointment.doctorId?._id || appointment.doctorId || null,
                toDoctorId: appointment.doctorId?._id || appointment.doctorId || null,
                action: 'Discharged',
                assignmentSource: 'Hospital-Admin',
                acceptanceStatus: 'Completed',
                assignedAt: now,
                acceptedAt: now,
                endTime: now,
                unacceptedWaitDuration: "0 mins",
                durationDisplay: "Final Bill Settled & Discharged",
                notes: dischargeNote || `Final discharge completed by Hospital Billing Desk. Actual Stay: ${actualStayDays} day(s) (${actualStayHours} hrs).`,
                timestamp: now,
                startTime: now
            });
        }

        // 4. Release Bed to Available & Sync Ward Capacity
        if (appointment.bedId) {
            const bedMongoId = appointment.bedId._id || appointment.bedId;
            await Bed.findByIdAndUpdate(bedMongoId, { $set: { status: 'Available' } });
        }

        await appointment.save();
        await syncHospitalWardAndBedCapacity(hospitalId);

        // 5. Notify Patient via Push Notification
        if (appointment.userId) {
            const notifMsg = unusedDaysRefund > 0
                ? `Your hospital stay (#${appointment.bookingId}) is complete. Early discharge refund of ₹${unusedDaysRefund} has been initiated.`
                : `Your hospital discharge (#${appointment.bookingId}) is complete. Wishing you a speedy recovery!`;

            sendPushNotification(
                appointment.userId._id || appointment.userId,
                'user',
                "🏥 Hospital Discharge Completed",
                notifMsg,
                {
                    type: 'HOSPITAL_DISCHARGE_COMPLETED',
                    serviceType: 'Hospital',
                    appointmentId: String(appointment._id),
                    bookingId: String(appointment.bookingId)
                }
            ).catch(() => {});
        }

        return res.status(200).json({
            success: true,
            message: unusedDaysRefund > 0
                ? `Discharge finalized! Unused stay refund of ₹${unusedDaysRefund} initiated for patient.`
                : "Patient discharged and final bill settled successfully.",
            settlementSummary: {
                bookedDays,
                actualStayHours,
                actualStayDays,
                depositAlreadyPaid,
                finalActualBill,
                unusedDaysRefund,
                pendingDepartureBalance,
                settlementStatus
            },
            data: appointment
        });

    } catch (error) {
        console.error("Finalize Discharge Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

const setHospitalShift = async (req, res) => {
    try {
        const { morning, afternoon, evening, startTime, endTime } = req.body;

        const config = await Availability.findOneAndUpdate(
            { vendorId: req.user.id },
            { 
                vendorId: req.user.id,
                vendorType: 'Hospital',
                morningSlots: morning,
                afternoonSlots: afternoon,
                eveningSlots: evening,
                startTime, 
                endTime 
            },
            { upsert: true, new: true }
        );

        res.json({ success: true, message: "Shift timings updated", data: config });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getHospitalReferralBookings = async (req, res) => {
    try {
        const hospitalId = req.user.id; // Logged-in Hospital ID
        const { type, page = 1, limit = 10 } = req.query; 

        let query = { 
            serviceType: 'Referral Ambulance' 
        };

        // Logic: 
        // 1. Incoming: Patient is coming TO this hospital (hospitalId)
        // 2. Outgoing: Patient is going FROM this hospital (pickupHospitalId)
        // 3. All: Both scenarios
        if (type === 'incoming') {
            query.hospitalId = hospitalId;
        } else if (type === 'outgoing') {
            query.pickupHospitalId = hospitalId;
        } else {
            query.$or = [
                { hospitalId: hospitalId },
                { pickupHospitalId: hospitalId }
            ];
        }

        const bookings = await Booking.find(query)
            .populate('userId', 'name phone profilePic')
            .populate('ambulanceId', 'name vehicleNumber phone vehicleType')
            .populate('pickupHospitalId', 'name address')
            .populate('hospitalId', 'name address')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(Number(limit));

        const total = await Booking.countDocuments(query);

        res.json({
            success: true,
            totalRecords: total,
            currentPage: Number(page),
            totalPages: Math.ceil(total / limit),
            data: bookings
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- API 1: UPDATE BED PRICE (Supports both single bed update and bulk ward update) ---
const updateBedPrice = async (req, res) => {
    try {
        const { bedId, wardId, pricePerDay } = req.body;

        if (!pricePerDay || isNaN(Number(pricePerDay))) {
            return res.status(400).json({ success: false, message: "Valid pricePerDay is required." });
        }

        // Case A: Agar single Bed ID di gayi hai
        if (bedId) {
            const bed = await Bed.findOneAndUpdate(
                { _id: bedId, hospitalId: req.user.id },
                { $set: { pricePerDay: Number(pricePerDay) } },
                { new: true }
            );
            if (!bed) return res.status(404).json({ success: false, message: "Bed not found or unauthorized." });
            return res.json({ success: true, message: "Bed price updated successfully", data: bed });
        } 
        
        // Case B: Agar pure Ward ki beds bulk update karni hai
        else if (wardId) {
            const ward = await Ward.findOne({ _id: wardId, hospitalId: req.user.id });
            if (!ward) return res.status(404).json({ success: false, message: "Ward not found or unauthorized." });

            await Bed.updateMany(
                { wardId: wardId, hospitalId: req.user.id },
                { $set: { pricePerDay: Number(pricePerDay) } }
            );

            return res.json({ success: true, message: "All ward beds price updated successfully" });
        } 
        
        else {
            return res.status(400).json({ success: false, message: "Either bedId or wardId is required." });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- API 2: IMPORT TERMS & CONDITIONS FROM PLAIN TEXT (.txt) FILE ONLY ---
const uploadHospitalTermsPdf = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "Kripya TXT file upload karein." });
        }

        const tempFilePath = req.file.path;
        const fileExtension = path.extname(req.file.originalname).toLowerCase();

        // 1. Strict Format Verification
        if (fileExtension !== '.txt') {
            fs.unlinkSync(tempFilePath); // Invalid file ko instantly delete karein
            return res.status(400).json({ 
                success: false, 
                message: "Format error: Sirf '.txt' (Plain Text) file hi allowed hai." 
            });
        }

        // 2. Read TXT file using Node's native UTF-8 reader (100% accurate, no package needed)
        const extractedText = fs.readFileSync(tempFilePath, 'utf-8');

        if (!extractedText || extractedText.trim().length === 0) {
            fs.unlinkSync(tempFilePath);
            return res.status(400).json({ 
                success: false, 
                message: "File khali hai. Kripya content wali TXT file upload karein." 
            });
        }

        // 3. Save plain text in database
        const hospital = await Hospital.findByIdAndUpdate(
            req.user.id,
            { $set: { termsAndConditions: extractedText.trim() } },
            { new: true }
        );

        // 4. Cleanup temporary file from server disk
        fs.unlinkSync(tempFilePath);

        res.json({ 
            success: true, 
            message: "TXT text successfully extracted and saved", 
            data: hospital.termsAndConditions 
        });

    } catch (error) {
        console.error("TXT Import Error:", error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path); // Safe cleanup on crash
        }
        res.status(500).json({ success: false, message: "File processing error: " + error.message });
    }
};

// --- API: GET COMPLETED CASES HISTORY (Updated) ---
// Endpoint: GET /hospital/panel/history
const getHospitalHistory = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { page = 1, limit = 10, search, caseType } = req.query; 

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 10);
        const skip = (pageNum - 1) * limitNum;

        let query = { 
            hospitalId: hospitalId, 
            status: 'Completed' 
        };

        if (caseType === 'emergency') {
            query.ambulanceId = { $ne: null, $exists: true };
        } else if (caseType === 'admission') {
            query.$or = [
                { ambulanceId: null },
                { ambulanceId: { $exists: false } }
            ];
        }

        if (search) {
            const isBookingId = search.toUpperCase().startsWith('HKH-') || search.toUpperCase().startsWith('HK-');
            if (isBookingId) {
                query.bookingId = { $regex: search, $options: 'i' };
            } else {
                const User = require('../../models/User'); 
                const matchedUsers = await User.find({
                    name: { $regex: search, $options: 'i' }
                }).select('_id');
                const userIds = matchedUsers.map(u => u._id);
                query.userId = { $in: userIds };
            }
        }

        const totalRecords = await Appointment.countDocuments(query);

        const history = await Appointment.find(query)
            .populate('userId', 'name phone email profilePic age gender bloodGroup familyMember')
            .populate('doctorId', 'name speciality qualification profileImage')
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay',
                populate: { path: 'wardId', select: 'name type' }
            })
            .sort({ updatedAt: -1 }) 
            .skip(skip)
            .limit(limitNum);

        const cleanedHistory = await Promise.all(history.map(async (appt) => {
            const enriched = await enrichAppointmentClinicalDetails(appt);
            
            return {
                _id: appt._id,
                bookingId: appt.bookingId,
                status: appt.status,
                startDate: appt.startDate,
                endDate: appt.endDate,
                stayDuration: appt.stayDuration || 1,

                patientDetails: resolvePatientDTO(appt),

                bedDetails: appt.bedId ? {
                    _id: appt.bedId._id,
                    bedNumber: appt.bedId.bedNumber,
                    wardName: appt.bedId.wardId?.name || appt.wardName || "N/A"
                } : null,

                assignedDoctor: appt.doctorId ? {
                    _id: appt.doctorId._id,
                    name: appt.doctorId.name,
                    speciality: appt.doctorId.speciality,
                    qualification: appt.doctorId.qualification || "MBBS"
                } : null,

                billing: {
                    totalAmount: appt.totalAmount || 0,
                    paymentMethod: appt.paymentMethod || 'Online',
                    paymentStatus: appt.paymentStatus || 'Paid',
                    transactionId: appt.transactionId || null
                },

                clinicalFiles: enriched.clinicalFiles,

                updatedAt: appt.updatedAt
            };
        }));

        res.json({
            success: true,
            totalRecords,
            totalPages: Math.ceil(totalRecords / limitNum),
            currentPage: pageNum,
            count: cleanedHistory.length,
            data: cleanedHistory 
        });

    } catch (error) {
        console.error("getHospitalHistory Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Emergency / Direct Discharge by Hospital Admin (Closes Active Doctor Shift in treatmentHistory & Frees Bed)
// @route   POST /hospital/panel/discharge/emergency
// @access  Private (Hospital Admin)
const emergencyDischarge = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { appointmentId, reason, dischargeNote } = req.body;

        if (!appointmentId) {
            return res.status(400).json({
                success: false,
                message: "appointmentId is required."
            });
        }

        const isObjId = mongoose.isValidObjectId(appointmentId);
        const query = {
            hospitalId,
            ...(isObjId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const appointment = await Appointment.findOne(query);
        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Admission record not found."
            });
        }

        const now = new Date();

        // Close any open doctor shift in treatmentHistory
        if (!Array.isArray(appointment.treatmentHistory)) {
            appointment.treatmentHistory = [];
        }

        if (appointment.treatmentHistory.length > 0) {
            for (let i = appointment.treatmentHistory.length - 1; i >= 0; i--) {
                const logItem = appointment.treatmentHistory[i];
                if (logItem && !logItem.endTime) {
                    const startRef = logItem.acceptedAt || logItem.assignedAt || logItem.startTime || logItem.timestamp;
                    const durStr = formatShiftDuration(startRef, now);
                    logItem.endTime = now;
                    if (logItem.acceptanceStatus === 'Pending-Acceptance') {
                        logItem.acceptanceStatus = 'Unaccepted-Reassigned';
                        logItem.unacceptedWaitDuration = durStr;
                        logItem.durationDisplay = `Did Not Accept for ${durStr} (Case Discharged)`;
                    } else {
                        logItem.acceptanceStatus = 'Completed';
                        logItem.durationDisplay = `${durStr} (Shift Completed on Discharge)`;
                    }
                    break;
                }
            }
        }

        appointment.treatmentHistory.push({
            fromDoctorId: appointment.doctorId || null,
            toDoctorId: appointment.doctorId || null,
            action: 'Discharged',
            assignmentSource: 'Hospital-Admin',
            acceptanceStatus: 'Completed',
            assignedAt: now,
            acceptedAt: now,
            endTime: now,
            unacceptedWaitDuration: "0 mins",
            durationDisplay: "Discharged by Hospital Management",
            notes: reason || dischargeNote || "Discharged directly by Hospital Admin.",
            timestamp: now,
            startTime: now
        });

        appointment.status = 'Completed';
        appointment.endDate = now;
        if (!appointment.clinicalSummary) appointment.clinicalSummary = {};
        appointment.clinicalSummary.dischargedAt = now;
        if (dischargeNote || reason) {
            appointment.clinicalSummary.dischargeNote = dischargeNote || reason;
        }

        if (appointment.bedId) {
            await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Available' } });
        }

        await appointment.save();
        await syncHospitalWardAndBedCapacity(hospitalId);

        return res.status(200).json({
            success: true,
            message: "Patient discharged successfully and bed released to Available.",
            data: appointment
        });

    } catch (error) {
        console.error("Emergency Discharge Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// 3. GET HOSPITAL CASE DETAILS (With Complete Unaccepted/Reassigned Doctor Chain)
// Endpoint: GET /hospital/panel/admissions/details/:id
const getHospitalCaseDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const hospitalId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(id);
        const query = {
            hospitalId,
            ...(isObjectId ? { _id: id } : { bookingId: String(id).trim() })
        };

        const caseData = await Appointment.findOne(query)
            .populate('userId', 'name phone email profilePic gender dob bloodGroup height weight')
            .populate('doctorId', 'name speciality qualification phone profileImage department licenseNumber')
            .populate('pendingDoctorId', 'name speciality qualification phone profileImage department')
            .populate({
                path: 'bedId',
                select: 'bedNumber status pricePerDay isVentilatorAvailable wardId',
                populate: { path: 'wardId', select: 'name type totalBeds availableBeds' }
            })
            .populate('ambulanceId', 'name phone vehicleNumber vehicleType location driverInfo')
            .populate('specialServices.serviceId', 'serviceName price image description')
            .populate('insuranceDetails.masterInsuranceId', 'provider insuranceName type')
            .populate('treatmentHistory.fromDoctorId', 'name speciality profileImage phone department')
            .populate('treatmentHistory.toDoctorId', 'name speciality profileImage phone department')
            .populate('clinicalLogs.doctorId', 'name speciality profileImage phone department')
            .populate('bedsideCareTeam.doctorId', 'name speciality profileImage phone department')
            .populate('activeMedications.addedBy', 'name speciality profileImage')
            .lean();

        if (!caseData) {
            return res.status(404).json({
                success: false,
                message: "Hospital case record not found."
            });
        }

        const prescriptions = await Prescription.find({ appointmentId: caseData._id })
            .populate('doctorId', 'name speciality qualification signatureImage')
            .sort({ createdAt: -1 })
            .lean();

        const { enrichedHistory, summaryStats } = buildHospitalDoctorAuditTrail(caseData.treatmentHistory, caseData.status);

        const enrichedClinicalLogs = (caseData.clinicalLogs || []).map(log => ({
            ...log,
            doctorName: log.doctorId?.name || "Attending Doctor",
            doctorSpeciality: log.doctorId?.speciality || ""
        }));

        return res.status(200).json({
            success: true,
            data: {
                ...caseData,
                doctorAssignmentSummary: summaryStats,
                treatmentHistory: enrichedHistory,
                clinicalLogs: enrichedClinicalLogs,
                prescriptions: prescriptions || []
            }
        });

    } catch (error) {
        console.error("Get Hospital Case Details Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};



// 🧮 MASTER 24-HOUR DYNAMIC STAY & FINANCIAL LEDGER ENGINE
const calcStayAndLedger = (appt, actualEndDate = new Date(), billingItems = []) => {
    const apptObj = appt.toObject ? appt.toObject() : { ...appt };
    
    const bedPricePerDay = Number(apptObj.bedId?.pricePerDay || 500);
    
    // Check-In & Checkout Timestamps
    const checkIn = moment(apptObj.startDate || apptObj.createdAt);
    const checkOut = moment(actualEndDate);
    
    // Exact Stay Hours
    const diffMs = Math.max(0, checkOut.diff(checkIn));
    const exactHours = Number((diffMs / (1000 * 60 * 60)).toFixed(1));
    
    // 24-Hour Block Calculation (<= 24h = 1 day, 24.1h-48h = 2 days, etc.)
    const actualStayDays = Math.max(1, Math.ceil(exactHours / 24));
    
    // Booked Duration Days
    let bookedDays = apptObj.stayDuration || 1;
    if (apptObj.startDate && apptObj.endDate) {
        const startDay = moment(apptObj.startDate).startOf('day');
        const endDay = moment(apptObj.endDate).startOf('day');
        bookedDays = Math.max(1, endDay.diff(startDay, 'days') + 1);
    }
    
    // 1. Consumed Base Stay Bed Charge
    const actualStayBedCharge = actualStayDays * bedPricePerDay;
    
    // 2. Advance Deposit Paid on Booking (Robust Fallbacks for UI Sync)
    let depositPaidOnBooking = 0;
    if (apptObj.paymentStatus === 'Paid' || apptObj.paymentDetails?.status === 'captured') {
        depositPaidOnBooking = Number(apptObj.paymentDetails?.amount || apptObj.totalAmount || (bookedDays * bedPricePerDay));
    } else if (apptObj.totalAmount && apptObj.totalAmount > 0) {
        depositPaidOnBooking = Number(apptObj.totalAmount);
    }
    
    // 3. Early Checkout vs Overstay Calculations
    let unusedDays = 0;
    let unusedDaysRefund = 0;
    let overstayDays = 0;
    let overstayCharge = 0;
    
    if (actualStayDays < bookedDays) {
        unusedDays = bookedDays - actualStayDays;
        unusedDaysRefund = unusedDays * bedPricePerDay;
    } else if (actualStayDays > bookedDays) {
        overstayDays = actualStayDays - bookedDays;
        overstayCharge = overstayDays * bedPricePerDay;
    }
    
    // 4. Extra Services / Consumables
    const existingExtra = (apptObj.specialServices || [])
        .filter(s => !s.serviceName?.startsWith("Overstay Bed Surcharge"))
        .reduce((sum, item) => sum + (Number(item.price) || 0), 0);
        
    const incomingExtra = (Array.isArray(billingItems) ? billingItems : [])
        .reduce((sum, item) => sum + (Number(item.price) || 0), 0);
        
    const extraServicesTotal = existingExtra + incomingExtra;
    
    // 5. Discount
    const discount = Number(apptObj.pricingBreakdown?.discountAmount || apptObj.couponDetails?.discountValue || 0);
    
    // 6. Total Actual Bill
    const totalActualBill = Math.max(0, actualStayBedCharge + extraServicesTotal - discount);
    
    // 7. Net Financial Settlement
    const netBalance = totalActualBill - depositPaidOnBooking;
    
    let refundDueToUser = 0;
    let pendingDepartureBalance = 0;
    let settlementStatus = "Settled";
    
    if (netBalance < 0) {
        refundDueToUser = Math.abs(netBalance);
        pendingDepartureBalance = 0;
        settlementStatus = "Refund-Initiated";
    } else if (netBalance > 0) {
        pendingDepartureBalance = netBalance;
        refundDueToUser = 0;
        settlementStatus = "Pending-Collection";
    }
    
    return {
        stayUnitCharge: bedPricePerDay,
        exactStayHours: exactHours,
        actualStayDays: actualStayDays,
        bookedDays: bookedDays,
        durationDisplay: `${actualStayDays} Day${actualStayDays > 1 ? 's' : ''}`,
        accumulatedBaseFee: actualStayBedCharge,
        baseStayCharge: actualStayBedCharge,       // 👈 Aliased for Frontend UI
        depositPaidOnBooking: depositPaidOnBooking,
        paidOnBooking: depositPaidOnBooking,        // 👈 Aliased for Frontend UI
        unusedDays: unusedDays,
        unusedDaysRefund: unusedDaysRefund,
        overstayDays: overstayDays,
        overstayCharge: overstayCharge,
        extraServicesTotal: extraServicesTotal,
        discountAmount: discount,
        totalActualBill: totalActualBill,
        estimatedTotal: totalActualBill,           // 👈 Aliased for Frontend UI
        currentBillTotal: totalActualBill,         // 👈 Aliased for Frontend UI
        refundDueToUser: refundDueToUser,
        pendingDepartureBalance: pendingDepartureBalance,
        remainingBalance: pendingDepartureBalance,  // 👈 Aliased for Frontend UI
        settlementStatus: settlementStatus
    };
};

// Helper function to enrich appointment with clinical details, prescriptions, and treatment team timeline
// Fixed: Computes dynamic pricing metrics and heals zero-value database pricing breakdowns on-the-fly
const enrichAppointmentClinicalDetails = async (appt, targetDischargeDate = new Date()) => {
    const apptObj = appt.toObject ? appt.toObject() : { ...appt };

    const prescriptionObj = await Prescription.findOne({ appointmentId: apptObj._id })
        .select('pdfUrl dietPlanPdf medicines diagnosis')
        .lean();

    const clinicalFiles = {
        dietPlanPdf: prescriptionObj?.dietPlanPdf || null,
        dischargeSummaryPdf: apptObj.clinicalSummary?.dischargeSummaryPdf || null,
        clinicalReports: apptObj.clinicalSummary?.uploadedReports || [],
        dischargeCardUrl: prescriptionObj?.pdfUrl || null
    };

    const treatmentTeamTimeline = [];

    if (apptObj.doctorId) {
        const primaryShift = apptObj.treatmentHistory?.find(h => 
            h.toDoctorId && h.toDoctorId._id?.toString() === apptObj.doctorId._id?.toString() && h.startTime
        );

        treatmentTeamTimeline.push({
            doctorId: apptObj.doctorId._id,
            name: apptObj.doctorId.name,
            speciality: apptObj.doctorId.speciality,
            qualification: apptObj.doctorId.qualification || "MD",
            profileImage: apptObj.doctorId.profileImage,
            role: "Primary Physician",
            joinedAt: primaryShift ? primaryShift.startTime : apptObj.startDate,
            dischargedAt: primaryShift?.endTime || apptObj.endDate || null,
            duration: primaryShift?.durationDisplay || ""
        });
    }

    if (apptObj.bedsideCareTeam && apptObj.bedsideCareTeam.length > 0) {
        apptObj.bedsideCareTeam.forEach(member => {
            if (member.doctorId) {
                treatmentTeamTimeline.push({
                    doctorId: member.doctorId._id,
                    name: member.doctorId.name,
                    speciality: member.doctorId.speciality,
                    qualification: member.doctorId.qualification || "MD",
                    profileImage: member.doctorId.profileImage,
                    role: "Bedside Specialist",
                    joinedAt: member.startTime || member.requestedAt,
                    dischargedAt: member.endTime || member.respondedAt || null,
                    duration: member.durationDisplay || ""
                });
            }
        });
    }

    // 🚀 Execute 24-Hour Stay & Ledger Calculations
    const ledger = calcStayAndLedger(apptObj, targetDischargeDate);

    // Full dual-key billingBreakdown matching UI Boxes
    const billingBreakdown = {
        stayUnitCharge: ledger.stayUnitCharge,
        baseStayDuration: ledger.durationDisplay,
        baseStayDays: ledger.actualStayDays,
        actualStayDays: ledger.actualStayDays,
        exactStayHours: ledger.exactStayHours,
        bookedDays: ledger.bookedDays,
        accumulatedBaseFee: ledger.accumulatedBaseFee,
        baseBedAllocationCharge: ledger.accumulatedBaseFee,
        baseStayCharge: ledger.accumulatedBaseFee,
        paidOnBooking: ledger.paidOnBooking,
        depositPaidOnBooking: ledger.depositPaidOnBooking,
        unusedDays: ledger.unusedDays,
        unusedDaysRefund: ledger.unusedDaysRefund,
        overstayDays: ledger.overstayDays,
        overstayCharge: ledger.overstayCharge,
        extraFacilitiesFee: ledger.extraServicesTotal,
        doctorVisitFee: 0,
        discountDeductions: ledger.discountAmount,
        totalInvoiceValue: ledger.totalActualBill,
        estimatedTotal: ledger.totalActualBill,
        currentBillTotal: ledger.totalActualBill,
        refundDueToUser: ledger.refundDueToUser,
        pendingDepartureBalance: ledger.pendingDepartureBalance,
        remainingBalance: ledger.remainingBalance,
        settlementStatus: ledger.settlementStatus
    };

    return {
        ...apptObj,
        clinicalFiles,
        treatmentTeamTimeline,
        billingBreakdown
    };
};



// --- API: GET ALL CLINICALLY COMPLETED CASES AWAITING BILLING (Updated) ---
// Endpoint: GET /hospital/panel/discharges/pending
const getHospitalPendingDischarges = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { page = 1, limit = 10, caseType } = req.query; 

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 10);
        const skip = (pageNum - 1) * limitNum;

        const query = {
            hospitalId,
            status: 'Discharge-Pending', 
            "bedsideCareTeam.status": { $nin: ['Pending', 'In-Progress'] } 
        };

        if (caseType === 'emergency') {
            query.ambulanceId = { $ne: null, $exists: true };
        } else if (caseType === 'admission') {
            query.$or = [
                { ambulanceId: null },
                { ambulanceId: { $exists: false } }
            ];
        }

        const totalRecords = await Appointment.countDocuments(query);

        const list = await Appointment.find(query)
            .populate('userId', 'name phone email profilePic age gender bloodGroup familyMember')
            .populate('doctorId', 'name speciality qualification profileImage')
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay status',
                populate: { path: 'wardId', select: 'name type' }
            })
            .sort({ updatedAt: -1 }) 
            .skip(skip)
            .limit(limitNum);

        const lightweightList = list.map(appt => {
            const resolvedPatient = resolvePatientDTO(appt);
            const bedRate = Number(appt.bedId?.pricePerDay || 0);
            
            return {
                _id: appt._id,
                bookingId: appt.bookingId,
                status: appt.status,
                triageLevel: appt.clinicalSummary?.triagePriority || appt.triageLevel || "",
                startDate: appt.startDate,
                endDate: appt.endDate,
                dischargedAt: appt.clinicalSummary?.dischargedAt || appt.updatedAt,
                stayDuration: appt.stayDuration || 1,

                // Patient Info Card
                patientDetails: resolvedPatient,

                // Bed Snapshot
                bedDetails: appt.bedId ? {
                    _id: appt.bedId._id,
                    bedNumber: appt.bedId.bedNumber || appt.bedNumber || "",
                    wardName: appt.bedId.wardId?.name || appt.wardName || "",
                    wardType: appt.bedId.wardId?.type || "ICU",
                    pricePerDay: bedRate
                } : null,

                // Primary Doctor
                assignedDoctor: appt.doctorId ? {
                    _id: appt.doctorId._id,
                    name: appt.doctorId.name,
                    speciality: appt.doctorId.speciality,
                    profileImage: appt.doctorId.profileImage || null
                } : null,

                // Billing Snapshot
                billing: {
                    totalAmount: appt.totalAmount || 0,
                    paymentMethod: appt.paymentMethod || 'Online',
                    paymentStatus: appt.paymentStatus || 'Pending'
                },

                updatedAt: appt.updatedAt
            };
        });

        res.json({
            success: true,
            totalRecords,
            totalPages: Math.ceil(totalRecords / limitNum),
            currentPage: pageNum,
            count: lightweightList.length,
            data: lightweightList
        });

    } catch (error) {
        console.error("Fetch pending discharges list error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// Helper for visit reason
const primaryPatientReason = (appt) => {
    return appt.patients?.[0]?.reasonForVisit || appt.bookingReason || "Hospital Admission";
};

// --- API: DISPATCH HOSPITAL AMBULANCE FOR ADMISSION PATIENT (Figma Flow Sync) ---
// Endpoint: POST /hospital/panel/admissions/dispatch-ambulance
// Logic: Generates AmbulanceBooking, locks driver availability, and appends transit charges to patient's bill
const dispatchAmbulanceForAdmission = async (req, res) => {
    let ambulanceToRollback = null;

    try {
        const hospitalId = req.user.id;
        const { 
            appointmentId, 
            ambulanceId, 
            destinationName, 
            customAddressText, 
            surgePrice, 
            baseAmbulanceRate 
        } = req.body;

        const appointment = await Appointment.findOne({ _id: appointmentId, hospitalId });
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Admission Record Not Found on your hospital console." });
        }

        if (appointment.ambulanceId) {
            return res.status(400).json({ 
                success: false, 
                message: "An ambulance has already been dispatched for this admission. Please cancel the current booking to re-assign." 
            });
        }

        const ambulance = await Ambulance.findOne({
            _id: ambulanceId,
            hospitalId,
            isActive: true,
            availableForEmergency: true,
            profileStatus: 'Approved'
        });

        if (!ambulance) {
            return res.status(400).json({ 
                success: false, 
                message: "Selected ambulance is not available or belongs to another hospital fleet." 
            });
        }

        ambulanceToRollback = ambulanceId;

        const basePrice = Number(baseAmbulanceRate || ambulance.pricing?.fixedPrice || 1500);
        const surge = Number(surgePrice || 0);
        const totalDispatchPrice = basePrice + surge;

        ambulance.availableForEmergency = false;
        await ambulance.save();

        const generatedBookingId = `HK-REF-${Date.now().toString().slice(-6)}`;
        const generatedCaseRef = generateCaseRef('Referral Ambulance');

        let finalDropAddress = destinationName || "Patient's Registered Residence";
        if (destinationName === "Custom Destination Address" && customAddressText) {
            finalDropAddress = customAddressText;
        }

        const patientObj = appointment.patients?.[0] || {};

        const AmbulanceBooking = require('../../models/AmbulanceBooking');
        const booking = await AmbulanceBooking.create({
            bookingId: generatedBookingId,
            caseReference: generatedCaseRef,
            userId: appointment.userId,
            ambulanceId: ambulanceId,
            hospitalId: hospitalId,
            serviceType: 'Referral Ambulance',
            status: 'Confirmed',
            pickupLocation: {
                address: req.user.address || "Hospital Base Location",
                lat: req.user.location?.lat || 30.7046,
                lng: req.user.location?.lng || 76.7179
            },
            patientDetails: {
                name: patientObj.patientName || "Admitted Patient",
                age: patientObj.patientAge || 30,
                gender: patientObj.gender || "Male",
                condition: "Stable",
                emergencyDescription: "Referral hospital transit drop-off"
            },
            pricing: {
                ambulanceCharge: basePrice,
                supportingStaffCharge: 0,
                subtotal: totalDispatchPrice,
                discount: 0,
                total: totalDispatchPrice
            },
            paymentStatus: 'Pending',
            paymentMethod: 'Online',
            otp: Math.floor(1000 + Math.random() * 9000).toString(),
            trackingTimeline: [{
                status: 'Confirmed',
                timestamp: new Date(),
                note: `Ambulance assigned and dispatched directly by hospital admin control desk to ${finalDropAddress}.`
            }]
        });

        appointment.specialServices.push({
            serviceName: `Ambulance Dispatch: ${finalDropAddress}`,
            price: totalDispatchPrice
        });

        if (!appointment.pricingBreakdown) {
            appointment.pricingBreakdown = { baseFee: 0, visitCharges: 0, extraCharges: 0, discountAmount: 0, subtotal: 0 };
        }

        appointment.pricingBreakdown.extraCharges = (appointment.pricingBreakdown.extraCharges || 0) + totalDispatchPrice;
        appointment.totalAmount = (appointment.totalAmount || 0) + totalDispatchPrice;

        appointment.ambulanceId = ambulanceId;
        appointment.transactionId = generatedBookingId;

        await appointment.save();

        // 🚨 BUG FIX: targetType set strictly to 'ambulance' instead of 'driver'
        const { sendPushNotification } = require('../../utils/notification');
        await sendPushNotification(
            ambulanceId,
            'ambulance',
            "🚨 Assigned Referral Ride",
            `Hospital has dispatched you for a Referral trip to ${finalDropAddress}. Patient Name: ${patientObj.patientName || 'User'}.`,
            { bookingId: booking._id.toString(), type: 'assigned_referral' }
        );

        res.status(201).json({
            success: true,
            message: "Ambulance successfully dispatched. Cost appended to patient's hospital invoice.",
            data: {
                booking,
                appointment
            }
        });

    } catch (error) {
        console.error("Ambulance Dispatch Error:", error);
        if (ambulanceToRollback) {
            await Ambulance.findByIdAndUpdate(ambulanceToRollback, { 
                $set: { availableForEmergency: true } 
            });
        }
        res.status(500).json({ success: false, message: "Transactional dispatch failure: " + error.message });
    }
};

// --- API: REASSIGNS HOSPITAL AMBULANCE DUE TO BREAKDOWN (Strictly preserves original pricing) ---
// Endpoint: POST /hospital/panel/ambulance/reassign-breakdown
const reassignAmbulanceOnBreakdown = async (req, res) => {
    try {
        const hospitalId = req.user.id; // Logged-in Hospital Admin
        const { bookingId, newAmbulanceId, reason } = req.body;

        // 🚀 FIX: Dynamic query builder to support both Hex _id AND custom "HK-BOK-..." string bookingId
        const isObjectId = mongoose.Types.ObjectId.isValid(bookingId);
        let query = isObjectId 
            ? { _id: bookingId, hospitalId } 
            : { bookingId: bookingId, hospitalId };

        // Strictly allow reassigning only during active transit journey states
        query.status = { $in: ['Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] };

        const booking = await AmbulanceBooking.findOne(query);

        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: "Active ambulance booking not found on your fleet. Kripya check karein ki booking ka status 'Confirmed', 'Arrived', 'Picked-Up', ya 'En-Route' hai aur Hospital Token matching hai." 
            });
        }

        const oldAmbulanceId = booking.ambulanceId;
        if (String(oldAmbulanceId) === String(newAmbulanceId)) {
            return res.status(400).json({ success: false, message: "Kripya dynamic reallocation ke liye koi doosri free ambulance select karein." });
        }

        // 2. Verify new ambulance is available and belongs to the same hospital
        const newAmbulance = await Ambulance.findOne({
            _id: newAmbulanceId,
            hospitalId,
            availableForEmergency: true,
            profileStatus: 'Approved'
        });

        if (!newAmbulance) {
            return res.status(400).json({ success: false, message: "Selected new ambulance is not available or unauthorized." });
        }

        // 3. Mark old broken ambulance as unavailable/broken (Block emergency availability)
        if (oldAmbulanceId) {
            await Ambulance.findByIdAndUpdate(oldAmbulanceId, {
                $set: { availableForEmergency: false } // Locked due to breakdown/maintenance
            });
        }

        // 4. Assign new ambulance to booking & lock its availability status
        booking.ambulanceId = newAmbulanceId;
        newAmbulance.availableForEmergency = false;
        await newAmbulance.save();

        // 5. Push re-assignment/breakdown log in tracking timeline
        booking.trackingTimeline.push({
            status: booking.status, // Preserves the current transit state (e.g., Picked-Up/En-Route)
            timestamp: new Date(),
            note: `Ambulance successfully reassigned. Previous vehicle broke down. Reason: ${reason || 'Mechanical Failure'}. Total Fare remains strictly identical.`
        });

        await booking.save();

        res.json({
            success: true,
            message: "Ambulance successfully reassigned due to breakdown. Pricing remains unchanged.",
            data: booking
        });

    } catch (error) {
        console.error("Reassign Breakdown Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Reassign Doctor from Hospital Panel (Standalone Full Function with Unaccepted/Accepted Audit Trail)
// @route   POST /hospital/panel/reassign-doctor
// @access  Private (Hospital Admin)
const reassignDoctorFromPanel = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { appointmentId, newDoctorId, doctorId, reason, notes } = req.body;
        const targetNewDoctorId = newDoctorId || doctorId;

        if (!appointmentId || !targetNewDoctorId) {
            return res.status(400).json({
                success: false,
                message: "appointmentId and newDoctorId (or doctorId) are required."
            });
        }

        const isApptObjId = mongoose.isValidObjectId(appointmentId);
        const apptQuery = {
            hospitalId,
            ...(isApptObjId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        // Fetch admission case and target new doctor in parallel
        const [appointment, newDoctor] = await Promise.all([
            Appointment.findOne(apptQuery).populate('doctorId', 'name speciality department phone'),
            Doctor.findOne({ _id: targetNewDoctorId, hospitalId }).select('name speciality department phone profileImage qualification').lean()
        ]);

        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Admission case record not found in this hospital."
            });
        }

        if (!newDoctor) {
            return res.status(404).json({
                success: false,
                message: "Selected new doctor not found in this hospital."
            });
        }

        const now = new Date();
        const previousDoctorId = appointment.doctorId?._id || appointment.doctorId || null;
        const previousDoctorName = appointment.doctorId?.name || "Previous Doctor";

        if (previousDoctorId && String(previousDoctorId) === String(newDoctor._id) && !appointment.pendingDoctorId) {
            return res.status(400).json({
                success: false,
                message: `Dr. ${newDoctor.name} is already assigned to this case.`
            });
        }

        if (!Array.isArray(appointment.treatmentHistory)) {
            appointment.treatmentHistory = [];
        }

        // 1. Close any previous open doctor assignment log in treatmentHistory
        if (appointment.treatmentHistory.length > 0) {
            for (let i = appointment.treatmentHistory.length - 1; i >= 0; i--) {
                const logItem = appointment.treatmentHistory[i];
                if (logItem && !logItem.endTime) {
                    const prevAssignedTime = logItem.assignedAt || logItem.startTime || logItem.timestamp;
                    logItem.endTime = now;

                    // Check if previous doctor never accepted the case
                    if (logItem.acceptanceStatus === 'Pending-Acceptance' || !logItem.acceptedAt) {
                        const waitTimeStr = formatShiftDuration(prevAssignedTime, now);
                        logItem.acceptanceStatus = 'Unaccepted-Reassigned';
                        logItem.unacceptedWaitDuration = waitTimeStr;
                        logItem.durationDisplay = `Did Not Accept for ${waitTimeStr} (Reassigned to Dr. ${newDoctor.name})`;
                        logItem.notes = `${logItem.notes || ''} | [Reassigned by Hospital at ${moment(now).format('hh:mm A')}: Did not accept for ${waitTimeStr}]`.trim();
                    } else {
                        // Previous doctor had accepted and worked on the case
                        const dutyTimeStr = formatShiftDuration(logItem.acceptedAt || prevAssignedTime, now);
                        logItem.acceptanceStatus = 'Replaced-After-Acceptance';
                        logItem.durationDisplay = `${dutyTimeStr} (Shift Ended - Reassigned to Dr. ${newDoctor.name})`;
                        logItem.notes = `${logItem.notes || ''} | [Reassigned to Dr. ${newDoctor.name} after ${dutyTimeStr} of active duty]`.trim();
                    }
                    break;
                }
            }
        }

        const customReason = reason || notes || "Reassigned by Hospital Management";

        // 2. Push new doctor assignment log into treatmentHistory
        appointment.treatmentHistory.push({
            fromDoctorId: previousDoctorId,
            toDoctorId: newDoctor._id,
            action: 'Reassigned-By-Hospital',
            assignmentSource: 'Hospital-Admin',
            acceptanceStatus: 'Pending-Acceptance',
            assignedAt: now,
            acceptedAt: null,
            unacceptedWaitDuration: "",
            notes: previousDoctorId
                ? `Reassigned by Hospital Admin from Dr. ${previousDoctorName} to Dr. ${newDoctor.name} (${newDoctor.speciality || 'Specialist'}). Reason: ${customReason}`
                : `Assigned to Dr. ${newDoctor.name} (${newDoctor.speciality || 'Specialist'}) by Hospital Admin. Reason: ${customReason}`,
            timestamp: now,
            startTime: now,
            endTime: null,
            durationDisplay: "Awaiting Doctor Acceptance"
        });

        // 3. Update active doctorId & clear any pending colleague transfer
        appointment.doctorId = newDoctor._id;
        appointment.pendingDoctorId = null;

        if (appointment.status === 'Hospital-Pending' || appointment.status === 'Pending') {
            appointment.status = 'Confirmed';
        }

        await appointment.save();

        // 4. Send Push Notifications to New Doctor, Previous Doctor, and Patient
        Promise.allSettled([
            sendPushNotification(
                newDoctor._id,
                'doctor',
                "🔄 Case Reassigned to You - Action Required",
                `Hospital Admin assigned patient ${appointment.patients?.[0]?.patientName || 'Patient'} (#${appointment.bookingId}, Bed: ${appointment.bedNumber || 'IPD'}) to your care. Please accept.`,
                {
                    type: 'CASE_REASSIGNED',
                    appointmentId: String(appointment._id),
                    bookingId: String(appointment.bookingId)
                }
            ),
            previousDoctorId ? sendPushNotification(
                previousDoctorId,
                'doctor',
                "ℹ️ Case Reassigned by Hospital Admin",
                `Case #${appointment.bookingId} has been reassigned to Dr. ${newDoctor.name}. Reason: ${customReason}`,
                {
                    type: 'CASE_HANDOVER_COMPLETE',
                    appointmentId: String(appointment._id),
                    bookingId: String(appointment.bookingId)
                }
            ) : Promise.resolve(),
            appointment.userId ? sendPushNotification(
                appointment.userId,
                'user',
                "👨‍⚕️ Attending Doctor Updated",
                `Dr. ${newDoctor.name} (${newDoctor.speciality || 'Specialist'}) has been assigned to your hospital care (#${appointment.bookingId}).`,
                {
                    type: 'DOCTOR_UPDATED',
                    serviceType: 'Hospital',
                    appointmentId: String(appointment._id),
                    bookingId: String(appointment.bookingId)
                }
            ) : Promise.resolve()
        ]);

        // 5. Fetch populated document and build enriched audit trail for immediate frontend state update
        const updatedPopulated = await Appointment.findById(appointment._id)
            .populate('userId', 'name phone gender dob bloodGroup profilePic')
            .populate('doctorId', 'name speciality qualification phone profileImage department')
            .populate('treatmentHistory.fromDoctorId', 'name speciality profileImage phone department')
            .populate('treatmentHistory.toDoctorId', 'name speciality profileImage phone department')
            .lean();

        const { enrichedHistory, summaryStats } = buildHospitalDoctorAuditTrail(
            updatedPopulated.treatmentHistory,
            updatedPopulated.status
        );

        return res.status(200).json({
            success: true,
            message: `Case #${appointment.bookingId} successfully reassigned to Dr. ${newDoctor.name}.`,
            doctorAssignmentSummary: summaryStats,
            data: {
                ...updatedPopulated,
                treatmentHistory: enrichedHistory
            }
        });

    } catch (error) {
        console.error("Reassign Doctor From Panel Error:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

const reportHospitalNoShow = async (req, res) => {
    try {
        const { appointmentId, comments } = req.body;
        const hospitalId = req.user.id;

        const appointment = await Appointment.findOne({
            _id: appointmentId,
            hospitalId,
            bookingType: 'Admission',
            status: 'Hospital-Pending' // Pending direct admission check-in
        });

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Admission booking record not found." });
        }

        const totalPaid = appointment.totalAmount || 0;
        let noShowFee = 0;

        const config = await NoShowConfig.findOne({ vendorType: 'Hospital', isActive: true });
        if (config && config.chargeValue > 0) {
            noShowFee = config.chargeType === 'Percentage'
                ? Math.round((totalPaid * config.chargeValue) / 100)
                : Math.min(config.chargeValue, totalPaid);
        }

        appointment.status = 'No-Show';
        appointment.pricingBreakdown.noShowFeeApplied = noShowFee;
        appointment.paymentStatus = noShowFee > 0 ? 'Refund-Initiated' : 'Refunded';
        appointment.noShowComments = comments || "Patient failed to check-in for scheduled bed admission.";

        // Release the assigned bed resource instantly
        if (appointment.bedId) {
            await Bed.findByIdAndUpdate(appointment.bedId, { status: 'Available' });
            await Ward.findOneAndUpdate(
                { name: appointment.wardName, hospitalId },
                { $inc: { availableBeds: 1 } }
            );
        }

        await appointment.save();

        res.json({ 
            success: true, 
            message: "Admission No-Show logged successfully. Bed released and refund initiated.", 
            noShowFeeApplied: noShowFee,
            data: appointment
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// --- API: TRANSFER PATIENT BED (With Automatic Split Stay Billing Engine) ---
// endpoint: POST /hospital/panel/admissions/transfer-bed
const transferPatientBed = async (req, res) => {
    try {
        const { appointmentId, newBedId, reason } = req.body;
        const hospitalId = req.user.id;

        if (!appointmentId || !newBedId) {
            return res.status(400).json({ 
                success: false, 
                message: "Both appointmentId and newBedId are required for bed transfer." 
            });
        }

        // 1. Fetch current active admission
        const appointment = await Appointment.findOne({ 
            _id: appointmentId, 
            hospitalId,
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending'] }
        });

        if (!appointment) {
            return res.status(404).json({ 
                success: false, 
                message: "Active hospital admission record not found or already discharged." 
            });
        }

        const oldBedId = appointment.bedId;

        if (oldBedId && String(oldBedId) === String(newBedId)) {
            return res.status(400).json({ 
                success: false, 
                message: "Patient is already assigned to this bed." 
            });
        }

        // 2. Check if target new bed is available
        const targetBed = await Bed.findOne({ _id: newBedId, hospitalId });
        if (!targetBed) {
            return res.status(404).json({ success: false, message: "Target bed not found in this hospital." });
        }

        if (targetBed.status === 'Occupied' || targetBed.status === 'Maintenance') {
            return res.status(400).json({ 
                success: false, 
                message: `Target bed (${targetBed.bedNumber}) is currently ${targetBed.status}. Please select an Available bed.` 
            });
        }

        const newWard = await Ward.findById(targetBed.wardId);
        const newWardName = newWard ? newWard.name : "Special Ward";

        // 3. Release Old Bed (Mark Available & Increment Old Ward count)
        if (oldBedId) {
            const oldBed = await Bed.findById(oldBedId);
            if (oldBed) {
                oldBed.status = 'Available';
                await oldBed.save();

                if (oldBed.wardId) {
                    await Ward.findByIdAndUpdate(oldBed.wardId, { $inc: { availableBeds: 1 } });
                }
            }
        }

        // 4. Occupy New Bed (Mark Occupied & Decrement New Ward count)
        targetBed.status = 'Occupied';
        await targetBed.save();

        if (targetBed.wardId) {
            await Ward.findByIdAndUpdate(targetBed.wardId, { $inc: { availableBeds: -1 } });
        }

        // 5. Update Appointment & Log to Treatment History
        const oldBedNumber = appointment.bedNumber || "Previous Bed";
        appointment.bedId = targetBed._id;
        appointment.bedNumber = targetBed.bedNumber;
        appointment.wardName = newWardName;

        appointment.treatmentHistory.push({
            action: 'Initial-Assignment',
            notes: `Bed shifted from ${oldBedNumber} to ${targetBed.bedNumber} (${newWardName}). Reason: ${reason || 'Clinical Requirement'}`,
            timestamp: new Date()
        });

        await appointment.save();

        res.json({
            success: true,
            message: `Patient successfully shifted to ${targetBed.bedNumber} (${newWardName}).`,
            data: {
                appointmentId: appointment._id,
                bookingId: appointment.bookingId,
                newBedId: targetBed._id,
                newBedNumber: targetBed.bedNumber,
                wardName: newWardName,
                status: appointment.status
            }
        });

    } catch (error) {
        console.error("Transfer Patient Bed Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- API 1: GET HOSPITAL ALL CASES FOR TRACKING (With 20-Record Pagination) ---
// Endpoint: GET /hospital/panel/cases/track-list
const getTrackCasesList = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { page = 1, limit = 10, search, status } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 10);
        const skip = (pageNum - 1) * limitNum;

        let query = { 
            hospitalId,
            bookingType: 'Admission'
        };

        if (status) query.status = status;

        if (search) {
            const isBookingId = search.toUpperCase().startsWith('HKH-') || search.toUpperCase().startsWith('HK-');
            if (isBookingId) {
                query.bookingId = { $regex: search, $options: 'i' };
            } else {
                const User = require('../../models/User');
                const matchedUsers = await User.find({
                    name: { $regex: search, $options: 'i' }
                }).select('_id');
                const userIds = matchedUsers.map(u => u._id);
                query.userId = { $in: userIds };
            }
        }

        const totalRecords = await Appointment.countDocuments(query);

        const list = await Appointment.find(query)
            .populate('userId', 'name phone email profilePic age gender bloodGroup familyMember')
            .populate('doctorId', 'name speciality profileImage')
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay status',
                populate: { path: 'wardId', select: 'name type' }
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum);

        const cleanedTrackList = list.map(appt => ({
            _id: appt._id,
            bookingId: appt.bookingId,
            status: appt.status,
            triageLevel: appt.triageLevel || "Routine",
            startDate: appt.startDate,
            endDate: appt.endDate,
            stayDuration: appt.stayDuration || 1,

            patientDetails: resolvePatientDTO(appt),

            bedDetails: appt.bedId ? {
                _id: appt.bedId._id,
                bedNumber: appt.bedId.bedNumber,
                wardName: appt.bedId.wardId?.name || appt.wardName || "N/A"
            } : null,

            assignedDoctor: appt.doctorId ? {
                _id: appt.doctorId._id,
                name: appt.doctorId.name,
                speciality: appt.doctorId.speciality,
                profileImage: appt.doctorId.profileImage || null
            } : null,

            billing: {
                totalAmount: appt.totalAmount || 0,
                paymentStatus: appt.paymentStatus || 'Pending',
                paymentMethod: appt.paymentMethod || 'Online'
            },

            createdAt: appt.createdAt
        }));

        res.json({
            success: true,
            totalRecords,
            totalPages: Math.ceil(totalRecords / limitNum),
            currentPage: pageNum,
            count: cleanedTrackList.length,
            data: cleanedTrackList
        });

    } catch (error) {
        console.error("Fetch Track List Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. GET TRACK CASE SUPER DETAILS (360° Audit: Ambulance + Unaccepted/Accepted Doctors + Clinical Logs)
// Endpoint: GET /hospital/panel/cases/track-details/:id
const getTrackCaseSuperDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const hospitalId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(id);
        const query = {
            hospitalId,
            ...(isObjectId ? { _id: id } : { bookingId: String(id).trim() })
        };

        const appointment = await Appointment.findOne(query)
            .populate('userId', 'name phone email profilePic gender dob bloodGroup')
            .populate('doctorId', 'name speciality qualification phone profileImage department')
            .populate('pendingDoctorId', 'name speciality phone profileImage department')
            .populate({
                path: 'bedId',
                select: 'bedNumber status pricePerDay isVentilatorAvailable wardId',
                populate: { path: 'wardId', select: 'name type' }
            })
            .populate('ambulanceId', 'name phone vehicleNumber vehicleType location driverInfo')
            .populate('specialServices.serviceId', 'serviceName price image description')
            .populate('insuranceDetails.masterInsuranceId', 'provider insuranceName type')
            .populate('treatmentHistory.fromDoctorId', 'name speciality profileImage phone department')
            .populate('treatmentHistory.toDoctorId', 'name speciality profileImage phone department')
            .populate('clinicalLogs.doctorId', 'name speciality profileImage phone department')
            .populate('bedsideCareTeam.doctorId', 'name speciality profileImage phone department')
            .populate('activeMedications.addedBy', 'name speciality profileImage')
            .lean();

        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: "Tracked case not found."
            });
        }

        const [linkedAmbulanceTrip, prescriptions] = await Promise.all([
            appointment.transactionId
                ? AmbulanceBooking.findOne({ bookingId: appointment.transactionId })
                    .populate('ambulanceId', 'name phone vehicleNumber vehicleType location driverInfo')
                    .populate('pickupHospitalId', 'name address phone')
                    .lean()
                : Promise.resolve(null),
            Prescription.find({ appointmentId: appointment._id })
                .populate('doctorId', 'name speciality qualification signatureImage')
                .sort({ createdAt: -1 })
                .lean()
        ]);

        const { enrichedHistory, summaryStats } = buildHospitalDoctorAuditTrail(appointment.treatmentHistory, appointment.status);

        const enrichedClinicalLogs = (appointment.clinicalLogs || []).map(log => ({
            ...log,
            doctorName: log.doctorId?.name || "Attending Doctor",
            doctorSpeciality: log.doctorId?.speciality || ""
        }));

        return res.status(200).json({
            success: true,
            data: {
                ...appointment,
                doctorAssignmentSummary: summaryStats,
                treatmentHistory: enrichedHistory,
                clinicalLogs: enrichedClinicalLogs,
                prescriptions: prescriptions || [],
                ambulanceJourney: linkedAmbulanceTrip || null
            }
        });

    } catch (error) {
        console.error("Get Track Case Super Details Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};




//////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////// DISCHARGE ambulance DROP-OFF APIs  ////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////
// --- API 1: GET AVAILABLE FLEET FOR DISCHARGE DROP-OFF (Figma Screen 3 Aligned) ---
// Endpoint: GET /hospital/panel/discharge/available-ambulances
const getAvailableDischargeAmbulances = async (req, res) => {
    try {
        const hospitalId = req.user.id;

        // Fetch active, approved, and available fleet of the hospital
        const fleet = await Ambulance.find({
            hospitalId,
            isActive: true,
            availableForEmergency: true,
            profileStatus: 'Approved'
        }).select('name vehicleNumber vehicleType pricing driverInfo phone availableForEmergency');

        res.json({
            success: true,
            count: fleet.length,
            data: fleet
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- API 2: CALCULATE DISCHARGE DROP-OFF FARE (Figma Screen 2/4 Pricing Engine) ---
// Endpoint: POST /hospital/panel/discharge/calculate-fare
const calculateDischargeAmbulanceFare = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { ambulanceId, homeLat, homeLng } = req.body;

        if (!ambulanceId || !homeLat || !homeLng) {
            return res.status(400).json({ success: false, message: "Ambulance ID and Home GPS Coordinates (Lat/Lng) are required." });
        }

        // 1. Fetch Selected Ambulance
        const ambulance = await Ambulance.findById(ambulanceId);
        if (!ambulance) return res.status(404).json({ success: false, message: "Ambulance not found." });

        // 2. Fetch Origin Hospital coordinates
        const hospital = await Hospital.findById(hospitalId);
        if (!hospital) return res.status(404).json({ success: false, message: "Hospital profile not found." });

        const hospLat = hospital.location?.lat || 30.7046;
        const hospLng = hospital.location?.lng || 76.7179;

        // 3. Compute GPS Distance (KM)
        const distance = await getDistance(hospLat, hospLng, parseFloat(homeLat), parseFloat(homeLng));

        // 4. Run Pricing Calculations
        const baseRate = ambulance.pricing?.fixedPrice || 1500;
        const baseDistance = ambulance.pricing?.baseDistance || 5;
        const pricePerKM = ambulance.pricing?.pricePerKM || 15;

        let surgePrice = 0;
        const extraDistance = distance - baseDistance;
        if (extraDistance > 0) {
            surgePrice = Math.round(extraDistance * pricePerKM);
        }

        const totalFare = baseRate + surgePrice;

        res.json({
            success: true,
            data: {
                distance: `${distance.toFixed(1)} km`,
                rawDistance: distance,
                baseAmbulanceRate: baseRate,
                destinationSurge: surgePrice,
                totalDispatchPrice: totalFare
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- API 3: DISPATCH DISCHARGE AMBULANCE & MERGE FARE WITH HOSPITAL BILL (Figma Action Sync) ---
// Endpoint: POST /hospital/panel/discharge/dispatch-ambulance
const dispatchDischargeAmbulance = async (req, res) => {
    let ambulanceToRollback = null;

    try {
        const hospitalId = req.user.id;
        const { 
            appointmentId, 
            ambulanceId, 
            homeAddress, 
            homeLat, 
            homeLng, 
            totalFare, 
            distance 
        } = req.body;

        if (!appointmentId || !ambulanceId || !totalFare) {
            return res.status(400).json({ success: false, message: "Required fields (appointmentId, ambulanceId, totalFare) are missing." });
        }

        const appointment = await Appointment.findOne({ _id: appointmentId, hospitalId });
        if (!appointment) return res.status(404).json({ success: false, message: "Patient Admission Record Not Found." });

        if (appointment.status !== 'Discharge-Pending') {
            return res.status(400).json({ success: false, message: "Ambulance Add-on can only be booked for patients clinically ready for discharge (Discharge-Pending)." });
        }

        const ambulance = await Ambulance.findOne({
            _id: ambulanceId,
            hospitalId,
            isActive: true,
            availableForEmergency: true,
            profileStatus: 'Approved'
        });

        if (!ambulance) {
            return res.status(400).json({ success: false, message: "Selected ambulance is not available or belongs to another fleet." });
        }

        ambulanceToRollback = ambulanceId;
        ambulance.availableForEmergency = false;
        await ambulance.save();

        const generatedBookingId = `HK-REF-${Date.now().toString().slice(-6)}`;
        // 🚀 SYNC FIX: Uses collision-proof caseReference generator
        const generatedCaseRef = generateCaseRef('Referral Ambulance');

        const patientObj = appointment.patients?.[0] || {};
        const dropAddress = homeAddress || appointment.address?.city || "Patient Home Address";

        const AmbulanceBooking = require('../../models/AmbulanceBooking');
        const booking = await AmbulanceBooking.create({
            bookingId: generatedBookingId,
            caseReference: generatedCaseRef,
            userId: appointment.userId,
            ambulanceId: ambulanceId,
            hospitalId: hospitalId,
            serviceType: 'Referral Ambulance',
            status: 'Confirmed', 
            pickupLocation: {
                address: req.user.address || "Hospital Base Location",
                lat: req.user.location?.lat || 30.7046,
                lng: req.user.location?.lng || 76.7179
            },
            patientDetails: {
                name: patientObj.patientName || "Admitted Patient",
                age: patientObj.patientAge || 30,
                gender: patientObj.gender || "Male",
                condition: "Stable",
                emergencyDescription: "Discharge drop-off transit to residence."
            },
            pricing: {
                ambulanceCharge: ambulance.pricing?.fixedPrice || 1500,
                supportingStaffCharge: 0,
                subtotal: Number(totalFare),
                discount: 0,
                total: Number(totalFare)
            },
            paymentStatus: 'Pending',
            paymentMethod: 'Online',
            otp: Math.floor(1000 + Math.random() * 9000).toString(),
            trackingTimeline: [{
                status: 'Confirmed',
                timestamp: new Date(),
                note: `Discharge drop-off ambulance successfully assigned by hospital ward control desk to ${dropAddress}.`
            }]
        });

        appointment.specialServices.push({
            serviceName: `Discharge Ambulance Drop-off: ${dropAddress} (${distance || 'N/A'})`,
            price: Number(totalFare)
        });

        if (!appointment.pricingBreakdown) {
            appointment.pricingBreakdown = { baseFee: 0, visitCharges: 0, extraCharges: 0, discountAmount: 0, subtotal: 0 };
        }

        appointment.pricingBreakdown.extraCharges = (appointment.pricingBreakdown.extraCharges || 0) + Number(totalFare);
        appointment.totalAmount = (appointment.totalAmount || 0) + Number(totalFare);

        appointment.ambulanceId = ambulanceId;
        await appointment.save();

        const { sendPushNotification } = require('../../utils/notification');
        await sendPushNotification(
            ambulanceId,
            'driver',
            "🚨 Assigned Discharge Drop-off",
            `Hospital has assigned you for a patient drop-off to ${dropAddress}. Patient: ${patientObj.patientName || 'User'}.`,
            { bookingId: booking._id.toString(), type: 'assigned_discharge_dropoff' }
        );

        res.status(201).json({
            success: true,
            message: "Discharge drop-off ambulance successfully dispatched and merged with patient final bill.",
            data: {
                booking,
                appointment
            }
        });

    } catch (error) {
        console.error("Discharge Dispatch Error:", error);
        if (ambulanceToRollback) {
            await Ambulance.findByIdAndUpdate(ambulanceToRollback, { 
                $set: { availableForEmergency: true } 
            });
        }
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- API 4: CANCEL DISCHARGE AMBULANCE ADD-ON & REVERT LEDGER CHARGES (NEW API) ---
// Endpoint: POST /hospital/panel/discharge/cancel-ambulance
const cancelDischargeAmbulance = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { appointmentId } = req.body;

        const appointment = await Appointment.findOne({ _id: appointmentId, hospitalId });
        if (!appointment) return res.status(404).json({ success: false, message: "Patient Admission Record Not Found." });

        if (appointment.status !== 'Discharge-Pending') {
            return res.status(400).json({ success: false, message: "Cannot cancel ambulance add-on in current patient status." });
        }

        const assignedAmbulanceId = appointment.ambulanceId;
        if (!assignedAmbulanceId) {
            return res.status(400).json({ success: false, message: "No dispatched ambulance found associated with this discharge case." });
        }

        // 1. Cancel the active Ambulance Booking document
        const AmbulanceBooking = require('../../models/AmbulanceBooking');
        const activeBooking = await AmbulanceBooking.findOne({
            ambulanceId: assignedAmbulanceId,
            status: { $in: ['Searching', 'Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] }
        });

        let refundedFare = 0;
        if (activeBooking) {
            refundedFare = activeBooking.pricing?.total || 0;
            activeBooking.status = 'Cancelled';
            activeBooking.cancelledBy = 'System';
            activeBooking.cancellationReason = "Discharge ambulance drop-off cancelled by ward desk prior to final billing.";
            await activeBooking.save();
        }

        // 2. Release Ambulance back to available pool
        await Ambulance.findByIdAndUpdate(assignedAmbulanceId, { 
            $set: { availableForEmergency: true } 
        });

        // 3. DEDUCT AND REVERT LEDGER CHARGES FROM APPOINTMENT
        // Find and pull the discharge ambulance surcharge item from specialServices array
        const serviceIndex = appointment.specialServices.findIndex(s => 
            s.serviceName && s.serviceName.startsWith("Discharge Ambulance Drop-off")
        );

        if (serviceIndex > -1) {
            const servicePrice = appointment.specialServices[serviceIndex].price || refundedFare;
            
            // Revert charges
            appointment.pricingBreakdown.extraCharges = Math.max(0, (appointment.pricingBreakdown.extraCharges || 0) - servicePrice);
            appointment.totalAmount = Math.max(0, (appointment.totalAmount || 0) - servicePrice);
            
            // Remove the array item
            appointment.specialServices.splice(serviceIndex, 1);
        }

        // Clear references
        appointment.ambulanceId = null;
        await appointment.save();

        res.json({
            success: true,
            message: "Discharge ambulance add-on cancelled successfully. Bill successfully updated.",
            data: appointment
        });

    } catch (error) {
        console.error("Cancel Discharge Ambulance Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};



///////////////////////////////////////////////////////////////////////////////////
////////////////////////////////// REFERRAL booking ambulance APIs  //////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////
// --- API: BOOK HOSPITAL-TO-HOSPITAL REFERRAL TRANSIT (NEW API - Figma Aligned) ---
// Endpoint: POST /hospital/panel/referrals/book-transfer
const bookHospitalToHospitalReferral = async (req, res) => {
    let ambulanceToRollback = null;

    try {
        const sendingHospitalId = req.user.id;
        const {
            appointmentId,
            destinationHospitalId,
            ambulanceId,
            scheduledDate,
            scheduledTime,
            patientName,
            patientAge,
            gender,
            referralReason,
            staffType
        } = req.body;

        if (!destinationHospitalId || !ambulanceId) {
            return res.status(400).json({ success: false, message: "Required fields (destinationHospitalId, ambulanceId) are missing." });
        }

        const hospA = await Hospital.findById(sendingHospitalId);
        const hospB = await Hospital.findById(destinationHospitalId);

        if (!hospA || !hospB) {
            return res.status(404).json({ success: false, message: "Origin or Destination Hospital profile not found." });
        }

        const ambulance = await Ambulance.findById(ambulanceId);
        if (!ambulance) {
            return res.status(404).json({ success: false, message: "Selected Ambulance not found in the system." });
        }

        if (ambulance.availableForEmergency === false) {
            return res.status(400).json({ success: false, message: "Selected ambulance is currently busy on another trip." });
        }

        ambulanceToRollback = ambulanceId;

        const hospALat = hospA.location?.lat || 30.7046;
        const hospALng = hospA.location?.lng || 76.7179;
        const hospBLat = hospB.location?.lat || 30.7333;
        const hospBLng = hospB.location?.lng || 76.7794;

        const distance = await getDistance(hospALat, hospALng, hospBLat, hospBLng);

        const baseRate = ambulance.pricing?.fixedPrice || 1500;
        const baseDistance = ambulance.pricing?.baseDistance || 5;
        const pricePerKM = ambulance.pricing?.pricePerKM || 15;

        let surgePrice = 0;
        const extraDistance = distance - baseDistance;
        if (extraDistance > 0) {
            surgePrice = Math.round(extraDistance * pricePerKM);
        }

        let supportingStaffCharge = 0;
        let staffList = staffType ? (typeof staffType === 'string' ? staffType.split(',') : staffType) : [];
        staffList = staffList.map(s => s.trim());

        if (staffList.includes('Doctor')) {
            supportingStaffCharge += (ambulance.supportStaff?.doctor?.price || 0);
        }
        if (staffList.includes('Nurse')) {
            supportingStaffCharge += (ambulance.supportStaff?.nurse?.price || 0);
        }

        const totalFare = baseRate + surgePrice + supportingStaffCharge;

        const generatedBookingId = `HK-REF-${Date.now().toString().slice(-6)}`;
        // 🚀 SYNC FIX: Uses collision-proof caseReference generator
        const generatedCaseRef = generateCaseRef('Referral Ambulance');

        let finalPatientName = patientName || "Referred Patient";
        let finalPatientAge = patientAge || 30;
        let finalGender = gender || "Male";

        let appointment = null;
        if (appointmentId) {
            appointment = await Appointment.findOne({ _id: appointmentId, hospitalId: sendingHospitalId });
            if (appointment) {
                const patientObj = appointment.patients?.[0] || {};
                finalPatientName = patientObj.patientName || finalPatientName;
                finalPatientAge = patientObj.patientAge || finalPatientAge;
                finalGender = patientObj.gender || finalGender;
            }
        }

        ambulance.availableForEmergency = false;
        await ambulance.save();

        const AmbulanceBooking = require('../../models/AmbulanceBooking');
        const booking = await AmbulanceBooking.create({
            bookingId: generatedBookingId,
            caseReference: generatedCaseRef,
            userId: appointment ? appointment.userId : req.user.id,
            ambulanceId: ambulanceId,
            pickupHospitalId: sendingHospitalId,
            hospitalId: destinationHospitalId,
            serviceType: 'Referral Ambulance',
            status: 'Confirmed', 
            scheduledAt: scheduledDate ? new Date(scheduledDate) : new Date(),
            scheduledTime: scheduledTime || null,
            pickupLocation: {
                address: hospA.address || "Origin Hospital Base",
                lat: hospALat,
                lng: hospALng
            },
            patientDetails: {
                name: finalPatientName,
                age: finalPatientAge,
                gender: finalGender,
                condition: "Stable",
                emergencyDescription: `Referral transit from ${hospA.name} to ${hospB.name}. Reason: ${referralReason || 'Advanced clinical care'}`
            },
            pricing: {
                ambulanceCharge: baseRate,
                supportingStaffCharge,
                subtotal: totalFare,
                discount: 0,
                total: totalFare
            },
            paymentStatus: 'Pending',
            paymentMethod: 'COD',
            otp: Math.floor(1000 + Math.random() * 9000).toString(),
            trackingTimeline: [{
                status: 'Confirmed',
                timestamp: new Date(),
                note: `Referral booking confirmed from ${hospA.name} to ${hospB.name}. Scheduled on ${scheduledDate || 'today'} at ${scheduledTime || 'now'}.`
            }]
        });

        if (appointment) {
            appointment.specialServices.push({
                serviceName: `Referral Transfer to ${hospB.name} (${distance.toFixed(1)} km)`,
                price: totalFare
            });

            if (!appointment.pricingBreakdown) {
                appointment.pricingBreakdown = { baseFee: 0, visitCharges: 0, extraCharges: 0, discountAmount: 0, subtotal: 0 };
            }

            appointment.pricingBreakdown.extraCharges = (appointment.pricingBreakdown.extraCharges || 0) + totalFare;
            appointment.totalAmount = (appointment.totalAmount || 0) + totalFare;

            appointment.treatmentHistory.push({
                action: 'Transfer-Initiated',
                notes: `Referred and dispatched to ${hospB.name} via ${ambulance.name}. Reason: ${referralReason || 'Advanced care'}`,
                timestamp: new Date()
            });

            await appointment.save();
        }

        const { sendPushNotification } = require('../../utils/notification');
        
        await sendPushNotification(
            ambulanceId,
            'driver',
            "🚨 New Inter-Hospital Referral",
            `Dispatched from ${hospA.name} to drop-off patient ${finalPatientName} at ${hospB.name}.`,
            { bookingId: booking._id.toString(), type: 'new_referral' }
        );

        await sendPushNotification(
            destinationHospitalId,
            'hospital',
            "🚨 Incoming Referral Patient Alert!",
            `Hospital ${hospA.name} has referred patient ${finalPatientName} to your facility. Arriving shortly via Ambulance #${generatedBookingId}.`,
            { bookingId: booking._id.toString(), type: 'incoming_referral' }
        );

        res.status(201).json({
            success: true,
            message: `Referral Ambulance successfully scheduled from ${hospA.name} to ${hospB.name}.`,
            data: {
                booking,
                appointment: appointment || null
            }
        });

    } catch (error) {
        console.error("Book Referral Error:", error);
        if (ambulanceToRollback) {
            await Ambulance.findByIdAndUpdate(ambulanceToRollback, { 
                $set: { availableForEmergency: true } 
            });
        }
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- API: GET DESTINATION HOSPITALS FOR REFERRAL TRANSIT (Figma Dropdown Aligned) ---
// Endpoint: GET /hospital/panel/referrals/nearby-hospitals
const getReferralHospitals = async (req, res) => {
    try {
        const currentHospitalId = req.user.id; // Logged-in hospital
        const { search, city } = req.query;

        // Strictly query active/approved hospitals, excluding self
        let query = { 
            profileStatus: 'Approved', 
            isActive: true,
            _id: { $ne: currentHospitalId } // 🚀 SYNC FIX: Exclude self from dropdown list
        };

        if (city) query.city = { $regex: city, $options: 'i' };
        if (search) query.name = { $regex: search, $options: 'i' };

        const hospitals = await Hospital.find(query)
            .select('name address city state hospitalImage location isOnline')
            .lean();

        res.json({ 
            success: true, 
            count: hospitals.length, 
            data: hospitals 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


/////////////////////////////////////////////////////////////////
/////////////////////////// INSURANCE  ///////////////////////////
/////////////////////////////////////////////////////////////////

// @desc    Get Hospital Inpatients Filtered by Insurance Claim Status (TPA Desk Console)
// @route   GET /hospital/panel/insurance/patients
// @access  Private (Hospital Admin)
const getInsurancePatientsList = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { tab = 'Insured', claimStatus = 'All', search = '', page = 1, limit = 10 } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 10);
        const skip = (pageNum - 1) * limitNum;

        const hospObjId = new mongoose.Types.ObjectId(hospitalId);

        // 1. Base Query: Inpatients of this hospital in active/admission states
        let query = {
            hospitalId: hospObjId,
            bookingType: 'Admission',
            status: { $in: ['Hospital-Pending', 'Confirmed', 'In-Progress', 'Discharge-Pending'] }
        };

        // 2. Filter based on Insured vs Self-Pay
        if (tab === 'Insured') {
            query['insuranceDetails.hasInsurance'] = { $in: [true, 'true'] };
            // If claimStatus is not 'All', filter by specific approvalStatus
            if (claimStatus && claimStatus !== 'All' && String(claimStatus).trim() !== '') {
                query['insuranceDetails.approvalStatus'] = String(claimStatus).trim();
            }
        } else if (tab === 'Self-Pay') {
            query.$or = [
                { 'insuranceDetails.hasInsurance': false },
                { 'insuranceDetails.hasInsurance': { $exists: false } },
                { 'insuranceDetails': { $exists: false } }
            ];
        }

        // 3. Search Filter (Safe against empty search="")
        if (search && String(search).trim() !== '') {
            const cleanSearch = String(search).trim();
            const searchRegex = new RegExp(cleanSearch, 'i');
            const searchConditions = [
                { bookingId: searchRegex },
                { 'patients.patientName': searchRegex },
                { 'insuranceDetails.insuranceNumber': searchRegex }
            ];

            if (query.$or) {
                // Combine existing $or with search using $and
                query = {
                    $and: [
                        { ...query },
                        { $or: searchConditions }
                    ]
                };
            } else {
                query.$or = searchConditions;
            }
        }

        // 4. Execute parallel count and find queries (Crash-free)
        const [totalRecords, admissions] = await Promise.all([
            Appointment.countDocuments(query),
            Appointment.find(query)
                .populate('userId', 'name phone email profilePic age gender')
                .populate('doctorId', 'name speciality department profileImage')
                .populate({
                    path: 'bedId',
                    select: 'bedNumber pricePerDay status',
                    populate: { path: 'wardId', select: 'name type' }
                })
                .sort({ 'insuranceDetails.approvalStatus': 1, createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean()
        ]);

        const formatted = admissions.map(item => {
            const ins = item.insuranceDetails || {};
            const primaryPatient = (Array.isArray(item.patients) && item.patients.length > 0)
                ? item.patients[0]
                : { patientName: item.userId?.name || "Patient", patientAge: item.userId?.age || "N/A", gender: item.userId?.gender || "N/A" };

            return {
                appointmentId: item._id,
                bookingId: item.bookingId,
                status: item.status,
                admissionDate: item.startDate,
                patient: {
                    userId: item.userId?._id,
                    name: primaryPatient.patientName,
                    phone: item.address?.phone || item.userId?.phone || "N/A",
                    gender: primaryPatient.gender,
                    age: primaryPatient.patientAge
                },
                doctorName: item.doctorId ? `Dr. ${item.doctorId.name} (${item.doctorId.speciality})` : "Unassigned",
                bedNumber: item.bedNumber || item.bedId?.bedNumber || "N/A",
                wardName: item.wardName || item.bedId?.wardId?.name || "General Ward",
                totalEstimatedAmount: Number(item.totalAmount || 0),
                insurance: {
                    hasInsurance: Boolean(ins.hasInsurance),
                    insuranceNumber: ins.insuranceNumber || "N/A",
                    companyName: ins.companyName || "N/A",
                    insuranceType: ins.insuranceType || "Cashless",
                    cardFrontUrl: ins.insuranceDocumentFront || null,
                    cardBackUrl: ins.insuranceDocumentBack || null,
                    approvalLetterPdf: ins.approvalLetterPdf || null,
                    approvalStatus: ins.approvalStatus || 'Pending',
                    isApproved: ins.approvalStatus === 'Approved',
                    rejectionReason: ins.rejectionReason || null
                }
            };
        });

        return res.status(200).json({
            success: true,
            tab,
            claimStatus,
            totalRecords,
            totalPages: Math.ceil(totalRecords / limitNum),
            currentPage: pageNum,
            limit: limitNum,
            count: formatted.length,
            data: formatted
        });

    } catch (error) {
        console.error("Get Insurance Patients List Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch insurance patients list: " + error.message
        });
    }
};

// @desc    Hospital TPA Desk Uploads Cashless Approval Letter & Notifies Inpatient
// @route   PUT /hospital/panel/insurance/upload-approval-letter/:appointmentId
// @access  Private (Hospital Admin)
const uploadInsuranceApprovalLetter = async (req, res) => {
    try {
        const { appointmentId } = req.params;
        const hospitalId = req.user.id;
        const { approvalStatus = 'Approved', rejectionReason, approvedAmount } = req.body;

        const isObjectId = mongoose.isValidObjectId(appointmentId);
        const query = {
            hospitalId,
            bookingType: 'Admission',
            ...(isObjectId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const appointment = await Appointment.findOne(query).populate('userId', 'name phone fcmToken');
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Inpatient admission record not found." });
        }

        if (!appointment.insuranceDetails) {
            appointment.insuranceDetails = { hasInsurance: true };
        }

        // 1. Handle Approval Letter PDF Upload
        if (req.file) {
            if (appointment.insuranceDetails.approvalLetterPdf) {
                deleteFile(appointment.insuranceDetails.approvalLetterPdf);
            }
            appointment.insuranceDetails.approvalLetterPdf = `/uploads/insurance_approvals/${req.file.filename}`;
        }

        const cleanStatus = approvalStatus === 'Rejected' ? 'Rejected' : 'Approved';
        appointment.insuranceDetails.approvalStatus = cleanStatus;

        if (cleanStatus === 'Rejected') {
            appointment.insuranceDetails.rejectionReason = rejectionReason || "Declined by Insurance TPA Desk";
        } else {
            appointment.insuranceDetails.rejectionReason = null;
        }

        await appointment.save();

        // 🚨 2. PUSH NOTIFICATION: Alert Patient of Cashless Claim Status
        if (appointment.userId) {
            try {
                const isApproved = cleanStatus === 'Approved';
                const notifTitle = isApproved ? "🎉 Cashless Insurance Approved!" : "⚠️ Insurance Claim Declined";
                const notifMsg = isApproved
                    ? `Your cashless claim for Hospital Admission #${appointment.bookingId} has been approved by TPA desk. Download approval letter from app.`
                    : `Your insurance claim for Admission #${appointment.bookingId} was declined (${rejectionReason || 'Policy terms'}). Please visit TPA desk.`;

                await sendPushNotification(
                    appointment.userId._id,
                    'user',
                    notifTitle,
                    notifMsg,
                    { 
                        appointmentId: appointment._id.toString(), 
                        type: 'insurance_claim_status_updated',
                        status: cleanStatus 
                    }
                );
            } catch (notifErr) {
                console.error("Insurance Status Push Notification Error:", notifErr.message);
            }
        }

        return res.status(200).json({
            success: true,
            message: `Insurance approval letter uploaded. Claim marked as ${cleanStatus}. Patient notified.`,
            data: appointment.insuranceDetails
        });

    } catch (error) {
        console.error("Upload Insurance Approval Letter Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};



// @desc    Get Active Insurance Master Companies for TPA Desk Dropdown
// @route   GET /hospital/panel/insurance/master-data
// @access  Private (Hospital Admin)
const getInsuranceMasterDropdowns = async (req, res) => {
    try {
        const companies = await Insurance.find({ isActive: true })
            .sort({ provider: 1, insuranceName: 1 })
            .lean();

        const providers = [...new Set(companies.map(c => c.provider))].filter(Boolean);

        return res.status(200).json({
            success: true,
            count: companies.length,
            providers,
            data: companies.map(c => ({
                _id: c._id,
                provider: c.provider,
                insuranceName: c.insuranceName,
                type: c.type,
                displayName: `${c.provider} - ${c.insuranceName} (${c.type.toUpperCase()})`
            }))
        });

    } catch (error) {
        console.error("Get Insurance Master Dropdowns Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Hospital TPA Desk Saves/Updates Patient Insurance & Syncs Active Inpatient Admission
// @route   PUT /hospital/panel/insurance/save/:patientUserId
// @access  Private (Hospital Admin)
const savePatientInsuranceDetails = async (req, res) => {
    try {
        const { patientUserId } = req.params;
        const hospitalId = req.user.id;
        const {
            insuranceNumber,
            companyName,
            insuranceType,
            startDate,
            endDate,
            masterInsuranceId,
            appointmentId // Optional: Direct link to specific admission
        } = req.body;

        if (!mongoose.isValidObjectId(patientUserId)) {
            return res.status(400).json({ success: false, message: "Invalid patientUserId format." });
        }

        const user = await User.findById(patientUserId);
        if (!user) {
            return res.status(404).json({ success: false, message: "Patient user profile not found." });
        }

        const files = req.files || {};
        const existingInsurance = user.insuranceDetails || {};

        // 1. Resolve Front & Back Card Photos (from files or keep existing)
        let frontCardPath = existingInsurance.insuranceDocumentFront || null;
        let backCardPath = existingInsurance.insuranceDocumentBack || null;
        let docPath = existingInsurance.insuranceDocument || null;

        const frontFile = (files.insuranceDocumentFront && files.insuranceDocumentFront[0]) ||
                          (files.insuranceFront && files.insuranceFront[0]) ||
                          (files.frontImage && files.frontImage[0]);

        const backFile = (files.insuranceDocumentBack && files.insuranceDocumentBack[0]) ||
                         (files.insuranceBack && files.insuranceBack[0]) ||
                         (files.backImage && files.backImage[0]);

        const policyDocFile = (files.insuranceDocument && files.insuranceDocument[0]);

        if (frontFile) {
            if (existingInsurance.insuranceDocumentFront) deleteFile(existingInsurance.insuranceDocumentFront);
            frontCardPath = `/uploads/insurance/${frontFile.filename}`;
        }

        if (backFile) {
            if (existingInsurance.insuranceDocumentBack) deleteFile(existingInsurance.insuranceDocumentBack);
            backCardPath = `/uploads/insurance/${backFile.filename}`;
        }

        if (policyDocFile) {
            if (existingInsurance.insuranceDocument) deleteFile(existingInsurance.insuranceDocument);
            docPath = `/uploads/insurance/${policyDocFile.filename}`;
        }

        // 2. Resolve Master Insurance Plan Name
        let resolvedCompanyName = companyName ? String(companyName).trim() : (existingInsurance.companyName || "");
        let validMasterId = null;

        if (masterInsuranceId && mongoose.isValidObjectId(String(masterInsuranceId).trim())) {
            validMasterId = new mongoose.Types.ObjectId(String(masterInsuranceId).trim());
            const masterIns = await Insurance.findById(validMasterId).lean();
            if (masterIns) {
                resolvedCompanyName = masterIns.insuranceName;
            }
        }

        // 3. Update User Document
        const updatedInsuranceObj = {
            hasInsurance: true,
            insuranceNumber: insuranceNumber ? String(insuranceNumber).trim() : (existingInsurance.insuranceNumber || ""),
            companyName: resolvedCompanyName,
            insuranceType: insuranceType ? String(insuranceType).trim() : (existingInsurance.insuranceType || "Cashless"),
            startDate: startDate || existingInsurance.startDate || "",
            endDate: endDate || existingInsurance.endDate || "",
            insuranceDocument: docPath,
            insuranceDocumentFront: frontCardPath,
            insuranceDocumentBack: backCardPath,
            masterInsuranceId: validMasterId || existingInsurance.masterInsuranceId || null
        };

        user.insuranceDetails = updatedInsuranceObj;
        if (validMasterId) {
            user.insuranceId = validMasterId;
        }
        await user.save();

        // 🚨 4. CRITICAL FIX: Sync with Patient's Active Hospital Admission (Appointment)
        const apptQuery = {
            hospitalId,
            userId: user._id,
            bookingType: 'Admission',
            status: { $in: ['Hospital-Pending', 'Confirmed', 'In-Progress', 'Discharge-Pending'] }
        };

        if (appointmentId && mongoose.isValidObjectId(appointmentId)) {
            apptQuery._id = appointmentId;
        }

        const activeAdmission = await Appointment.findOne(apptQuery);

        if (activeAdmission) {
            activeAdmission.insuranceDetails = {
                hasInsurance: true,
                insuranceNumber: updatedInsuranceObj.insuranceNumber,
                companyName: updatedInsuranceObj.companyName,
                insuranceType: updatedInsuranceObj.insuranceType,
                insuranceDocument: docPath,
                insuranceDocumentFront: frontCardPath,
                insuranceDocumentBack: backCardPath,
                masterInsuranceId: validMasterId || activeAdmission.insuranceDetails?.masterInsuranceId || null,
                approvalLetterPdf: activeAdmission.insuranceDetails?.approvalLetterPdf || null,
                approvalStatus: activeAdmission.insuranceDetails?.approvalStatus || 'Pending'
            };
            await activeAdmission.save();
        }

        return res.status(200).json({
            success: true,
            message: "Patient insurance and active hospital admission records successfully synchronized.",
            data: {
                userInsurance: updatedInsuranceObj,
                syncedAdmissionId: activeAdmission ? activeAdmission._id : null
            }
        });

    } catch (error) {
        console.error("Save Patient Insurance Details Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};



// @desc    Hospital Admin Approves or Rejects Doctor Leave Request
// @route   PATCH /hospital/panel/doctors/leave-approval
// @access  Private (Hospital Admin)
const manageDoctorLeaveByHospital = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { doctorId, leaveId, action, rejectionReason } = req.body; // action: 'Approved' | 'Rejected'

        if (!doctorId || !leaveId || !action || !['Approved', 'Rejected'].includes(action)) {
            return res.status(400).json({
                success: false,
                message: "doctorId, leaveId, and action ('Approved' or 'Rejected') are required."
            });
        }

        const doctor = await Doctor.findOne({ _id: doctorId, hospitalId });
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found in this hospital." });
        }

        const targetLeave = (doctor.leaves || []).id(leaveId);
        if (!targetLeave) {
            return res.status(404).json({ success: false, message: "Leave record not found." });
        }

        if (targetLeave.status !== 'Pending') {
            return res.status(400).json({ success: false, message: `Leave is already ${targetLeave.status}.` });
        }

        targetLeave.status = action;
        targetLeave.reviewedAt = new Date();
        if (action === 'Rejected') {
            targetLeave.rejectionReason = rejectionReason || "Hospital operational requirements / patient commitments.";
        }

        await doctor.save();

        // Notify Doctor on Mobile
        try {
            await sendPushNotification(
                doctor._id,
                'doctor',
                `Leave Request ${action}!`,
                action === 'Approved'
                    ? `Your leave from ${moment(targetLeave.startDate).format('DD MMM')} to ${moment(targetLeave.endDate).format('DD MMM')} has been Approved.`
                    : `Your leave was Rejected. Reason: "${targetLeave.rejectionReason}".`,
                { leaveId: targetLeave._id.toString(), type: 'doctor_leave_status_updated' }
            );
        } catch (e) {}

        res.status(200).json({
            success: true,
            message: `Doctor leave request marked as ${action} successfully.`,
            data: targetLeave
        });

    } catch (error) {
        console.error("Manage Doctor Leave Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// @desc    Get All Hospital Doctors Leaves in Single Consolidated API (With Summary Counters & Search)
// @route   GET /hospital/panel/doctors/leaves
// @access  Private (Hospital Admin)
const getHospitalDoctorPendingLeaves = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { status = 'Pending', search, doctorId } = req.query;

        // Base query: All active/approved doctors under this hospital having at least 1 leave record
        let docQuery = { 
            hospitalId, 
            'leaves.0': { $exists: true } 
        };

        if (doctorId && mongoose.isValidObjectId(doctorId)) {
            docQuery._id = doctorId;
        }

        if (search && search.trim() !== '') {
            docQuery.$or = [
                { name: { $regex: search.trim(), $options: 'i' } },
                { speciality: { $regex: search.trim(), $options: 'i' } }
            ];
        }

        const doctors = await Doctor.find(docQuery)
            .select('name speciality profileImage department fees leaves')
            .lean();

        let pendingCount = 0;
        let approvedCount = 0;
        let rejectedCount = 0;
        const leavesList = [];

        doctors.forEach(doc => {
            (doc.leaves || []).forEach(l => {
                // Calculate Status Summary Counters
                if (l.status === 'Pending') pendingCount++;
                else if (l.status === 'Approved') approvedCount++;
                else if (l.status === 'Rejected') rejectedCount++;

                // Apply Status Filter
                const isStatusMatch = (status === 'All' || l.status === status);

                if (isStatusMatch) {
                    const sMoment = moment(l.startDate);
                    const eMoment = moment(l.endDate);
                    const totalDays = Math.max(1, eMoment.diff(sMoment, 'days') + 1);

                    leavesList.push({
                        leaveId: l._id,
                        doctorId: doc._id,
                        doctorName: doc.name,
                        speciality: doc.speciality,
                        doctorProfileImage: doc.profileImage || null,
                        opdRoomNumber: doc.department?.roomNumber || "Cabin 1",
                        startDate: l.startDate,
                        endDate: l.endDate,
                        formattedStartDate: sMoment.format('YYYY-MM-DD'),
                        formattedEndDate: eMoment.format('YYYY-MM-DD'),
                        formattedDateRange: `${sMoment.format('DD MMM YYYY')} - ${eMoment.format('DD MMM YYYY')}`,
                        totalDays: `${totalDays} Day(s)`,
                        reason: l.reason,
                        status: l.status,
                        rejectionReason: l.rejectionReason || "",
                        appliedAt: l.appliedAt,
                        formattedAppliedAt: moment(l.appliedAt).format('DD MMM YYYY, hh:mm A')
                    });
                }
            });
        });

        // Sort: Latest applied leaves first
        leavesList.sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt));

        res.status(200).json({
            success: true,
            filterApplied: status,
            count: leavesList.length,
            // 📊 Summary Counters for Frontend Tabs Badges
            overview: {
                totalLeaves: pendingCount + approvedCount + rejectedCount,
                pendingCount,
                approvedCount,
                rejectedCount
            },
            data: leavesList
        });

    } catch (error) {
        console.error("Get Hospital Doctor Leaves Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
// @desc    Hospital Admin Reschedules Any Appointment (OPD or IPD Admission)
// @route   POST /hospital/panel/appointments/reschedule
// @access  Private (Hospital Admin)
const hospitalAdminRescheduleAppointment = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { appointmentId, newDate, newTimeSlot, newDoctorId, reason } = req.body;

        if (!appointmentId || !newDate || !reason) {
            return res.status(400).json({
                success: false,
                message: "appointmentId, newDate, and explanation reason are mandatory."
            });
        }

        const isObjectId = mongoose.isValidObjectId(appointmentId);
        const query = {
            hospitalId,
            ...(isObjectId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const appointment = await Appointment.findOne(query).populate('userId', 'name phone fcmToken');
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment record not found in this hospital." });
        }

        const targetDate = moment(newDate).startOf('day').toDate();
        const endOfDay = moment(newDate).endOf('day').toDate();
        const targetDoctorId = (newDoctorId && mongoose.isValidObjectId(newDoctorId)) ? newDoctorId : appointment.doctorId;

        // OPD Reschedule Logic
        if (appointment.bookingType === 'OPD') {
            const todayBookingsCount = await Appointment.countDocuments({
                hospitalId,
                doctorId: targetDoctorId,
                bookingType: 'OPD',
                appointmentDate: { $gte: targetDate, $lte: endOfDay },
                status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital'] }
            });
            const newTokenNumber = todayBookingsCount + 1;

            appointment.appointmentDate = targetDate;
            appointment.appointmentTime = newTimeSlot || appointment.appointmentTime;
            appointment.doctorId = targetDoctorId;
            appointment.tokenNumber = newTokenNumber;
            appointment.rescheduleReason = `Hospital Admin Rescheduled: ${reason.trim()}`;
            appointment.rescheduleCount = (appointment.rescheduleCount || 0) + 1;
            appointment.status = 'Rescheduled';

            await appointment.save();

            // Notify Patient
            if (appointment.userId) {
                try {
                    await sendPushNotification(
                        appointment.userId._id,
                        'user',
                        "Hospital Rescheduled Your OPD Consultation",
                        `Your OPD visit has been moved to ${moment(newDate).format('DD MMM')} (${appointment.appointmentTime}). New Token is #${newTokenNumber}. Reason: "${reason.trim()}"`,
                        { appointmentId: appointment._id.toString(), type: 'hospital_rescheduled_opd', tokenNumber: newTokenNumber }
                    );
                } catch (e) {}
            }

            return res.status(200).json({
                success: true,
                message: `OPD Appointment rescheduled by Hospital Admin. New Token #${newTokenNumber}. Patient notified.`,
                tokenNumber: newTokenNumber,
                data: appointment
            });
        }

        // IPD Admission Reschedule
        appointment.startDate = targetDate;
        appointment.rescheduleReason = `Hospital Admin Rescheduled: ${reason.trim()}`;
        appointment.rescheduleCount = (appointment.rescheduleCount || 0) + 1;
        appointment.status = 'Hospital-Pending';
        await appointment.save();

        res.status(200).json({
            success: true,
            message: "IPD Admission rescheduled by Hospital Admin.",
            data: appointment
        });

    } catch (error) {
        console.error("Hospital Admin Reschedule Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get Hospital Live OPD Cabins & Token Queue Display (For Hospital Lobby TV / Reception LED)
// @route   GET /hospital/panel/opd/live-cabins
// @access  Private (Hospital Admin)
const getHospitalLiveCabinsOverview = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const todayStart = moment().startOf('day').toDate();
        const todayEnd = moment().endOf('day').toDate();

        // 1. Fetch all doctors in this hospital having OPD active
        const doctors = await Doctor.find({
            hospitalId,
            profileStatus: 'Approved',
            isActive: true
        }).select('name speciality profileImage department fees slotDuration consultationStatus').lean();

        // 2. Fetch all of today's OPD appointments for this hospital
        const todayAppointments = await Appointment.find({
            hospitalId,
            bookingType: 'OPD',
            appointmentDate: { $gte: todayStart, $lte: todayEnd },
            status: { $nin: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital'] }
        }).sort({ tokenNumber: 1 }).select('doctorId tokenNumber status appointmentTime patients').lean();

        // 3. Aggregate live queue metrics per cabin/doctor
        const cabinsData = doctors.map(doc => {
            const docAppts = todayAppointments.filter(a => String(a.doctorId) === String(doc._id));
            const activeConsulting = docAppts.find(a => a.status === 'In-Progress');
            const completedCount = docAppts.filter(a => a.status === 'Completed').length;
            const waitingCount = docAppts.filter(a => ['Confirmed', 'Hospital-Pending'].includes(a.status)).length;

            const currentToken = activeConsulting 
                ? activeConsulting.tokenNumber 
                : (docAppts.length > 0 ? (completedCount + 1) : null);

            return {
                doctorId: doc._id,
                doctorName: doc.name,
                speciality: doc.speciality,
                doctorProfileImage: doc.profileImage || null,
                opdRoomNumber: doc.department?.roomNumber || "Cabin 1",
                isOpdEnabled: doc.consultationStatus?.clinic ?? true,
                liveQueue: {
                    totalScheduledToday: docAppts.length,
                    currentServingToken: currentToken,
                    activePatientName: activeConsulting?.patients?.[0]?.patientName || null,
                    patientsWaiting: waitingCount,
                    consultationsCompleted: completedCount,
                    status: activeConsulting ? "Consulting" : (waitingCount > 0 ? "Next Patient Ready" : "Available / Waiting")
                }
            };
        });

        res.status(200).json({
            success: true,
            date: moment().format('YYYY-MM-DD'),
            totalCabins: cabinsData.length,
            data: cabinsData
        });

    } catch (error) {
        console.error("Get Hospital Live Cabins Overview Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// @desc    Hospital Admin / In-House Pharmacy Desk Fetches OPD Prescription (Enforced Hospital Tenancy)
// @route   GET /hospital/panel/prescriptions/:appointmentId
// @access  Private (Hospital Admin / Reception Desk)
const getHospitalPrescriptionByAppointment = async (req, res) => {
    try {
        const { appointmentId } = req.params;
        const hospitalId = req.user.id; // Hospital token id

        // 1. Verify Appointment belongs to this specific hospital
        const isObjectId = mongoose.isValidObjectId(appointmentId);
        const apptQuery = {
            hospitalId,
            ...(isObjectId ? { _id: appointmentId } : { bookingId: String(appointmentId).trim() })
        };

        const appointment = await Appointment.findOne(apptQuery)
            .populate('doctorId', 'name speciality qualification councilNumber department profileImage')
            .populate('userId', 'name phone gender dob age')
            .lean();

        if (!appointment) {
            return res.status(404).json({ 
                success: false, 
                message: "Appointment record not found in this hospital or unauthorized." 
            });
        }

        // 2. Fetch the digital prescription linked with this appointment
        const prescription = await Prescription.findOne({ appointmentId: appointment._id }).lean();

        if (!prescription) {
            return res.status(404).json({ 
                success: false, 
                message: "No prescription record found for this appointment." 
            });
        }

        // 3. Return enriched NMC formulation data with hospital header for in-house dispensing & billing
        res.status(200).json({
            success: true,
            message: "Prescription details fetched successfully for hospital panel.",
            data: {
                prescriptionId: prescription._id,
                appointment: {
                    id: appointment._id,
                    bookingId: appointment.bookingId,
                    tokenNumber: appointment.tokenNumber,
                    bookingType: appointment.bookingType,
                    appointmentDate: appointment.appointmentDate,
                    appointmentTime: appointment.appointmentTime,
                    status: appointment.status
                },
                hospitalHeader: {
                    id: req.user._id,
                    name: req.user.name,
                    address: req.user.address || "",
                    city: req.user.city || "",
                    phone: req.user.phone || "",
                    image: req.user.hospitalImage?.[0] || null
                },
                doctorDetails: {
                    id: appointment.doctorId?._id,
                    name: appointment.doctorId?.name || "Doctor",
                    speciality: appointment.doctorId?.speciality || "Specialist",
                    qualification: appointment.doctorId?.qualification || "MBBS",
                    registrationNumber: appointment.doctorId?.councilNumber || "N/A",
                    cabinRoom: appointment.doctorId?.department?.roomNumber || "Cabin",
                    image: appointment.doctorId?.profileImage || null
                },
                patientDetails: {
                    id: appointment.userId?._id,
                    name: appointment.patients?.[0]?.patientName || appointment.userId?.name || "Patient",
                    phone: appointment.userId?.phone || "N/A",
                    age: appointment.patients?.[0]?.patientAge || appointment.userId?.age || 30,
                    gender: appointment.patients?.[0]?.gender || appointment.userId?.gender || "Male"
                },
                clinicalNotes: {
                    chiefComplaints: prescription.chiefComplaints || "",
                    diagnosis: prescription.diagnosis || [],
                    vitals: prescription.vitals || appointment.clinicalSummary?.vitals || {},
                    advisedInvestigations: prescription.advisedInvestigations || "None",
                    adviceGiven: prescription.adviceGiven || "",
                    specialInstructions: prescription.specialInstructions || "",
                    nextAppointment: prescription.nextAppointment || ""
                },
                medicines: (prescription.medicines || []).map(m => ({
                    name: m.name,
                    strength: m.strength || "",
                    doseInterval: m.doseInterval || m.dose || "1-0-0",
                    frequency: m.frequency || "q.d.",
                    duration: m.duration || "5 days",
                    dispenseQuantity: m.dispenseQuantity || "10 Tablets",
                    administrationTiming: m.administrationTiming || m.instructions || "p.c. (After meals)",
                    isCustomGeneric: m.isCustomGeneric || false,
                    genericComposition: m.genericComposition || ""
                })),
                medicinesCount: prescription.medicines ? prescription.medicines.length : 0,
                pdfUrl: prescription.pdfUrl || appointment.clinicalSummary?.dischargeSummaryPdf || null,
                dietPlanPdf: prescription.dietPlanPdf || null,
                generatedAt: prescription.createdAt
            }
        });

    } catch (error) {
        console.error("Get Hospital Prescription Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = { 
    getHospitalMasterData,getHospitalDashboardStats,
    createWardUnit,getBedsInWard,updateBedDetails,admitPatientToBed, updateWardBeds,deleteSpecificBed, addHospitalService, updateHospitalService, 
    generateFinalBillAndDischarge, 

    generateHospitalCoupon, getHospitalCoupons,updateHospitalCoupon,toggleCouponStatus,

    getHospitalWards, updateWardInfo, deleteWard, getAllHospitalAdmissions,
    getHospitalServices, getWardStatus,updateBedStatus,assignDoctorToAdmission, getAvailableDrivers, assignDriverToCase,
    getIncomingReferrals, getEmergencyCases, trackAllAmbulances,toggleAmbulanceStatus,
    updateHospitalTerms, getHospitalTerms, getHospitalPanelRatings,
    getDailyOccupancy, finalizeDischarge, setHospitalShift , getHospitalReferralBookings,
    updateBedPrice, uploadHospitalTermsPdf ,getHospitalHistory,
    emergencyDischarge,getHospitalCaseDetails,getHospitalPendingDischarges,
    dispatchAmbulanceForAdmission,reassignAmbulanceOnBreakdown,
    reassignDoctorFromPanel,reportHospitalNoShow,transferPatientBed,
     getTrackCasesList,
    getTrackCaseSuperDetails,
    getAvailableDischargeAmbulances,
    calculateDischargeAmbulanceFare,
    dispatchDischargeAmbulance,cancelDischargeAmbulance,bookHospitalToHospitalReferral,getReferralHospitals,
    getInsurancePatientsList,uploadInsuranceApprovalLetter,
    getInsuranceMasterDropdowns,
    savePatientInsuranceDetails,
    manageDoctorLeaveByHospital,
    getHospitalDoctorPendingLeaves,
    hospitalAdminRescheduleAppointment,
    getHospitalLiveCabinsOverview,getHospitalPrescriptionByAppointment
};