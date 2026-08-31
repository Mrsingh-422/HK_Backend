const Hospital = require('../../models/Hospital');
const Ward = require('../../models/Ward');
const Bed = require('../../models/Bed');
const HospitalService = require('../../models/HospitalService');
const Appointment = require('../../models/Appointment');
const Coupon = require('../../models/Coupon');
const Specialization = require('../../models/Specialization');
const Ambulance = require('../../models/Ambulance');
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

const getShortName = (name) => {
    return name.split(' ').map(word => word[0]).join('').toUpperCase();
};
const generateCaseRef = (type) => {
    const prefix = type === 'Accident emergency' ? 'ACC' : (type === 'Referral Ambulance' ? 'REF' : 'MED');
    const randomHex = crypto.randomBytes(2).toString('hex').toUpperCase();
    const timeSlice = Date.now().toString().slice(-4);
    return `HK-${new Date().getFullYear()}-${prefix}-${timeSlice}${randomHex}`;
};

// --- MASTER DATA/Enums FOR HOSPITAL PANEL (Screenshot 6) ---
const getHospitalMasterData = async (req, res) => {
    try {
        // 1. Fetch Specializations from Database
        const specialities = await Specialization.find({ isActive: true }).select('name');

        // 2. Extract Enums dynamically from Mongoose Schemas
        const hospitalTypes = Hospital.schema.path('type').enumValues;
        const ambulanceTypes = Ambulance.schema.path('vehicleType').enumValues;
        const wardTypes = Ward.schema.path('type').enumValues;
        
        // Agar aapne triage facility model mein rkha hai toh wahan se, 
        // warna agar Appointment model mein enum hai toh wahan se pick karein
        // const triageOptions = Appointment.schema.path('triage').enumValues; 

        res.json({
            success: true,
            data: {
                specialities,
                hospitalTypes, // ['Govt', 'Private', 'Charity']
                ambulanceTypes, // ['BLS', 'ALS', 'ICU Ambulance']
                wardTypes,      // ['ICU', 'Ward']
                insuranceCompanies: ['HDFC', 'LIC', 'SBI', 'AXIS', 'KOTAK'] // Ye alag model se bhi aa sakta hai
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- GET HOSPITAL DASHBOARD STATS ---
// Endpoint: GET /hospital/panel/dashboard-stats
const getHospitalDashboardStats = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const todayStart = moment().startOf('day').toDate();
        const todayEnd = moment().endOf('day').toDate();

        // Safe Status arrays for dynamic real-time tracking
        const activeEmergencyStates = [
            'Confirmed', 
            'Arrived', 
            'Picked-Up', 
            'En-Route', 
            'In-Progress', 
            'Hospital-Pending'
        ];

        // Parallel collection execution for ultra-fast API speed
        const [
            emergencyActive,       
            directAdmissions,      
            emergencyDischarges,   // Tab 3: Emergency ready for discharge
            hospitalDischarges,    // Tab 4: Direct ready for discharge
            referralAmbulances,    
            historyRecords         
        ] = await Promise.all([
            
            // Tab 1: Emergency Case count (Includes active transit states so counts remain accurate during travel)
            Appointment.countDocuments({
                hospitalId,
                ambulanceId: { $ne: null, $exists: true },
                status: { $in: activeEmergencyStates } // 🚀 FIXED
            }),

            // Tab 2: Hospital Admission count (direct and status pending)
            Appointment.countDocuments({
                hospitalId,
                bookingType: 'Admission',
                $or: [
                    { ambulanceId: null },
                    { ambulanceId: { $exists: false } }
                ],
                status: 'Hospital-Pending'
            }),

            // Tab 3: Emergency Discharge (Brought by ambulance and clinically ready: Discharge-Pending)
            Appointment.countDocuments({
                hospitalId,
                ambulanceId: { $ne: null, $exists: true },
                status: 'Discharge-Pending'
            }),

            // Tab 4: Hospital Discharge (Direct admissions clinically ready: Discharge-Pending)
            Appointment.countDocuments({
                hospitalId,
                bookingType: 'Admission',
                $or: [
                    { ambulanceId: null },
                    { ambulanceId: { $exists: false } }
                ],
                status: 'Discharge-Pending'
            }),

            // Tab 5: Referral Ambulance count
            AmbulanceBooking.countDocuments({
                hospitalId,
                serviceType: 'Referral Ambulance',
                status: { $in: ['Searching', 'Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] }
            }),

            // Tab 6: History Completed count
            Appointment.countDocuments({
                hospitalId,
                status: 'Completed'
            })
        ]);

        const topEmergency = emergencyActive; 
        const topAdmission = directAdmissions;
        const topDischarge = emergencyDischarges + hospitalDischarges; // Dynamic combined discharge pool

        res.json({
            success: true,
            data: {
                emergency: topEmergency,
                admission: topAdmission,
                discharge: topDischarge,

                servicesTabs: {
                    emergencyCase: emergencyActive,            
                    hospitalAdmission: directAdmissions,       
                    emergencyDischarge: emergencyDischarges,   
                    hospitalDischarge: hospitalDischarges,     
                    referralAmbulance: referralAmbulances,     
                    history: historyRecords                    
                }
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
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

// --- 2. GET BEDS BY WARD (For Grid View in Figma Screenshot 27) ---
const getBedsInWard = async (req, res) => {
    try {
        const beds = await Bed.find({ wardId: req.params.wardId });
        res.json({ success: true, data: beds });
    } catch (error) { res.status(500).json({ message: error.message }); }
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


// --- 3. ADMIT PATIENT (Admin Panel Flow) ---
const admitPatientToBed = async (req, res) => {
    try {
        const { appointmentId, bedId, startDate, endDate } = req.body;

        // 1. Fetch Target Bed
        const bed = await Bed.findById(bedId);
        if (!bed) {
            return res.status(404).json({ success: false, message: "Selected Bed not found in system." });
        }

        // Validate physical maintenance lock
        if (bed.status === 'Maintenance') {
            return res.status(400).json({ success: false, message: "Selected bed is currently under maintenance." });
        }

        // 2. Fetch Target Appointment
        const appointment = await Appointment.findOne({ _id: appointmentId, hospitalId: req.user.id });
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Admission request record not found." });
        }

        // Standardise check-in & check-out dates
        const start = startDate ? moment(startDate).startOf('day').toDate() : (appointment.startDate || moment().startOf('day').toDate());
        const end = endDate ? moment(endDate).endOf('day').toDate() : (appointment.endDate || moment().add(1, 'days').endOf('day').toDate());

        // 3. STRICT DOUBLE-BOOKING VALIDATION ON CHECK-IN
        const isAlreadyBooked = await Appointment.findOne({
            _id: { $ne: appointmentId },
            bedId: bedId,
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending', 'Discharge-Pending'] },
            $and: [
                { startDate: { $lte: end } },
                { endDate: { $gte: start } }
            ]
        });

        if (isAlreadyBooked) {
            return res.status(400).json({
                success: false,
                message: "Selected dates ke liye ye bed pehle se hi occupied hai. Kripya doosra bed ya date range choose karein."
            });
        }

        // 4. Update physical Bed status to Occupied
        bed.status = 'Occupied';
        await bed.save();

        // 🚀 SYNC FIX: Safely decrement Ward availableBeds counter on physical bed check-in
        await Ward.findByIdAndUpdate(bed.wardId, { $inc: { availableBeds: -1 } });

        // 5. Update and Sync Appointment record
        appointment.bedId = bedId;
        appointment.bedNumber = bed.bedNumber;
        
        const ward = await Ward.findById(bed.wardId);
        appointment.wardName = ward ? ward.name : appointment.wardName;

        appointment.startDate = start;
        appointment.endDate = end;
        appointment.status = 'In-Progress'; // Patient is now physically in the bed

        await appointment.save();

        res.json({ 
            success: true, 
            message: `Patient admitted successfully to ${ward ? ward.name : 'Ward'} - ${bed.bedNumber}`, 
            data: appointment 
        });

    } catch (error) {
        console.error("Admit patient error:", error);
        res.status(500).json({ success: false, message: error.message });
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
// 2. GET WARD CAPACITY & UNITS (Screenshot 7)
const getWardStatus = async (req, res) => {
    try {
        const wards = await Ward.find({ hospitalId: req.user.id });
        res.json({ success: true, data: wards });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 2. UPDATE INDIVIDUAL BED STATUS (Figma Screenshot 27/28) ---
// Used when Admin manually marks a bed for Maintenance or releases it
const updateBedStatus = async (req, res) => {
    try {
        const { bedId, status } = req.body;
        const bed = await Bed.findById(bedId);
        const oldStatus = bed.status;
        bed.status = status;
        await bed.save();

        if(oldStatus !== 'Available' && status === 'Available') {
            await Ward.findByIdAndUpdate(bed.wardId, { $inc: { availableBeds: 1 } });
        } else if(oldStatus === 'Available' && status !== 'Available') {
            await Ward.findByIdAndUpdate(bed.wardId, { $inc: { availableBeds: -1 } });
        }
        res.json({ success: true, data: bed });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// POST /hospital/panel/admissions/assign-doctor
// Updated: Verified hospital doctor fleet matching and automatically initiated clinical shift tracking
const assignDoctorToAdmission = async (req, res) => {
    try {
        const { appointmentId, doctorId } = req.body;
        const hospitalId = req.user.id; // Logged-in Hospital Admin

        // 1. Fetch Target Appointment
        const appointment = await Appointment.findOne({ _id: appointmentId, hospitalId });
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Admission request not found on your hospital console." });
        }

        // 2. Fetch and Validate Doctor (Verify they belong strictly to this hospital and are active)
        const Doctor = require('../../models/Doctor'); // Path-safe local load
        const doctor = await Doctor.findOne({ 
            _id: doctorId, 
            hospitalId,
            isActive: true,
            profileStatus: 'Approved'
        });

        if (!doctor) {
            return res.status(400).json({ 
                success: false, 
                message: "Selected doctor is either inactive, unapproved, or does not belong to your hospital fleet." 
            });
        }

        const now = new Date();

        // 3. Assign Doctor & Start Treatment Shift Tracking Timeline (Doctor Panel Sync)
        appointment.doctorId = doctorId;
        appointment.status = 'Confirmed'; // Confirms the pending admission request

        appointment.treatmentHistory.push({
            toDoctorId: doctorId,
            action: 'Initial-Assignment',
            notes: `Assigned Dr. ${doctor.name} from Hospital Admin Control Desk.`,
            timestamp: now,
            startTime: now // 🚀 Starts doctor's active treatment shift instantly!
        });

        await appointment.save();

        // 4. Trigger Push Notification to the assigned Doctor (Figma Alerts Sync)
        const { sendPushNotification } = require('../../utils/notification');
        await sendPushNotification(
            doctorId,
            'doctor',
            "🚨 New Case Assigned!",
            `You have been assigned as the primary physician for patient case #${appointment.bookingId}. Please review dossier.`,
            { appointmentId: appointment._id.toString(), type: 'new_case_assigned' }
        );

        res.json({ 
            success: true, 
            message: `Dr. ${doctor.name} successfully assigned to case and clinical shift tracking activated.`,
            data: appointment 
        });

    } catch (error) { 
        console.error("Assign Doctor Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
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
// --- 3. FINAL DISCHARGE & DYNAMIC BILLING (Full Code - Auto-closes open specialist care shifts on checkout) ---
// Updated: Added Active Transit Guard to prevent premature fleet release when patient is being driven home
const generateFinalBillAndDischarge = async (req, res) => {
    try {
        const { appointmentId, billingItems } = req.body; 
        const hospitalId = req.user.id;

        const appointment = await Appointment.findOne({ _id: appointmentId, hospitalId });
        if (!appointment) return res.status(404).json({ success: false, message: "Admission Record Not Found" });

        const previousTotalAmount = appointment.totalAmount || 0;
        let actualEndDate = new Date();
        let bedPricePerDay = 500; // default fallback

        // Fetch Target Bed details to extract live pricing
        if (appointment.bedId) {
            const bed = await Bed.findById(appointment.bedId);
            if (bed) {
                bedPricePerDay = bed.pricePerDay || 500;
            }
        }

        // Calculate Standard/Scheduled Base Stay Duration & Charges
        let baseStayDays = 1;
        let baseStayCharge = 0;
        if (appointment.startDate && appointment.endDate) {
            const start = moment(appointment.startDate).startOf('day');
            const scheduledEnd = moment(appointment.endDate).startOf('day');
            baseStayDays = Math.max(1, scheduledEnd.diff(start, 'days'));
            baseStayCharge = baseStayDays * bedPricePerDay;
        }

        // Calculate Overstay Days & Surcharge
        let overstayDays = 0;
        let overstayCharge = 0;
        if (appointment.startDate && appointment.endDate) {
            const scheduledEnd = moment(appointment.endDate).startOf('day');
            const actualEnd = moment(actualEndDate).startOf('day');
            
            overstayDays = actualEnd.diff(scheduledEnd, 'days');
            if (overstayDays > 0) {
                overstayCharge = overstayDays * bedPricePerDay;
            } else {
                overstayDays = 0;
            }
        }

        // Calculate manual additional billing items
        const items = Array.isArray(billingItems) ? billingItems : [];
        const extraBillingTotal = items.reduce((sum, item) => sum + Number(item.price), 0);

        // Structure & Heal Pricing Breakdown object
        if (!appointment.pricingBreakdown) {
            appointment.pricingBreakdown = { baseFee: 0, visitCharges: 0, extraCharges: 0, discountAmount: 0, subtotal: 0 };
        }

        // Heal baseFee if originally uncalculated/zero in database
        if (!appointment.pricingBreakdown.baseFee || appointment.pricingBreakdown.baseFee === 0) {
            appointment.pricingBreakdown.baseFee = baseStayCharge;
        }

        // Accumulate extra charges
        const combinedExtraCharges = overstayCharge + extraBillingTotal;
        appointment.pricingBreakdown.extraCharges = (appointment.pricingBreakdown.extraCharges || 0) + combinedExtraCharges;

        // Recompute dynamic subtotal & final payment amount
        appointment.pricingBreakdown.subtotal = 
            (appointment.pricingBreakdown.baseFee || 0) + 
            (appointment.pricingBreakdown.visitCharges || 0) + 
            (appointment.pricingBreakdown.extraCharges || 0);

        const discount = appointment.pricingBreakdown.discountAmount || 0;
        const finalCalculatedTotal = Math.max(0, appointment.pricingBreakdown.subtotal - discount);
        
        // Map elements into specialServices dynamic schema
        appointment.specialServices = items.map(itm => ({
            serviceName: itm.serviceName,
            price: Number(itm.price)
        }));

        if (overstayCharge > 0) {
            appointment.specialServices.push({ 
                serviceName: `Overstay Bed Surcharge (${overstayDays} days)`, 
                price: overstayCharge 
            });
        }

        // 🚀 SYNC FIX: Transition status to Completed and paymentStatus to Paid upon dynamic settle
        appointment.status = 'Completed';
        appointment.paymentStatus = 'Paid'; 
        appointment.endDate = actualEndDate;
        appointment.totalAmount = finalCalculatedTotal; // Saved corrected sum

        // Auto-close open primary doctor's active shift
        if (appointment.doctorId) {
            const activePrimaryShift = appointment.treatmentHistory.find(h => 
                h.toDoctorId && 
                h.toDoctorId.toString() === appointment.doctorId.toString() && 
                !h.endTime
            );
            if (activePrimaryShift) {
                activePrimaryShift.endTime = actualEndDate;
                activePrimaryShift.durationDisplay = calcDuration(activePrimaryShift.startTime, actualEndDate);
            }
        }

        // Auto-close any active bedside specialist care shifts
        if (appointment.bedsideCareTeam && appointment.bedsideCareTeam.length > 0) {
            appointment.bedsideCareTeam.forEach(careMember => {
                if (careMember.status === 'In-Progress' || careMember.status === 'Accepted') {
                    careMember.status = 'Completed';
                    careMember.endTime = actualEndDate;
                    careMember.durationDisplay = calcDuration(careMember.startTime, actualEndDate);
                }
            });
        }

        await appointment.save();

        // Financial Wallet Sync
        const walletDeltaCredit = Math.max(0, finalCalculatedTotal - previousTotalAmount);

        if (walletDeltaCredit > 0) {
            const walletTransaction = {
                type: 'Credit',
                amount: walletDeltaCredit,
                remark: `Discharge Bill Finalized - ${appointment.bookingId}`,
                orderId: appointment.bookingId
            };

            const walletSchemaPath = Wallet.schema.path('vendorModel');
            const allowedEnums = walletSchemaPath ? walletSchemaPath.enumValues : [];
            let matchedModel = 'Hospital';
            if (allowedEnums.length > 0) {
                const match = allowedEnums.find(val => val.toLowerCase() === 'hospital');
                if (match) matchedModel = match;
            }

            await Wallet.findOneAndUpdate(
                { vendorId: hospitalId },
                { 
                    $setOnInsert: { vendorModel: matchedModel }, 
                    $inc: { balance: walletDeltaCredit },
                    $push: { transactions: walletTransaction }
                },
                { upsert: true, new: true, runValidators: false }
            );
        }

        // Release Bed & Update Ward capacity
        if (appointment.bedId) {
            const bed = await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Available' } });
            if (bed) {
                await Ward.findByIdAndUpdate(bed.wardId, { $inc: { availableBeds: 1 } });
            }
        }

        // ACTIVE TRANSIT GUARD: Only release ambulance if it is not currently driving the patient home
        if (appointment.ambulanceId) {
            const AmbulanceBooking = require('../../models/AmbulanceBooking');
            const activeDischargeTrip = await AmbulanceBooking.findOne({
                ambulanceId: appointment.ambulanceId,
                status: { $in: ['Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] }
            });

            if (!activeDischargeTrip) {
                await Ambulance.findByIdAndUpdate(appointment.ambulanceId, { 
                    $set: { availableForEmergency: true } 
                });
            }
        }

        res.json({ 
            success: true, 
            message: "Patient Discharged Successfully with corrected stay charges.", 
            billAmount: appointment.totalAmount 
        });

    } catch (error) { 
        console.error("Discharge Error:", error);
        res.status(500).json({ message: error.message }); 
    }
};




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

        // 1. Mark Ambulance as Busy (Duty ON)
        await Ambulance.findByIdAndUpdate(ambulanceId, { 
            availableForEmergency: false 
        });

        // 2. Link Trip to Appointment
        await Appointment.findByIdAndUpdate(appointmentId, {
            'tracking.ambulanceId': ambulanceId,
            'tracking.status': 'Driver Assigned'
        });

        res.json({ success: true, message: "Driver Assigned. Ambulance is now On Duty." });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// 1. GET INCOMING REFERRALS (Screenshot 28)
// Updated: Added dynamic pagination and full bed population
const getIncomingReferrals = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { page = 1, limit = 20 } = req.query;

        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 20;
        const skip = (pageNum - 1) * limitNum;

        const query = { 
            hospitalId: hospitalId, 
            bookingType: 'Admission', 
            status: 'Hospital-Pending' 
        };

        const totalRecords = await Appointment.countDocuments(query);

        const referrals = await Appointment.find(query)
            .populate('userId', 'name phone profilePic')
            .populate('ambulanceId', 'name vehicleNumber')
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay',
                populate: { path: 'wardId', select: 'name type' }
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum);

        res.json({ 
            success: true, 
            totalRecords,
            totalPages: Math.ceil(totalRecords / limitNum),
            currentPage: pageNum,
            count: referrals.length,
            data: referrals 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};



const getHospitalWards = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const wards = await Ward.find({ hospitalId });
        
        // Har ward ke liye occupancy calculate karke bhej rahe hain
        const data = wards.map(ward => ({
            _id: ward._id,
            name: ward.name,
            type: ward.type,
            totalBeds: ward.totalBeds,
            availableBeds: ward.availableBeds,
            occupiedBeds: ward.totalBeds - ward.availableBeds,
            isActive: ward.isActive
        }));

        res.json({ success: true, data });
    } catch (error) { res.status(500).json({ message: error.message }); }
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

// 4. GET ALL ADMISSIONS/PATIENTS (Figma: Patient List)
// Updated: Added full bedId/ward populations and pagination controls
const getAllHospitalAdmissions = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { status, bedBookingType, page = 1, limit = 20 } = req.query;

        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 20;
        const skip = (pageNum - 1) * limitNum;

        let query = { 
            hospitalId, 
            bookingType: 'Admission',
            $or: [
                { ambulanceId: null },
                { ambulanceId: { $exists: false } }
            ]
        };

        if (status) query.status = status;
        if (bedBookingType) query.bedBookingType = bedBookingType; 

        // Count total matching records for pagination meta
        const totalRecords = await Appointment.countDocuments(query);

        const admissions = await Appointment.find(query)
            .populate('userId', 'name phone email profilePic age gender')
            .populate('doctorId', 'name speciality qualification profileImage')
            .populate('pendingDoctorId', 'name speciality') 
            // 🚀 Populating bedId and its ward details so bedNumber/ward details are completely available
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay',
                populate: { path: 'wardId', select: 'name type' }
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum);

        res.json({ 
            success: true, 
            totalRecords,
            totalPages: Math.ceil(totalRecords / limitNum),
            currentPage: pageNum,
            count: admissions.length,
            data: admissions 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// --- EMERGENCY CASES ---
// Updated: Added dynamic pagination and full populated bed identifiers
const getEmergencyCases = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { page = 1, limit = 20 } = req.query;

        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 20;
        const skip = (pageNum - 1) * limitNum;

        const query = { 
            hospitalId: hospitalId, 
            ambulanceId: { $ne: null, $exists: true }, 
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending', 'Discharge-Pending'] }
        };

        const totalRecords = await Appointment.countDocuments(query);

        // Fetch appointments brought in by ambulance
        const appointments = await Appointment.find(query)
            .populate('userId', 'name profilePic phone age gender')
            .populate('ambulanceId', 'name vehicleNumber vehicleType')
            .populate({
                path: 'bedId',
                select: 'bedNumber status pricePerDay',
                populate: { path: 'wardId', select: 'name' }
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean(); 

        const enrichedData = await Promise.all(appointments.map(async (appt) => {
            const booking = await AmbulanceBooking.findOne({
                $or: [
                    { bookingId: appt.bookingId },
                    { bookingId: appt.transactionId } 
                ]
            }).select('patientDetails caseReference serviceType triageLevel').lean();

            return {
                ...appt,
                caseReference: booking ? booking.caseReference : null,
                serviceType: booking ? booking.serviceType : null,
                emergencyPhotos: booking ? {
                    userIncidentPhoto: booking.patientDetails?.incidentPhoto || null,
                    driverOnSpotPhoto: booking.patientDetails?.driverOnSpotPhoto || null,
                    referralCard: booking.patientDetails?.referralCard || null,
                    emergencyDescription: booking.patientDetails?.emergencyDescription || ""
                } : null
            };
        }));

        res.json({ 
            success: true, 
            totalRecords,
            totalPages: Math.ceil(totalRecords / limitNum),
            currentPage: pageNum,
            count: enrichedData.length, 
            data: enrichedData 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};
// --- TRACK AMBULANCES (Hospital Admin Fleet Map) ---
// Path: controllers/hospital/HospitalPanel.js
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
const getHospitalPanelRatings = async (req, res) => {
    try {
        const { targetType } = req.query; // 'Hospital' or 'Ambulance'
        const hospitalId = req.user.id;

        let query = {};
        if (targetType === 'Hospital') {
            query = { targetId: hospitalId, targetType: 'Hospital' };
        } else {
            // Is hospital se linked saari ambulances ke reviews
            const ambulances = await Ambulance.find({ hospitalId }).select('_id');
            const ambIds = ambulances.map(a => a._id);
            query = { targetId: { $in: ambIds }, targetType: 'Ambulance' };
        }

        const reviews = await Review.find(query)
            .populate('userId', 'name profilePic')
            .sort({ createdAt: -1 });

        res.json({ success: true, data: reviews });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


const getDailyOccupancy = async (req, res) => {
    try {
        const { wardId, date } = req.query;

        // Default to today's date if not passed
        const targetDate = date ? moment(date).startOf('day').toDate() : moment().startOf('day').toDate();

        // 1. Fetch all beds for this specific ward
        const allBeds = await Bed.find({ wardId }).lean();
        const bedIds = allBeds.map(b => b._id);

        // 2. Find overlapping bookings STRICTLY for this specific target date
        const bookings = await Appointment.find({
            bedId: { $in: bedIds },
            bookingType: 'Admission', // Strictly admission records only
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending'] },
            startDate: { $lte: targetDate },
            endDate: { $gte: targetDate }
        }).populate('userId', 'name');

        // Create occupancy map
        const occupancyMap = {};
        bookings.forEach(b => {
            if (b.bedId) {
                const patientName = b.patients && b.patients[0] ? b.patients[0].patientName : (b.userId ? b.userId.name : 'Admitted');
                occupancyMap[b.bedId.toString()] = {
                    patientName: patientName,
                    bookingId: b.bookingId,
                    status: b.status
                };
            }
        });

        // 3. Map dynamic bed grid status day-by-day (FIXED: Overriding buggy static db status)
        const grid = allBeds.map(bed => {
            const occupant = occupancyMap[bed._id.toString()];
            
            let finalStatus = 'Available'; // Default dynamic status is always Available

            if (occupant) {
                finalStatus = 'Occupied'; // Agar us specific day booking hai
            } else if (bed.status === 'Maintenance') {
                finalStatus = 'Maintenance'; // Agar use strictly maintenance par dala gaya hai
            }

            return {
                ...bed,
                currentOccupant: occupant ? occupant.patientName : null,
                activeBookingId: occupant ? occupant.bookingId : null,
                status: finalStatus // Overriding static status with computed finalStatus
            };
        });

        res.json({ success: true, data: grid });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const finalizeDischarge = async (req, res) => {
    try {
        const { appointmentId, billingItems, dischargeDate } = req.body;

        const appt = await Appointment.findById(appointmentId);
        if (!appt) return res.status(404).json({ message: "Appointment record not found." });
        
        appt.status = 'Completed';
        appt.endDate = dischargeDate ? new Date(dischargeDate) : new Date(); 
        
        await appt.save();

        // Bed Release logic (Check if actual discharge is today or in past)
        if (moment(appt.endDate).isSameOrBefore(moment(), 'day')) {
            await Bed.findByIdAndUpdate(appt.bedId, { status: 'Available' });
            
            // FIX: Added appt.hospitalId constraint so that wards across different hospitals don't overlap by name
            await Ward.findOneAndUpdate(
                { name: appt.wardName, hospitalId: appt.hospitalId }, 
                { $inc: { availableBeds: 1 } }
            );
        }

        res.json({ success: true, message: "Patient Discharged. Range inventory updated." });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
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
        const skip = (parseInt(page) - 1) * parseInt(limit);

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
            .populate('userId', 'name phone email profilePic age gender')
            .populate('doctorId', 'name speciality qualification profileImage')
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay',
                populate: { path: 'wardId', select: 'name type' }
            })
            .populate({
                path: 'bedsideCareTeam.doctorId',
                select: 'name speciality qualification profileImage'
            })
            .populate({
                path: 'treatmentHistory.fromDoctorId',
                select: 'name speciality qualification profileImage'
            })
            .populate({
                path: 'treatmentHistory.toDoctorId',
                select: 'name speciality qualification profileImage'
            })
            .sort({ updatedAt: -1 }) 
            .skip(skip)
            .limit(parseInt(limit));

        // Asynchronously process files and timeline details for each history record
        const enrichedHistory = await Promise.all(history.map(async (appt) => {
            return await enrichAppointmentClinicalDetails(appt);
        }));

        res.json({
            success: true,
            totalRecords,
            totalPages: Math.ceil(totalRecords / parseInt(limit)),
            currentPage: parseInt(page),
            count: enrichedHistory.length,
            data: enrichedHistory 
        });

    } catch (error) {
        console.error("getHospitalHistory Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- API: EMERGENCY PATIENT DISCHARGE & RESOURCE RELEASE (Full Code - Auto-closes open specialist care shifts on discharge) ---
const emergencyDischarge = async (req, res) => {
    try {
        const { appointmentId, billingItems } = req.body; 
        const hospitalId = req.user.id; 

        // Find the target appointment and verify it belongs to this hospital and is an emergency case
        const appointment = await Appointment.findOne({ 
            _id: appointmentId, 
            hospitalId,
            $or: [
                { ambulanceId: { $ne: null, $exists: true } },
                { bedBookingType: 'Emergency-Bed' },
                { triageLevel: 'Emergency' }
            ]
        });

        if (!appointment) {
            return res.status(404).json({ 
                success: false, 
                message: "Active Emergency Admission Record Not Found or unauthorized." 
            });
        }

        if (appointment.status === 'Completed') {
            return res.status(400).json({ success: false, message: "Patient is already discharged." });
        }

        const previousTotalAmount = appointment.totalAmount || 0;
        let actualEndDate = new Date();
        let bedPricePerDay = 500; // default fallback

        // Fetch Bed details for dynamic pricing
        if (appointment.bedId) {
            const bed = await Bed.findById(appointment.bedId);
            if (bed) {
                bedPricePerDay = bed.pricePerDay || 500;
            }
        }

        // Calculate Scheduled Base Stay Days & Charge
        let baseStayDays = 1;
        let baseStayCharge = 0;
        if (appointment.startDate && appointment.endDate) {
            const start = moment(appointment.startDate).startOf('day');
            const scheduledEnd = moment(appointment.endDate).startOf('day');
            baseStayDays = Math.max(1, scheduledEnd.diff(start, 'days'));
            baseStayCharge = baseStayDays * bedPricePerDay;
        }

        // Calculate dynamic overstay bed charges
        let overstayDays = 0;
        let overstayCharge = 0;
        if (appointment.startDate && appointment.endDate) {
            const scheduledEnd = moment(appointment.endDate).startOf('day');
            const actualEnd = moment(actualEndDate).startOf('day');
            
            overstayDays = actualEnd.diff(scheduledEnd, 'days');
            if (overstayDays > 0) {
                overstayCharge = overstayDays * bedPricePerDay;
            } else {
                overstayDays = 0;
            }
        }

        // Calculate manual dynamic billing items
        const items = Array.isArray(billingItems) ? billingItems : [];
        const extraBillingTotal = items.reduce((sum, item) => sum + Number(item.price), 0);

        // Structure & Heal Pricing Breakdown object
        if (!appointment.pricingBreakdown) {
            appointment.pricingBreakdown = { baseFee: 0, visitCharges: 0, extraCharges: 0, discountAmount: 0, subtotal: 0 };
        }

        // Heal baseFee if originally zero
        if (!appointment.pricingBreakdown.baseFee || appointment.pricingBreakdown.baseFee === 0) {
            appointment.pricingBreakdown.baseFee = baseStayCharge;
        }

        // Update extra charges
        const combinedExtraCharges = overstayCharge + extraBillingTotal;
        appointment.pricingBreakdown.extraCharges = (appointment.pricingBreakdown.extraCharges || 0) + combinedExtraCharges;

        // Recompute dynamic values
        appointment.pricingBreakdown.subtotal = 
            (appointment.pricingBreakdown.baseFee || 0) + 
            (appointment.pricingBreakdown.visitCharges || 0) + 
            (appointment.pricingBreakdown.extraCharges || 0);

        const discount = appointment.pricingBreakdown.discountAmount || 0;
        const finalCalculatedTotal = Math.max(0, appointment.pricingBreakdown.subtotal - discount);

        // Mapping billing items dynamically into specialServices array schema
        appointment.specialServices = items.map(itm => ({
            serviceName: itm.serviceName,
            price: Number(itm.price)
        }));

        if (overstayCharge > 0) {
            appointment.specialServices.push({ 
                serviceName: `Overstay Bed Surcharge (${overstayDays} days)`, 
                price: overstayCharge 
            });
        }

        // 🚀 SYNC FIX: Transition status to Completed and paymentStatus to Paid upon dynamic settle
        appointment.status = 'Completed';
        appointment.paymentStatus = 'Paid'; 
        appointment.endDate = actualEndDate;
        appointment.totalAmount = finalCalculatedTotal; // Corrected dynamic total sum

        // Auto-close the Primary Doctor's open active shift
        if (appointment.doctorId) {
            const activePrimaryShift = appointment.treatmentHistory.find(h => 
                h.toDoctorId && 
                h.toDoctorId.toString() === appointment.doctorId.toString() && 
                !h.endTime
            );
            if (activePrimaryShift) {
                activePrimaryShift.endTime = actualEndDate;
                activePrimaryShift.durationDisplay = calcDuration(activePrimaryShift.startTime, actualEndDate);
            }
        }

        // Auto-close any active bedside specialist care shifts
        if (appointment.bedsideCareTeam && appointment.bedsideCareTeam.length > 0) {
            appointment.bedsideCareTeam.forEach(careMember => {
                if (careMember.status === 'In-Progress' || careMember.status === 'Accepted') {
                    careMember.status = 'Completed';
                    careMember.endTime = actualEndDate;
                    careMember.durationDisplay = calcDuration(careMember.startTime, actualEndDate);
                }
            });
        }

        await appointment.save();

        // Financial Wallet Sync
        const walletDeltaCredit = Math.max(0, finalCalculatedTotal - previousTotalAmount);

        if (walletDeltaCredit > 0) {
            const walletTransaction = {
                type: 'Credit',
                amount: walletDeltaCredit,
                remark: `Emergency Discharge Bill Finalized - ${appointment.bookingId}`,
                orderId: appointment.bookingId
            };

            const walletSchemaPath = Wallet.schema.path('vendorModel');
            const allowedEnums = walletSchemaPath ? walletSchemaPath.enumValues : [];
            let matchedModel = 'Hospital';
            if (allowedEnums.length > 0) {
                const match = allowedEnums.find(val => val.toLowerCase() === 'hospital');
                if (match) matchedModel = match;
            }

            await Wallet.findOneAndUpdate(
                { vendorId: hospitalId },
                { 
                    $setOnInsert: { vendorModel: matchedModel }, 
                    $inc: { balance: walletDeltaCredit },
                    $push: { transactions: walletTransaction }
                },
                { upsert: true, new: true, runValidators: false }
            );
        }

        // Release Bed & Update Ward capacity
        if (appointment.bedId) {
            const bed = await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Available' } });
            if (bed) {
                await Ward.findByIdAndUpdate(bed.wardId, { $inc: { availableBeds: 1 } });
            }
        }

        // Automatic ambulance release
        if (appointment.ambulanceId) {
            await Ambulance.findByIdAndUpdate(appointment.ambulanceId, { 
                $set: { availableForEmergency: true } 
            });
        }

        res.json({ 
            success: true, 
            message: "Emergency Patient Discharged. Bed & Ambulance released successfully with staying charges.", 
            billAmount: appointment.totalAmount 
        });

    } catch (error) { 
        console.error("Emergency Discharge Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- NEW API: GET DETAILED HOSPITAL CASE/ADMISSION FILE FOR DESK ---
const getHospitalCaseDetails = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { id } = req.params; // Appointment ID

        // Deep populate patient bio, active bed position, main doctor, co-doctors, timeline history, and clinical checkups
        const patient = await Appointment.findOne({ _id: id, hospitalId })
            .populate('userId', 'name phone email profilePic age gender bloodGroup')
            .populate('doctorId', 'name speciality qualification profileImage')
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay',
                populate: { path: 'wardId', select: 'name type' }
            })
            .populate({
                path: 'treatmentHistory.fromDoctorId',
                select: 'name speciality profileImage'
            })
            .populate({
                path: 'treatmentHistory.toDoctorId',
                select: 'name speciality profileImage'
            })
            .populate({
                path: 'bedsideCareTeam.doctorId',
                select: 'name speciality profileImage dutyStatus'
            })
            .populate({
                path: 'clinicalLogs.doctorId',
                select: 'name speciality qualification profileImage'
            })
            .populate({
                path: 'activeMedications.addedBy',
                select: 'name speciality qualification profileImage'
            });

        if (!patient) {
            return res.status(404).json({ success: false, message: "Admission Record Not Found on your hospital console." });
        }

        // 1. Process files and compile billing breakdown details
        const enrichedPatient = await enrichAppointmentClinicalDetails(patient);

        // 2. Fetch latest prescription dynamically
        const Prescription = require('../../models/Prescription'); 
        const prescription = await Prescription.findOne({ appointmentId: id }).sort({ createdAt: -1 });

        // 3. Sync dynamic ambulance telemetry
        let ambulanceBooking = null;
        if (patient.ambulanceId) {
            const AmbulanceBooking = require('../../models/AmbulanceBooking');
            ambulanceBooking = await AmbulanceBooking.findOne({
                $or: [
                    { bookingId: patient.bookingId },
                    { bookingId: patient.transactionId } 
                ]
            }).lean();
        }

        // 🚀 4. COLLABORATIVE SYNC: Map and flatten all bedside specialists recommended medicines for ward desk view
        const bedsideMedications = patient.bedsideCareTeam
            .filter(member => ['Completed', 'In-Progress', 'Accepted'].includes(member.status))
            .map(member => ({
                doctor: {
                    id: member.doctorId?._id,
                    name: member.doctorId?.name,
                    speciality: member.doctorId?.speciality,
                    profileImage: member.doctorId?.profileImage
                },
                recommendations: member.recommendedMedicines || []
            }));

        res.json({ 
            success: true, 
            data: {
                patient: enrichedPatient,
                prescription: prescription || null,
                ambulanceTelemetry: ambulanceBooking,
                bedsideMedications // 👈 Recieved identical collaborative medications pool directly in desk response!
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Helper function to enrich appointment with clinical details, prescriptions, and treatment team timeline
// Added dynamic Pre-Billing and Overstay bed surcharge calculation mechanics
// Helper function to enrich appointment with clinical details, prescriptions, and treatment team timeline
// Fixed: Computes dynamic pricing metrics and heals zero-value database pricing breakdowns on-the-fly
const enrichAppointmentClinicalDetails = async (appt) => {
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

    if (apptObj.treatmentHistory && apptObj.treatmentHistory.length > 0) {
        apptObj.treatmentHistory.forEach(historyLog => {
            if (historyLog.toDoctorId && historyLog.endTime) {
                const isCurrentActiveDoc = apptObj.doctorId && 
                                           apptObj.doctorId._id?.toString() === historyLog.toDoctorId._id?.toString() && 
                                           !historyLog.endTime;
                
                if (!isCurrentActiveDoc) {
                    const alreadyPushed = treatmentTeamTimeline.some(t => 
                        t.doctorId?.toString() === historyLog.toDoctorId._id?.toString() && 
                        String(t.joinedAt) === String(historyLog.startTime)
                    );

                    if (!alreadyPushed) {
                        treatmentTeamTimeline.push({
                            doctorId: historyLog.toDoctorId._id,
                            name: historyLog.toDoctorId.name,
                            speciality: historyLog.toDoctorId.speciality,
                            qualification: historyLog.toDoctorId.qualification || "MD",
                            profileImage: historyLog.toDoctorId.profileImage,
                            role: "Previous Physician (Discharged)",
                            joinedAt: historyLog.startTime,
                            dischargedAt: historyLog.endTime,
                            duration: historyLog.durationDisplay || ""
                        });
                    }
                }
            }
        });
    }

    let overstayDays = 0;
    let overstayCharge = 0;
    let bedPricePerDay = 0;
    let baseStayDays = 0;
    let baseStayCharge = 0;

    if (apptObj.bedId) {
        bedPricePerDay = apptObj.bedId.pricePerDay || 0;
    }

    if (apptObj.startDate && apptObj.endDate) {
        const start = moment(apptObj.startDate);
        const scheduledEnd = moment(apptObj.endDate);
        
        if (start.isValid() && scheduledEnd.isValid()) {
            baseStayDays = Math.max(1, scheduledEnd.startOf('day').diff(start.startOf('day'), 'days'));
            baseStayCharge = baseStayDays * bedPricePerDay;

            const checkoutTime = apptObj.status === 'Completed' ? moment(apptObj.endDate) : moment();
            const actualEnd = checkoutTime.startOf('day');
            
            overstayDays = actualEnd.diff(scheduledEnd.startOf('day'), 'days');
            if (overstayDays > 0) {
                overstayCharge = overstayDays * bedPricePerDay;
            } else {
                overstayDays = 0;
            }
        }
    }

    const dynamicPricingBreakdown = apptObj.pricingBreakdown ? { ...apptObj.pricingBreakdown } : {
        baseFee: 0, subtotal: 0, originalBaseFee: 0, visitCharges: 0, extraCharges: 0, discountAmount: 0, cancellationFeeApplied: 0, noShowFeeApplied: 0
    };

    if (!dynamicPricingBreakdown.baseFee || dynamicPricingBreakdown.baseFee === 0) {
        dynamicPricingBreakdown.baseFee = baseStayCharge;
    }

    if (overstayCharge > 0) {
        dynamicPricingBreakdown.extraCharges = (dynamicPricingBreakdown.extraCharges || 0) + overstayCharge;
    }

    const dynamicSubtotal = (dynamicPricingBreakdown.baseFee || 0) + (dynamicPricingBreakdown.visitCharges || 0) + (dynamicPricingBreakdown.extraCharges || 0);
    dynamicPricingBreakdown.subtotal = dynamicSubtotal;

    const discount = dynamicPricingBreakdown.discountAmount || 0;
    const dynamicTotalAmount = Math.max(0, dynamicSubtotal - discount);

    apptObj.pricingBreakdown = dynamicPricingBreakdown;

    if (!apptObj.totalAmount || apptObj.totalAmount === 0) {
        apptObj.totalAmount = dynamicTotalAmount;
    }

    // 🚀 LEDGER ACCUMULATOR: Calculate dynamic advance prepaid amount
    let paidOnBooking = 0;
    if (apptObj.paymentStatus === 'Paid') {
        paidOnBooking = apptObj.paymentDetails?.amount || 0;
        
        // Fallback: If amount key is unpopulated but paymentStatus is Paid, use baseFee minus discount
        if (paidOnBooking === 0) {
            paidOnBooking = Math.max(0, (dynamicPricingBreakdown.baseFee || 0) - discount);
        }
    }

    // Remaining Balance = Total Accumulated Cost - Paid on Booking
    const remainingBalance = Math.max(0, dynamicTotalAmount - paidOnBooking);

    const billingBreakdown = {
        baseStayDays,
        baseStayCharge,
        overstayDays,
        overstayCharge,
        bedPricePerDay,
        estimatedTotal: dynamicTotalAmount, // 👈 Total Accumulated Cost
        paidOnBooking,                       // 🚀 NEW: Paid on Booking
        remainingBalance,                    // 🚀 NEW: Remaining Balance
        currentBillAmount: apptObj.totalAmount
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
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const query = {
            hospitalId,
            status: 'Discharge-Pending', 
            "bedsideCareTeam.status": { $nin: ['Pending', 'In-Progress'] } 
        };

        // Case type filters
        if (caseType === 'emergency') {
            query.ambulanceId = { $ne: null, $exists: true };
        } else if (caseType === 'admission') {
            query.$or = [
                { ambulanceId: null },
                { ambulanceId: { $exists: false } }
            ];
        }

        const totalRecords = await Appointment.countDocuments(query);

        // Fetch pending discharges with populated care team details
        const list = await Appointment.find(query)
            .populate('userId', 'name phone email profilePic age gender')
            .populate('doctorId', 'name speciality qualification profileImage')
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay',
                populate: { path: 'wardId', select: 'name type' }
            })
            .populate({
                path: 'bedsideCareTeam.doctorId',
                select: 'name speciality qualification profileImage'
            })
            .populate({
                path: 'treatmentHistory.fromDoctorId',
                select: 'name speciality qualification profileImage'
            })
            .populate({
                path: 'treatmentHistory.toDoctorId',
                select: 'name speciality qualification profileImage'
            })
            .sort({ updatedAt: -1 }) 
            .skip(skip)
            .limit(parseInt(limit));

        // Asynchronously process files, timeline details and PRE-BILLING surcharges for each pending record
        const enrichedList = await Promise.all(list.map(async (appt) => {
            return await enrichAppointmentClinicalDetails(appt);
        }));

        res.json({
            success: true,
            totalRecords,
            totalPages: Math.ceil(totalRecords / parseInt(limit)),
            currentPage: parseInt(page),
            count: enrichedList.length,
            data: enrichedList
        });

    } catch (error) {
        console.error("Fetch pending discharges error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
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
        // 🚀 SYNC FIX: Uses collision-proof caseReference generator
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

        const { sendPushNotification } = require('../../utils/notification');
        await sendPushNotification(
            ambulanceId,
            'driver',
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

// --- API: REASSIGNS PRIMARY DOCTOR FROM ADMIN PANEL (Auto-syncs shift duration tracking logs) ---
// Endpoint: POST /hospital/panel/admissions/reassign-doctor
const reassignDoctorFromPanel = async (req, res) => {
    try {
        const hospitalId = req.user.id; // Logged-in Hospital Admin
        const { appointmentId, newDoctorId, reason } = req.body;

        // FIX: Native load Doctor model to resolve ReferenceError crashes
        const Doctor = require('../../models/Doctor');

        // 1. Verify New Doctor exists, belongs to same hospital, and is active
        const newDoctor = await Doctor.findOne({
            _id: newDoctorId,
            hospitalId,
            profileStatus: 'Approved',
            isActive: true
        });

        if (!newDoctor) {
            return res.status(400).json({ 
                success: false, 
                message: "Selected doctor is not active or unauthorized in your hospital." 
            });
        }

        // 2. Find active Admission/Emergency record
        const appointment = await Appointment.findOne({
            _id: appointmentId,
            hospitalId,
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending'] } // Active journey states
        });

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Active admission record not found." });
        }

        const oldDoctorId = appointment.doctorId;
        if (oldDoctorId && String(oldDoctorId) === String(newDoctorId)) {
            return res.status(400).json({ success: false, message: "Kripya reassign karne ke liye koi doosra (new) doctor select karein." });
        }

        const now = new Date();

        // 3. AUTO-CLOSE OLD DOCTOR SHIFT TIMELINE (If old doctor was assigned previously)
        if (oldDoctorId) {
            const activeShift = appointment.treatmentHistory.find(h => 
                h.toDoctorId && h.toDoctorId.toString() === oldDoctorId.toString() && !h.endTime
            );
            if (activeShift) {
                activeShift.endTime = now;
                activeShift.durationDisplay = calcDuration(activeShift.startTime, now); // Computes exact stay duration
            }
        }

        // 4. Update primary doctor & Push new assignment shift to timeline history
        appointment.doctorId = newDoctorId;
        
        appointment.treatmentHistory.push({
            fromDoctorId: oldDoctorId || null,
            toDoctorId: newDoctorId,
            action: oldDoctorId ? 'Transfer-Accepted' : 'Initial-Assignment',
            notes: `Doctor reassigned from Hospital Admin Panel. Reason: ${reason || 'Shift adjustment'}`,
            timestamp: now,
            startTime: now // Start new doctor's shift tracking instantly!
        });

        await appointment.save();

        res.json({
            success: true,
            message: `Doctor successfully reassigned to Dr. ${newDoctor.name}`,
            data: appointment
        });

    } catch (error) {
        console.error("Reassign Doctor Error:", error);
        res.status(500).json({ success: false, message: error.message });
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
// Endpoint: POST /hospital/panel/admissions/transfer-bed
// Path: controllers/hospital/HospitalPanel.js
const transferPatientBed = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { appointmentId, newBedId } = req.body;

        if (!appointmentId || !newBedId) {
            return res.status(400).json({ success: false, message: "Appointment ID and New Bed ID are required." });
        }

        // 1. Fetch Target Appointment
        const appointment = await Appointment.findOne({ _id: appointmentId, hospitalId });
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Admission request record not found." });
        }

        const activeStates = ['Confirmed', 'In-Progress', 'Hospital-Pending'];
        if (!activeStates.includes(appointment.status)) {
            return res.status(400).json({ success: false, message: "Cannot transfer bed in current patient status." });
        }

        const oldBedId = appointment.bedId;
        const oldBedNumber = appointment.bedNumber || "Unassigned Bed";
        const oldWardName = appointment.wardName || "Unassigned Ward";

        if (oldBedId && String(oldBedId) === String(newBedId)) {
            return res.status(400).json({ success: false, message: "Patient is already assigned to this bed." });
        }

        // 2. Fetch and Validate New Bed
        const newBed = await Bed.findById(newBedId).populate('wardId');
        if (!newBed) {
            return res.status(404).json({ success: false, message: "Target Bed not found in system." });
        }

        if (newBed.status !== 'Available') {
            return res.status(400).json({ success: false, message: `Target Bed ${newBed.bedNumber} is currently ${newBed.status}.` });
        }

        let oldBedPricePerDay = 500; // default fallback

        // 3. RELEASE OLD BED & CALCULATE SPLIT BILLING
        if (oldBedId) {
            const oldBed = await Bed.findById(oldBedId);
            if (oldBed) {
                oldBedPricePerDay = oldBed.pricePerDay || 500;
                oldBed.status = 'Available';
                await oldBed.save();

                // Increment old ward capacity
                await Ward.findByIdAndUpdate(oldBed.wardId, { $inc: { availableBeds: 1 } });
            }

            // 🚀 DYNAMIC SPLIT STAY ACCUMULATOR (Prepaid Adjusted)
            if (appointment.startDate) {
                const start = moment(appointment.startDate).startOf('day');
                const now = moment().startOf('day');
                const oldStayDays = Math.max(1, now.diff(start, 'days')); // Minimum 1 day unit billing
                const oldStayCharge = oldStayDays * oldBedPricePerDay;

                // Lock previous bed stay cost as a special service line item
                appointment.specialServices.push({
                    serviceName: `Bed Stay: ${oldWardName} - ${oldBedNumber} (${oldStayDays} days)`,
                    price: oldStayCharge
                });

                // Update dynamic pricing breakdown ledger
                if (!appointment.pricingBreakdown) {
                    appointment.pricingBreakdown = { baseFee: 0, visitCharges: 0, extraCharges: 0, discountAmount: 0, subtotal: 0 };
                }

                // 🚀 PREPAID ADJUSTMENT GUARD: Deduct previous unspent advance base fee from totalAmount to prevent double-billing
                const originalBaseFee = appointment.pricingBreakdown.baseFee || 0;
                if (originalBaseFee > 0) {
                    appointment.totalAmount = Math.max(0, (appointment.totalAmount || 0) - originalBaseFee);
                }
                
                // Reset active baseFee to 0 so the next bed stay starts fresh
                appointment.pricingBreakdown.baseFee = 0; 
                appointment.pricingBreakdown.extraCharges = (appointment.pricingBreakdown.extraCharges || 0) + oldStayCharge;
                appointment.totalAmount = (appointment.totalAmount || 0) + oldStayCharge;

                // Reset appointment startDate to "now" so new bed stay duration starts counting from today
                appointment.startDate = new Date();
            }
        }

        // 4. LOCK AND OCCUPY NEW BED
        newBed.status = 'Occupied';
        await newBed.save();

        // Decrement new ward capacity
        await Ward.findByIdAndUpdate(newBed.wardId, { $inc: { availableBeds: -1 } });

        // 5. UPDATE APPOINTMENT TO NEW BED PROPERTIES
        appointment.bedId = newBedId;
        appointment.bedNumber = newBed.bedNumber;
        appointment.wardName = newBed.wardId ? newBed.wardId.name : "Ward";

        const now = new Date();

        // Push audit log to clinical history timeline
        appointment.treatmentHistory.push({
            action: 'Transfer-Accepted',
            notes: `Bed shifted from ${oldWardName} (Bed: ${oldBedNumber}) to ${appointment.wardName} (Bed: ${appointment.bedNumber}).`,
            timestamp: now
        });

        await appointment.save();

        res.json({
            success: true,
            message: `Patient successfully transferred to ${appointment.wardName} - ${appointment.bedNumber}. Previous stay billing successfully locked.`,
            data: appointment
        });

    } catch (error) {
        console.error("Bed Transfer Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- API 1: GET HOSPITAL ALL CASES FOR TRACKING (With 20-Record Pagination) ---
// Endpoint: GET /hospital/panel/cases/track-list
// Path: controllers/hospital/HospitalPanel.js
const getTrackCasesList = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { page = 1, search, status } = req.query;

        // Strictly paginated with 10 records per page as requested
        const pageNum = parseInt(page) || 1;
        const limitNum = 10; 
        const skip = (pageNum - 1) * limitNum;

        let query = { 
            hospitalId,
            bookingType: 'Admission' // Only track bed admission cases
        };

        if (status) query.status = status;

        if (search) {
            const isBookingId = search.toUpperCase().startsWith('HKH-') || search.toUpperCase().startsWith('HK-');
            if (isBookingId) {
                query.bookingId = { $regex: search, $options: 'i' };
            } else {
                const User = require('../../models/User'); // Safe path load
                const matchedUsers = await User.find({
                    name: { $regex: search, $options: 'i' }
                }).select('_id');
                const userIds = matchedUsers.map(u => u._id);
                query.userId = { $in: userIds };
            }
        }

        const totalRecords = await Appointment.countDocuments(query);

        const list = await Appointment.find(query)
            .populate('userId', 'name phone email profilePic age gender')
            .populate('doctorId', 'name speciality profileImage')
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay',
                populate: { path: 'wardId', select: 'name type' }
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum);

        res.json({
            success: true,
            totalRecords,
            totalPages: Math.ceil(totalRecords / limitNum),
            currentPage: pageNum,
            count: list.length,
            data: list
        });

    } catch (error) {
        console.error("Fetch Track List Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- API 2: UNIFIED "SUPER DETAILS" ADMISSION FILE (NEW CONSOLIDATED API) ---
// Endpoint: GET /hospital/panel/cases/track-details/:id
// Path: controllers/hospital/HospitalPanel.js
const getTrackCaseSuperDetails = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { id } = req.params; // Appointment ID

        // Deep populate patient bio, active bed position, main doctor, co-doctors, timeline history, and clinical checkups
        const appointment = await Appointment.findOne({ _id: id, hospitalId })
            .populate('userId', 'name phone email profilePic age gender bloodGroup')
            .populate('doctorId', 'name speciality qualification profileImage')
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay',
                populate: { path: 'wardId', select: 'name type' }
            })
            .populate('treatmentHistory.fromDoctorId', 'name speciality qualification profileImage')
            .populate('treatmentHistory.toDoctorId', 'name speciality qualification profileImage')
            .populate('bedsideCareTeam.doctorId', 'name speciality qualification profileImage')
            .populate('clinicalLogs.doctorId', 'name speciality qualification profileImage')
            .populate('activeMedications.addedBy', 'name speciality qualification profileImage');

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Admission Record Not Found on your hospital console." });
        }

        // Fetch final Prescription details (medicines, vitals, PDF Url)
        const Prescription = require('../../models/Prescription'); // Safe local load
        const prescription = await Prescription.findOne({ appointmentId: id }).sort({ createdAt: -1 });

        // 🚀 A. Compile: Collaborative Treatment Team Timeline
        const treatmentTimeline = [];

        // Current active primary doctor shift
        if (appointment.doctorId) {
            const primaryShift = appointment.treatmentHistory?.find(h => 
                h.toDoctorId && h.toDoctorId._id?.toString() === appointment.doctorId._id?.toString() && h.startTime
            );

            treatmentTimeline.push({
                doctorId: appointment.doctorId._id,
                name: appointment.doctorId.name,
                speciality: appointment.doctorId.speciality,
                qualification: appointment.doctorId.qualification || "MBBS",
                profileImage: appointment.doctorId.profileImage,
                role: "Current Primary Physician",
                joinedAt: primaryShift ? primaryShift.startTime : appointment.startDate,
                dischargedAt: primaryShift?.endTime || appointment.endDate || null,
                duration: primaryShift?.durationDisplay || ""
            });
        }

        // Previous transferred doctors' shift history
        if (appointment.treatmentHistory && appointment.treatmentHistory.length > 0) {
            appointment.treatmentHistory.forEach(historyLog => {
                if (historyLog.toDoctorId && historyLog.endTime) {
                    const isCurrentActiveDoc = appointment.doctorId && 
                                               appointment.doctorId._id?.toString() === historyLog.toDoctorId._id?.toString() && 
                                               !historyLog.endTime;
                    
                    if (!isCurrentActiveDoc) {
                        const alreadyPushed = treatmentTimeline.some(t => 
                            t.doctorId?.toString() === historyLog.toDoctorId._id?.toString() && 
                            String(t.joinedAt) === String(historyLog.startTime)
                        );

                        if (!alreadyPushed) {
                            treatmentTimeline.push({
                                doctorId: historyLog.toDoctorId._id,
                                name: historyLog.toDoctorId.name,
                                speciality: historyLog.toDoctorId.speciality,
                                qualification: historyLog.toDoctorId.qualification || "MBBS",
                                profileImage: historyLog.toDoctorId.profileImage,
                                role: "Previous Primary Physician (Discharged)",
                                joinedAt: historyLog.startTime,
                                dischargedAt: historyLog.endTime,
                                duration: historyLog.durationDisplay || ""
                            });
                        }
                    }
                }
            });
        }

        // 🚀 B. Compile: Bedside Specialists logs and dynamic medications recommendations (Stay & Home)
        const bedsideCareLogs = appointment.bedsideCareTeam.map(member => {
            const meds = member.recommendedMedicines || [];
            return {
                specialist: {
                    doctorId: member.doctorId?._id,
                    name: member.doctorId?.name,
                    speciality: member.doctorId?.speciality,
                    profileImage: member.doctorId?.profileImage,
                    status: member.status
                },
                requestedAt: member.requestedAt,
                respondedAt: member.respondedAt,
                rejectionReason: member.rejectionReason,
                
                // 🚀 SYNC FIX: Map bedside observations with logged checkup vitals!
                clinicalObservations: member.specialistFeedback.map(obs => ({
                    observation: obs.observation,
                    patientCondition: obs.patientCondition,
                    priorityRating: obs.priorityRating,
                    submittedAt: obs.submittedAt,
                    vitals: obs.vitals || { bp: "", pulse: "", temp: "", spo2: "" }
                })),
                
                activeStayRecommendations: meds.filter(m => m.type === 'Active-Stay'),
                dischargeHomeRecommendations: meds.filter(m => m.type === 'Discharge-Home')
            };
        });

        // 🚀 C. Compile: Primary Doctor Round checkup logs (Attending progress rounds)
        const primaryDoctorRoundLogs = appointment.clinicalLogs.map(log => ({
            doctor: {
                doctorId: log.doctorId?._id,
                name: log.doctorId?.name,
                speciality: log.doctorId?.speciality,
                profileImage: log.doctorId?.profileImage
            },
            observation: log.observation,
            patientCondition: log.patientCondition,
            priorityRating: log.priorityRating,
            loggedAt: log.loggedAt,
            
            // 🚀 SYNC FIX: Map primary round logs with recorded vitals!
            vitals: log.vitals || { bp: "", pulse: "", temp: "", spo2: "" }
        }));

        res.json({
            success: true,
            data: {
                caseDetails: {
                    appointmentId: appointment._id,
                    bookingId: appointment.bookingId,
                    status: appointment.status,
                    triageLevel: appointment.triageLevel,
                    startDate: appointment.startDate,
                    endDate: appointment.endDate,
                    stayDuration: appointment.stayDuration,
                    totalAmount: appointment.totalAmount,
                    paymentStatus: appointment.paymentStatus,
                    paymentMethod: appointment.paymentMethod,
                    patientProfile: appointment.userId,
                    bedDetails: appointment.bedId,
                    
                    // 🚀 SYNC FIX: Maps final discharge vitals here!
                    dischargeVitals: appointment.clinicalSummary?.vitals || { bp: "", pulse: "", temp: "", spo2: "" }
                },
                prescriptionDetails: prescription ? {
                    prescriptionId: prescription._id,
                    pdfUrl: prescription.pdfUrl,
                    medicines: prescription.medicines || [],
                    vitals: prescription.vitals || { bp: "", pulse: "", temp: "", spo2: "" },
                    diagnosis: prescription.diagnosis || [],
                    chiefComplaints: prescription.chiefComplaints || "",
                    advisedInvestigations: prescription.advisedInvestigations || "None",
                    adviceGiven: prescription.adviceGiven || "",
                    specialInstructions: prescription.specialInstructions || ""
                } : null,
                treatmentTimeline,         // Previous transfers, shift timings, doctors
                bedsideCareLogs,           // Specialists, bedside observations, recommended meds (Stay & Home)
                primaryDoctorRoundLogs     // Active physician rounds observations with Vitals
            }
        });

    } catch (error) {
        console.error("Super Details Fetch Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};



//////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////// DISCHARGE ambulance DROP-OFF APIs  ////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////
// --- API 1: GET AVAILABLE FLEET FOR DISCHARGE DROP-OFF (Figma Screen 3 Aligned) ---
// Endpoint: GET /hospital/panel/discharge/available-ambulances
// Path: controllers/hospital/HospitalPanel.js
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
// Path: controllers/hospital/HospitalPanel.js
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
// Path: controllers/hospital/HospitalPanel.js
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
// Path: controllers/hospital/HospitalPanel.js
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

// --- API 1: GET PATIENTS LIST FOR TPA INSURANCE DESK (With insuranceType & Approval Status) ---
// Endpoint: GET /hospital/panel/insurance/patients?tab=Insured&page=1
const getInsurancePatientsList = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { tab = 'Un-Insured', page = 1, limit = 10, search } = req.query;

        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 10;
        const skip = (pageNum - 1) * limitNum;

        // DATA ISOLATION GUARD: Fetch only patients who have interacted with this specific hospital
        const uniquePatientIds = await Appointment.find({ hospitalId }).distinct('userId');

        let query = {
            _id: { $in: uniquePatientIds }
        };

        if (tab === 'Insured') {
            query["insuranceDetails.hasInsurance"] = true;
        } else {
            query["insuranceDetails.hasInsurance"] = { $ne: true };
        }

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }

        const totalRecords = await User.countDocuments(query);

        const patients = await User.find(query)
            .select('name phone email profilePic gender dob insuranceDetails')
            .populate('insuranceDetails.masterInsuranceId', 'insuranceName provider type')
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(limitNum);

        // 🚀 SYNC FIX: Map insuranceType and lookup active appointment approval status
        const enrichedPatients = await Promise.all(patients.map(async (p) => {
            const pObj = p.toObject ? p.toObject() : { ...p };
            
            // Find latest active/pending appointment for this patient at this hospital
            const activeAppt = await Appointment.findOne({
                hospitalId,
                userId: p._id
            })
            .sort({ createdAt: -1 })
            .select('bookingId status insuranceDetails createdAt')
            .lean();

            // Approval status is Pending by default until hospital uploads the approval letter PDF
            const approvalStatus = activeAppt?.insuranceDetails?.approvalStatus || (activeAppt?.insuranceDetails?.approvalLetterPdf ? 'Approved' : 'Pending');
            const approvalLetterPdf = activeAppt?.insuranceDetails?.approvalLetterPdf || null;

            return {
                ...pObj,
                insuranceType: pObj.insuranceDetails?.insuranceType || pObj.insuranceDetails?.masterInsuranceId?.type || "Cashless Insurance",
                latestAppointment: activeAppt ? {
                    appointmentId: activeAppt._id,
                    bookingId: activeAppt.bookingId,
                    appointmentStatus: activeAppt.status,
                    approvalStatus, // 👈 'Pending' by default, turns 'Approved' when PDF is uploaded
                    approvalLetterPdf // 👈 Path of uploaded TPA approval letter PDF
                } : null
            };
        }));

        res.json({
            success: true,
            totalRecords,
            totalPages: Math.ceil(totalRecords / limitNum),
            currentPage: pageNum,
            count: enrichedPatients.length,
            data: enrichedPatients
        });

    } catch (error) {
        console.error("Get Insurance Patients Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- API: UPLOAD TPA APPROVAL LETTER PDF & AUTO-CONFIRM ORDER (NEW API) ---
// Endpoint: PUT /hospital/panel/insurance/upload-approval-letter/:appointmentId
const uploadInsuranceApprovalLetter = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { appointmentId } = req.params;

        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                message: "Kripya insurance company ka approval letter PDF upload karein (approvalLetterPdf key me)." 
            });
        }

        const appointment = await Appointment.findOne({ _id: appointmentId, hospitalId });
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Admission booking record not found." });
        }

        const pdfPath = `/uploads/insurance_approvals/${req.file.filename}`;

        // 1. Save approval letter PDF and update status to Approved
        if (!appointment.insuranceDetails) {
            appointment.insuranceDetails = { hasInsurance: true };
        }
        
        appointment.hasInsurance = true;
        appointment.insuranceDetails.hasInsurance = true;
        appointment.insuranceDetails.approvalLetterPdf = pdfPath;
        appointment.insuranceDetails.approvalStatus = 'Approved'; // 🚀 Turns Approved

        // 2. 🚀 AUTO-CONFIRM ORDER: Transition appointment status from pending to Confirmed!
        if (appointment.status === 'Hospital-Pending' || appointment.status === 'Pending') {
            appointment.status = 'Confirmed';
        }

        // Reserve assigned bed if present
        if (appointment.bedId) {
            const Bed = require('../../models/Bed');
            await Bed.findByIdAndUpdate(appointment.bedId, { status: 'Reserved' });
        }

        await appointment.save();

        // 3. Trigger Notification to Patient
        const { sendPushNotification } = require('../../utils/notification');
        await sendPushNotification(
            appointment.userId,
            'user',
            "🎉 Cashless Admission Approved & Confirmed!",
            `Your cashless admission #${appointment.bookingId} has been verified with TPA insurance approval letter. Booking is now Confirmed.`,
            { appointmentId: appointment._id.toString(), type: 'cashless_approval_confirmed' }
        );

        res.json({
            success: true,
            message: "TPA Approval letter uploaded successfully. Order is now Confirmed!",
            data: {
                appointmentId: appointment._id,
                bookingId: appointment.bookingId,
                status: appointment.status,
                approvalStatus: 'Approved',
                approvalLetterPdf: pdfPath
            }
        });

    } catch (error) {
        console.error("Upload Approval Letter Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// --- API 2: GET MASTER DROPDOWNS DATA FOR ADDING INSURANCE (Figma Screen 3 Selector) ---
// Endpoint: GET /hospital/panel/insurance/master-data
// Path: controllers/hospital/HospitalPanel.js
const getInsuranceMasterDropdowns = async (req, res) => {
    try {
        const InsuranceType = require('../../models/InsuranceType'); // Safe path load
        const Insurance = require('../../models/Insurance');

        const [types, providers] = await Promise.all([
            InsuranceType.find({ isActive: true }).select('name'),
            Insurance.find({ isActive: true }).select('insuranceName provider type')
        ]);

        res.json({
            success: true,
            data: {
                insuranceTypes: types, // e.g., ["Non Cashless", "Cashless", "Other"]
                insuranceProviders: providers // e.g., ["HDFC Ergo", "SBI General", "LIC Health Plus"]
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- API 3: SAVE/UPDATE PATIENT INSURANCE DETAILS WITH DUAL SIDE UPLOADS (Figma Save Button) ---
// Endpoint: PUT /hospital/panel/insurance/save/:patientUserId
// Path: controllers/hospital/HospitalPanel.js
const savePatientInsuranceDetails = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { patientUserId } = req.params;
        const { 
            insuranceNumber, 
            companyName, 
            insuranceType, 
            startDate, 
            endDate, 
            masterInsuranceId 
        } = req.body;

        // Verify patient isolation ownership
        const hasInteracted = await Appointment.exists({ hospitalId, userId: patientUserId });
        if (!hasInteracted) {
            return res.status(403).json({ success: false, message: "Access Denied: Patient has no registered clinical interaction with your hospital." });
        }

        const patientUser = await User.findById(patientUserId);
        if (!patientUser) {
            return res.status(404).json({ success: false, message: "Patient user profile not found." });
        }

        // Initialize file paths from Multer fields
        const files = req.files || {};
        const frontCardPath = files.insuranceDocumentFront ? `/uploads/insurance/${files.insuranceDocumentFront[0].filename}` : patientUser.insuranceDetails?.insuranceDocumentFront;
        const backCardPath = files.insuranceDocumentBack ? `/uploads/insurance/${files.insuranceDocumentBack[0].filename}` : patientUser.insuranceDetails?.insuranceDocumentBack;

        const updatedInsuranceData = {
            hasInsurance: true,
            insuranceNumber: insuranceNumber || patientUser.insuranceDetails?.insuranceNumber,
            companyName: companyName || patientUser.insuranceDetails?.companyName,
            insuranceType: insuranceType || patientUser.insuranceDetails?.insuranceType,
            startDate: startDate || patientUser.insuranceDetails?.startDate,
            endDate: endDate || patientUser.insuranceDetails?.endDate,
            insuranceDocumentFront: frontCardPath,
            insuranceDocumentBack: backCardPath,
            masterInsuranceId: masterInsuranceId && mongoose.Types.ObjectId.isValid(masterInsuranceId) ? masterInsuranceId : (patientUser.insuranceDetails?.masterInsuranceId || null)
        };

        // 1. Save directly inside Patient User document
        patientUser.insuranceDetails = updatedInsuranceData;
        await patientUser.save();

        // 2. 🚀 CRITICAL SYNC FIX: Update cashless details for BOTH 'Hospital-Pending' and 'In-Progress' (Active Stays) appointments
        await Appointment.updateMany(
            { 
                hospitalId, 
                userId: patientUserId, 
                status: { $in: ['Hospital-Pending', 'In-Progress'] } // 👈 Mapped both check-in states
            },
            { 
                $set: { 
                    hasInsurance: true,
                    insuranceDetails: {
                        hasInsurance: true,
                        insuranceNumber: updatedInsuranceData.insuranceNumber,
                        companyName: updatedInsuranceData.companyName,
                        insuranceType: updatedInsuranceData.insuranceType,
                        insuranceDocument: frontCardPath // Uses card front as primary doc fallback
                    }
                } 
            }
        );

        res.json({
            success: true,
            message: "Patient health insurance details saved and active check-ins synchronized successfully.",
            data: patientUser.insuranceDetails
        });

    } catch (error) {
        console.error("Save Insurance Details Error:", error);
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
    savePatientInsuranceDetails
};