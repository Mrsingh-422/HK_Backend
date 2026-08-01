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

const getHospitalDashboardStats = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const todayStart = moment().startOf('day').toDate();
        const todayEnd = moment().endOf('day').toDate();

        // Parallel collection execution
        const [
            emergencyActive,       
            directAdmissions,      
            emergencyDischarges,   // Tab 3: Emergency ready for discharge
            hospitalDischarges,    // Tab 4: Direct ready for discharge
            referralAmbulances,    
            historyRecords         
        ] = await Promise.all([
            
            // Tab 1: Emergency Case count (status active and brought by ambulance)
            Appointment.countDocuments({
                hospitalId,
                ambulanceId: { $ne: null, $exists: true },
                status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending'] }
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
                status: 'Discharge-Pending' // 👈 FIXED
            }),

            // Tab 4: Hospital Discharge (Direct admissions clinically ready: Discharge-Pending)
            Appointment.countDocuments({
                hospitalId,
                bookingType: 'Admission',
                $or: [
                    { ambulanceId: null },
                    { ambulanceId: { $exists: false } }
                ],
                status: 'Discharge-Pending' // 👈 FIXED
            }),

            // Tab 5: Referral Ambulance count
            AmbulanceBooking.countDocuments({
                hospitalId,
                serviceType: 'Referral Ambulance',
                status: { $in: ['Searching', 'Confirmed', 'Arrived', 'Picked-Up', 'En-Route'] }
            }),

            // Tab 6: History
            Appointment.countDocuments({
                hospitalId,
                status: 'Completed'
            })
        ]);

        const topEmergency = emergencyActive; 
        const topAdmission = directAdmissions;
        const topDischarge = emergencyDischarges + hospitalDischarges; // Dynamic discharge pool

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

        // standardise check-in & check-out dates
        const start = startDate ? moment(startDate).startOf('day').toDate() : (appointment.startDate || moment().startOf('day').toDate());
        const end = endDate ? moment(endDate).endOf('day').toDate() : (appointment.endDate || moment().add(1, 'days').endOf('day').toDate());

        // 3. 🚀 STRICT DOUBLE-BOOKING VALIDATION ON CHECK-IN (Figma Standard)
        // Check if there are any active bookings overlapping on selected bed for requested dates range
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
const assignDoctorToAdmission = async (req, res) => {
    try {
        const { appointmentId, doctorId } = req.body;

        const appointment = await Appointment.findById(appointmentId);
        if(!appointment) return res.status(404).json({ message: "Admission request not found" });

        appointment.doctorId = doctorId;
        appointment.status = 'Confirmed'; // Request pending se confirmed (admitted) ho gayi
        await appointment.save();

        res.json({ success: true, message: "Doctor Assigned & Admission Confirmed" });
    } catch (error) { res.status(500).json({ message: error.message }); }
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

        let overstayCharge = 0;
        let actualEndDate = new Date();

        // Safe Dates check
        if (appointment.startDate && appointment.endDate) {
            const scheduledEnd = moment(appointment.endDate).startOf('day');
            const actualEnd = moment(actualEndDate).startOf('day');
            
            const extraDays = actualEnd.diff(scheduledEnd, 'days');
            if (extraDays > 0 && appointment.bedId) {
                const bed = await Bed.findById(appointment.bedId);
                const dailyRate = bed ? (bed.pricePerDay || 500) : 500;
                overstayCharge = extraDays * dailyRate;
            }
        }

        const items = Array.isArray(billingItems) ? billingItems : [];
        const extraTotal = items.reduce((sum, item) => sum + Number(item.price), 0) + overstayCharge;
        
        // Dynamic properties assignment
        appointment.status = 'Completed';
        appointment.endDate = actualEndDate;
        appointment.totalAmount = (appointment.totalAmount || 0) + extraTotal;
        
        if (!appointment.pricingBreakdown) {
            appointment.pricingBreakdown = { baseFee: 0, visitCharges: 0, extraCharges: 0, discountAmount: 0, subtotal: 0 };
        }
        appointment.pricingBreakdown.extraCharges = (appointment.pricingBreakdown.extraCharges || 0) + extraTotal;
        
        appointment.specialServices = items.map(itm => ({
            serviceName: itm.serviceName,
            price: Number(itm.price)
        }));

        if (overstayCharge > 0) {
            appointment.specialServices.push({ serviceName: `Overstay Bed Surcharge`, price: overstayCharge });
        }

        // 1. Auto-close the Primary Doctor's open active shift
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

        // 2. Auto-close any active bedside specialist care shifts
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

        // --- FIXED: ATOMIC WALLET SYNC (Bypasses old document validation conflicts) ---
        const walletTransaction = {
            type: 'Credit',
            amount: extraTotal,
            remark: `Discharge Bill Extra - ${appointment.bookingId}`,
            orderId: appointment.bookingId
        };

        // Determine correct dynamic model name from schema enum
        const walletSchemaPath = Wallet.schema.path('vendorModel');
        const allowedEnums = walletSchemaPath ? walletSchemaPath.enumValues : [];
        let matchedModel = 'Hospital';
        if (allowedEnums.length > 0) {
            const match = allowedEnums.find(val => val.toLowerCase() === 'hospital');
            if (match) matchedModel = match;
        }

        // Atomic update is 100% crash-proof
        await Wallet.findOneAndUpdate(
            { vendorId: hospitalId },
            { 
                $setOnInsert: { vendorModel: matchedModel }, 
                $inc: { balance: extraTotal },
                $push: { transactions: walletTransaction }
            },
            { upsert: true, new: true, runValidators: false } // runValidators false prevents old validation crashes!
        );

        // Release Bed & Update Ward
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

        res.json({ success: true, message: "Patient Discharged Successfully", billAmount: appointment.totalAmount });
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
const getIncomingReferrals = async (req, res) => {
    try {
        const referrals = await Appointment.find({ 
            hospitalId: req.user.id, 
            bookingType: 'Admission', 
            status: 'Hospital-Pending' 
        })
        .populate('userId', 'name phone profilePic')
        .populate('ambulanceId', 'name vehicleNumber'); // 👈 FIXED tracking path to direct populated ambulanceId

        res.json({ success: true, data: referrals });
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
const getAllHospitalAdmissions = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { status, bedBookingType } = req.query;

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

        const admissions = await Appointment.find(query)
            .populate('userId', 'name phone')
            .populate('doctorId', 'name speciality')
            .populate('pendingDoctorId', 'name speciality') // 👈 Populates the pending handover target doctor
            .sort({ createdAt: -1 });

        res.json({ success: true, data: admissions });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- EMERGENCY CASES ---
const getEmergencyCases = async (req, res) => {
    try {
        const hospitalId = req.user.id;

        // 1. Fetch appointments brought in by ambulance
        const appointments = await Appointment.find({ 
            hospitalId: hospitalId, 
            ambulanceId: { $ne: null, $exists: true }, 
            status: { $in: ['Confirmed', 'In-Progress', 'Hospital-Pending', 'Discharge-Pending'] }
        })
        .populate('userId', 'name profilePic phone age gender')
        .populate('ambulanceId', 'name vehicleNumber vehicleType')
        .populate({
            path: 'bedId',
            select: 'bedNumber status',
            populate: { path: 'wardId', select: 'name' }
        })
        .sort({ createdAt: -1 })
        .lean(); // Lean use karne se hum object ko modify kar sakte hain safely

        // 2. 🚨 DYNAMIC PHOTO & CASE REF INJECTION
        // Har emergency appointment ke corresponding Ambulance Booking se photos fetch karenge
        const enrichedData = await Promise.all(appointments.map(async (appt) => {
            const booking = await AmbulanceBooking.findOne({
                $or: [
                    { bookingId: appt.bookingId },
                    { bookingId: appt.transactionId } // Fallback tracking check
                ]
            }).select('patientDetails caseReference serviceType triageLevel').lean();

            return {
                ...appt,
                caseReference: booking ? booking.caseReference : null,
                serviceType: booking ? booking.serviceType : null,
                // Hospital is object se "incidentPhoto" aur "driverOnSpotPhoto" nikal kar dikhayega
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

        let overstayCharge = 0;
        let actualEndDate = new Date();

        // Calculate dynamic overstay bed charges
        if (appointment.startDate && appointment.endDate) {
            const scheduledEnd = moment(appointment.endDate).startOf('day');
            const actualEnd = moment(actualEndDate).startOf('day');
            
            const extraDays = actualEnd.diff(scheduledEnd, 'days');
            if (extraDays > 0 && appointment.bedId) {
                const bed = await Bed.findById(appointment.bedId);
                const dailyRate = bed ? (bed.pricePerDay || 500) : 500;
                overstayCharge = extraDays * dailyRate;
            }
        }

        const items = Array.isArray(billingItems) ? billingItems : [];
        const extraTotal = items.reduce((sum, item) => sum + Number(item.price), 0) + overstayCharge;
        
        // Update Appointment status to Completed
        appointment.status = 'Completed';
        appointment.endDate = actualEndDate;
        appointment.totalAmount = (appointment.totalAmount || 0) + extraTotal;
        
        // Safeguard pricingBreakdown object
        if (!appointment.pricingBreakdown) {
            appointment.pricingBreakdown = { baseFee: 0, visitCharges: 0, extraCharges: 0, discountAmount: 0, subtotal: 0 };
        }
        appointment.pricingBreakdown.extraCharges = (appointment.pricingBreakdown.extraCharges || 0) + extraTotal;
        
        // Mapping billing items dynamically into specialServices array schema
        appointment.specialServices = items.map(itm => ({
            serviceName: itm.serviceName,
            price: Number(itm.price)
        }));

        if (overstayCharge > 0) {
            appointment.specialServices.push({ serviceName: `Overstay Bed Surcharge`, price: overstayCharge });
        }

        // 1. Auto-close the Primary Doctor's open active shift
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

        // 2. Auto-close any active bedside specialist care shifts
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

        // --- FIXED: ATOMIC WALLET SYNC (Bypasses old document validation conflicts) ---
        const walletTransaction = {
            type: 'Credit',
            amount: extraTotal,
            remark: `Emergency Discharge Bill Extra - ${appointment.bookingId}`,
            orderId: appointment.bookingId
        };

        // Determine correct dynamic model name from schema enum
        const walletSchemaPath = Wallet.schema.path('vendorModel');
        const allowedEnums = walletSchemaPath ? walletSchemaPath.enumValues : [];
        let matchedModel = 'Hospital';
        if (allowedEnums.length > 0) {
            const match = allowedEnums.find(val => val.toLowerCase() === 'hospital');
            if (match) matchedModel = match;
        }

        // Atomic update is 100% crash-proof
        await Wallet.findOneAndUpdate(
            { vendorId: hospitalId },
            { 
                $setOnInsert: { vendorModel: matchedModel }, 
                $inc: { balance: extraTotal },
                $push: { transactions: walletTransaction }
            },
            { upsert: true, new: true, runValidators: false } // runValidators false prevents old validation crashes!
        );

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
            message: "Emergency Patient Discharged. Bed & Ambulance released successfully.", 
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

        // Deep populate patient bio, active bed position, main doctor, co-doctors, and timeline history
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
            });

        if (!patient) {
            return res.status(404).json({ success: false, message: "Admission Record Not Found on your hospital console." });
        }

        // Fetch latest prescription dynamically
        const Prescription = require('../../models/Prescription'); 
        const prescription = await Prescription.findOne({ appointmentId: id }).sort({ createdAt: -1 });

        // --- NEW: DYNAMIC AMBULANCE TELEMETRY SYNC ---
        let ambulanceBooking = null;
        if (patient.ambulanceId) {
            const AmbulanceBooking = require('../../models/AmbulanceBooking');
            ambulanceBooking = await AmbulanceBooking.findOne({
                $or: [
                    { bookingId: patient.bookingId },
                    { bookingId: patient.transactionId } // Fallback tracking check
                ]
            }).lean();
        }

        res.json({ 
            success: true, 
            data: {
                patient,
                prescription: prescription || null,
                ambulanceTelemetry: ambulanceBooking // Injects complete transit details, triage levels, and onsite photos
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Helper function to enrich appointment with clinical details, prescriptions, and treatment team timeline
const enrichAppointmentClinicalDetails = async (appt) => {
    // Safe conversion of Mongoose document to plain JavaScript object
    const apptObj = appt.toObject ? appt.toObject() : { ...appt };

    // 1. Fetch prescription details for Diet Plan & Discharge PDF Card
    const prescriptionObj = await Prescription.findOne({ appointmentId: apptObj._id })
        .select('pdfUrl dietPlanPdf medicines diagnosis')
        .lean();

    // 2. Consolidate all clinical PDF/Image documents into a unified object
    const clinicalFiles = {
        dietPlanPdf: prescriptionObj?.dietPlanPdf || null,
        dischargeSummaryPdf: apptObj.clinicalSummary?.dischargeSummaryPdf || null,
        clinicalReports: apptObj.clinicalSummary?.uploadedReports || [],
        dischargeCardUrl: prescriptionObj?.pdfUrl || null // Keeps legacy dischargeCardUrl intact
    };

    // 3. Compile full Treatment Team Timeline (Primary Doctor + Specialists + Handover shifts)
    const treatmentTeamTimeline = [];

    // A. Fetch Primary Doctor Details & active Shift timings
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

    // B. Fetch Bedside Care Team (Co-Doctors) details & shift timings
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

    // C. Fetch Handover / Transfer details from timeline log
    if (apptObj.treatmentHistory && apptObj.treatmentHistory.length > 0) {
        apptObj.treatmentHistory.forEach(historyLog => {
            if (historyLog.action === 'Transfer-Initiated' && historyLog.fromDoctorId) {
                treatmentTeamTimeline.push({
                    doctorId: historyLog.fromDoctorId._id,
                    name: historyLog.fromDoctorId.name,
                    speciality: historyLog.fromDoctorId.speciality,
                    qualification: historyLog.fromDoctorId.qualification || "MD",
                    profileImage: historyLog.fromDoctorId.profileImage,
                    role: "Handover Colleague (Sender)",
                    joinedAt: historyLog.timestamp,
                    dischargedAt: historyLog.timestamp,
                    duration: ""
                });
            }
        });
    }

    return {
        ...apptObj,
        clinicalFiles,
        treatmentTeamTimeline
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

        // Asynchronously process files and timeline details for each pending discharge
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
    emergencyDischarge,getHospitalCaseDetails,getHospitalPendingDischarges,reassignAmbulanceOnBreakdown,reassignDoctorFromPanel,reportHospitalNoShow
};