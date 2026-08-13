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

const getShortName = (name) => {
    return name.split(' ').map(word => word[0]).join('').toUpperCase();
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
const generateFinalBillAndDischarge = async (req, res) => {
    try {
        const { appointmentId, billingItems } = req.body; 
        const hospitalId = req.user.id;

        const appointment = await Appointment.findOne({ _id: appointmentId, hospitalId });
        if (!appointment) return res.status(404).json({ success: false, message: "Admission Record Not Found" });

        const previousTotalAmount = appointment.totalAmount || 0;
        let actualEndDate = new Date();
        let bedPricePerDay = 500; // default fallback

        // 1. Fetch Target Bed details to extract live pricing
        if (appointment.bedId) {
            const bed = await Bed.findById(appointment.bedId);
            if (bed) {
                bedPricePerDay = bed.pricePerDay || 500;
            }
        }

        // 2. Calculate Standard/Scheduled Base Stay Duration & Charges
        let baseStayDays = 1;
        let baseStayCharge = 0;
        if (appointment.startDate && appointment.endDate) {
            const start = moment(appointment.startDate).startOf('day');
            const scheduledEnd = moment(appointment.endDate).startOf('day');
            baseStayDays = Math.max(1, scheduledEnd.diff(start, 'days'));
            baseStayCharge = baseStayDays * bedPricePerDay;
        }

        // 3. Calculate Overstay Days & Surcharge
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

        // 4. Calculate manual additional billing items
        const items = Array.isArray(billingItems) ? billingItems : [];
        const extraBillingTotal = items.reduce((sum, item) => sum + Number(item.price), 0);

        // 5. Structure & Heal Pricing Breakdown object
        if (!appointment.pricingBreakdown) {
            appointment.pricingBreakdown = { baseFee: 0, visitCharges: 0, extraCharges: 0, discountAmount: 0, subtotal: 0 };
        }

        // Heal baseFee if originally uncalculated/zero in database
        if (!appointment.pricingBreakdown.baseFee || appointment.pricingBreakdown.baseFee === 0) {
            appointment.pricingBreakdown.baseFee = baseStayCharge;
        }

        // Accumulate extra charges (Dynamic Overstay Bed Surcharge + Additional Billing Items)
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

        // Set status and finalize calculations
        appointment.status = 'Completed';
        appointment.endDate = actualEndDate;
        appointment.totalAmount = finalCalculatedTotal; // Saved corrected sum

        // 6. Auto-close open primary doctor's active shift
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

        // 7. Auto-close any active bedside specialist care shifts
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

        // 8. Financial Wallet Sync: Calculate dynamic credit amount (Delta logic)
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

        // Release linked Ambulance
        if (appointment.ambulanceId) {
            await Ambulance.findByIdAndUpdate(appointment.ambulanceId, { 
                $set: { availableForEmergency: true } 
            });
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
        const drivers = await Ambulance.find({ 
            hospitalId: req.user.id, 
            availableForEmergency: true 
        }).select('name phone vehicleNumber vehicleType experienceYears');
        
        res.json({ success: true, data: drivers });
    } catch (error) { res.status(500).json({ message: error.message }); }
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
// --- TRACK AMBULANCES ---
const trackAllAmbulances = async (req, res) => {
    try {
        const hospitalId = req.user.id;

        // Fetch all ambulances linked to this hospital
        const ambulances = await Ambulance.find({ hospitalId: hospitalId })
            .select('name vehicleNumber vehicleType availableForEmergency location driverInfo phone');

        // Logic for Top Cards (Screenshot 14)
        const stats = {
            total: ambulances.length,
            available: ambulances.filter(a => a.availableForEmergency).length,
            onDuty: ambulances.filter(a => !a.availableForEmergency).length,
            maintenance: 0 // Agar aapke paas maintenance ka logic hai toh yahan add karein
        };

        // Format data as per Figma (Screenshot 13 & 37)
        const formattedData = ambulances.map(amb => ({
            _id: amb._id,
            ambulanceCode: amb.name, // e.g. "AMB-002"
            driverName: amb.driverInfo?.fullName || "Not Assigned",
            vehicleNumber: amb.vehicleNumber || "N/A",
            type: amb.vehicleType, // ALS, BLS, Traveller
            status: amb.availableForEmergency ? 'Available' : 'On Duty',
            contactNumber: amb.phone,
            liveLocation: {
                lat: amb.location?.lat || 0,
                lng: amb.location?.lng || 0
            },
            // Note: ETA aur Distance real-time mein Google Maps API se aayenge
            // Abhi ke liye professional project mein hum static labels bhejte hain jab tak trip link na ho
            eta: amb.availableForEmergency ? "Stationary" : "8 mins",
            distance: amb.availableForEmergency ? "At Base" : "2.3 km"
        }));

        res.json({ 
            success: true, 
            stats, // Figma Screenshot 14: Total, Available, On Duty cards
            data: formattedData // Figma Screenshot 13: List View
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
        const hospitalId = req.user.id; // Logged-in Hospital Admin

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

        // 1. Fetch Bed details for dynamic pricing
        if (appointment.bedId) {
            const bed = await Bed.findById(appointment.bedId);
            if (bed) {
                bedPricePerDay = bed.pricePerDay || 500;
            }
        }

        // 2. Calculate Scheduled Base Stay Days & Charge
        let baseStayDays = 1;
        let baseStayCharge = 0;
        if (appointment.startDate && appointment.endDate) {
            const start = moment(appointment.startDate).startOf('day');
            const scheduledEnd = moment(appointment.endDate).startOf('day');
            baseStayDays = Math.max(1, scheduledEnd.diff(start, 'days'));
            baseStayCharge = baseStayDays * bedPricePerDay;
        }

        // 3. Calculate dynamic overstay bed charges
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

        // 4. Calculate manual dynamic billing items
        const items = Array.isArray(billingItems) ? billingItems : [];
        const extraBillingTotal = items.reduce((sum, item) => sum + Number(item.price), 0);

        // 5. Structure & Heal Pricing Breakdown object
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

        // Update Appointment status to Completed
        appointment.status = 'Completed';
        appointment.endDate = actualEndDate;
        appointment.totalAmount = finalCalculatedTotal; // Corrected dynamic total sum

        // 6. Auto-close the Primary Doctor's open active shift
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

        // 7. Auto-close any active bedside specialist care shifts
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

        // 8. Financial Wallet Sync: Credit dynamic remaining delta balance
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

    // A. Fetch Current Active Primary Doctor details & active Shift timings
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

    // B. Fetch Bedside Care Team (Co-Doctors) details & active shift timings
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

    // 🚀 C. Fetch Completed / Transferred previous primary shifts from treatmentHistory
    if (apptObj.treatmentHistory && apptObj.treatmentHistory.length > 0) {
        apptObj.treatmentHistory.forEach(historyLog => {
            // Find closed doctor shifts (excluding the current active doctor's unended shift)
            if (historyLog.toDoctorId && historyLog.endTime) {
                const isCurrentActiveDoc = apptObj.doctorId && 
                                           apptObj.doctorId._id?.toString() === historyLog.toDoctorId._id?.toString() && 
                                           !historyLog.endTime;
                
                if (!isCurrentActiveDoc) {
                    // Check if we already pushed this doctor with this shift to avoid duplicates in timeline
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

    const billingBreakdown = {
        baseStayDays,
        baseStayCharge,
        overstayDays,
        overstayCharge,
        bedPricePerDay,
        estimatedTotal: dynamicTotalAmount,
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
    let ambulanceToRollback = null; // Used for transactional database rollback if save fails

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

        // 1. Fetch Target Appointment
        const appointment = await Appointment.findOne({ _id: appointmentId, hospitalId });
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Admission Record Not Found on your hospital console." });
        }

        // 🚀 EDGE CASE 1 GUARD: Prevent duplicate dispatches on the same admission request (Double-Billing protection)
        if (appointment.ambulanceId) {
            return res.status(400).json({ 
                success: false, 
                message: "An ambulance has already been dispatched for this admission. Please cancel the current booking to re-assign." 
            });
        }

        // 2. Fetch selected fleet ambulance and verify available state
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

        // Set pointer for rollback if subsequent steps crash
        ambulanceToRollback = ambulanceId;

        // 3. Calculate transit pricing parameters as per Figma
        const basePrice = Number(baseAmbulanceRate || ambulance.pricing?.fixedPrice || 1500);
        const surge = Number(surgePrice || 0);
        const totalDispatchPrice = basePrice + surge;

        // 4. Lock physical fleet ambulance to busy state
        ambulance.availableForEmergency = false;
        await ambulance.save();

        // 5. Generate distinct Booking ID references
        const generatedBookingId = `HK-REF-${Date.now().toString().slice(-6)}`;
        const generatedCaseRef = `HK-${new Date().getFullYear()}-REF-${Math.floor(1000 + Math.random() * 9000)}`;

        // Determine destination address
        let finalDropAddress = destinationName || "Patient's Registered Residence";
        if (destinationName === "Custom Destination Address" && customAddressText) {
            finalDropAddress = customAddressText;
        }

        const patientObj = appointment.patients?.[0] || {};

        // 6. Create matching Active Trip inside AmbulanceBooking so it flows to Driver App
        const AmbulanceBooking = require('../../models/AmbulanceBooking'); // Secure model load
        
        const booking = await AmbulanceBooking.create({
            bookingId: generatedBookingId,
            caseReference: generatedCaseRef,
            userId: appointment.userId,
            ambulanceId: ambulanceId,
            hospitalId: hospitalId, // Origin Hospital
            serviceType: 'Referral Ambulance',
            status: 'Confirmed', // Direct hospital dispatch skips searching broadcast phase
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
            paymentStatus: 'Pending', // Collected collectively at hospital checkout discharge
            paymentMethod: 'Online',
            otp: Math.floor(1000 + Math.random() * 9000).toString(),
            trackingTimeline: [{
                status: 'Confirmed',
                timestamp: new Date(),
                note: `Ambulance assigned and dispatched directly by hospital admin control desk to ${finalDropAddress}.`
            }]
        });

        // 7. BIND CHARGES TO PATIENT'S FINAL HOSPITAL INVOICE
        // Append ambulance ride cost to specialServices sub-schema
        appointment.specialServices.push({
            serviceName: `Ambulance Dispatch: ${finalDropAddress}`,
            price: totalDispatchPrice
        });

        // Increment Pricing breakdown extraCharges of hospital appointment
        if (!appointment.pricingBreakdown) {
            appointment.pricingBreakdown = { baseFee: 0, visitCharges: 0, extraCharges: 0, discountAmount: 0, subtotal: 0 };
        }

        appointment.pricingBreakdown.extraCharges = (appointment.pricingBreakdown.extraCharges || 0) + totalDispatchPrice;
        appointment.totalAmount = (appointment.totalAmount || 0) + totalDispatchPrice;

        // Link references on appointment record
        appointment.ambulanceId = ambulanceId;
        appointment.transactionId = generatedBookingId;

        await appointment.save();

        // 8. Push notifications to driver mobile console
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

        // 🚀 EDGE CASE 2: Safe transactional rollback if appointment saving fails mid-execution
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
    reassignDoctorFromPanel,reportHospitalNoShow,transferPatientBed
};