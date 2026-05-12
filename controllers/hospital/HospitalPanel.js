const Hospital = require('../../models/Hospital');
const Ward = require('../../models/Ward');
const Bed = require('../../models/Bed');
const HospitalService = require('../../models/HospitalService');
const Appointment = require('../../models/Appointment');
const Coupon = require('../../models/Coupon');
const Specialization = require('../../models/Specialization');
const Ambulance = require('../../models/Ambulance');
const { deleteFile } = require('../../utils/fileHandler');

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
        
        // Real-time counts from Appointment Model
        const emergency = await Appointment.countDocuments({ hospitalId, triageLevel: 'Emergency', status: 'In-Progress' });
        const admission = await Appointment.countDocuments({ hospitalId, bookingType: 'Admission', status: 'In-Progress' });
        const dischargeReady = await Appointment.countDocuments({ hospitalId, status: 'Confirmed' }); // Summary ready

        res.json({
            success: true,
            data: {
                emergencyCount: emergency,
                admissionCount: admission,
                dischargePending: dischargeReady
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
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
        const { appointmentId, bedId } = req.body;

        // 1. VALIDATE BED
        const bed = await Bed.findById(bedId);
        if (!bed || bed.status !== 'Available') {
            return res.status(400).json({ 
                success: false, 
                message: "This bed is already occupied or under maintenance." 
            });
        }

        // 2. VALIDATE APPOINTMENT
        const appointment = await Appointment.findOne({ _id: appointmentId, hospitalId: req.user.id });
        if (!appointment) return res.status(404).json({ message: "Admission request not found" });

        // 3. UPDATE BED STATUS TO OCCUPIED
        bed.status = 'Occupied';
        await bed.save();

        // 4. SYNC APPOINTMENT RECORD
        appointment.bedId = bedId;
        appointment.bedNumber = bed.bedNumber;
        // Ward details fetch karein naming ke liye
        const ward = await Ward.findById(bed.wardId);
        appointment.wardName = ward.name;
        
        appointment.status = 'In-Progress'; // Admission process active
        await appointment.save();

        // 5. DECREASE WARD CAPACITY
        await Ward.findByIdAndUpdate(bed.wardId, { $inc: { availableBeds: -1 } });

        res.json({ 
            success: true, 
            message: `Patient admitted to ${ward.name} - ${bed.bedNumber}`, 
            data: appointment 
        });

    } catch (error) {
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




// --- 3. FINAL DISCHARGE & DYNAMIC BILLING (Screenshot 29, 30) ---
const generateFinalBillAndDischarge = async (req, res) => {
    try {
        const { appointmentId, billingItems } = req.body; 
        const hospitalId = req.user.id;

        const appointment = await Appointment.findOne({ _id: appointmentId, hospitalId });
        if (!appointment) return res.status(404).json({ message: "Admission Record Not Found" });

        const extraTotal = billingItems.reduce((sum, item) => sum + Number(item.price), 0);
        
        // 1. Update Appointment
        appointment.status = 'Completed';
        appointment.totalAmount += extraTotal;
        appointment.pricingBreakdown.extraCharges = extraTotal;
        appointment.billingDetails = billingItems; 
        await appointment.save();

        // 2. Wallet Sync: Add money to hospital wallet
        let wallet = await Wallet.findOne({ vendorId: hospitalId });
        if (wallet) {
            wallet.balance += appointment.totalAmount;
            wallet.transactions.push({
                type: 'Credit',
                amount: appointment.totalAmount,
                remark: `Discharge Bill - ${appointment.bookingId}`,
                orderId: appointment.bookingId
            });
            await wallet.save();
        }

        // 3. Release Bed & Update Ward
        if (appointment.bedId) {
            const bed = await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Available' } });
            if (bed) {
                await Ward.findByIdAndUpdate(bed.wardId, { $inc: { availableBeds: 1 } });
            }
        }

        res.json({ success: true, message: "Discharged. Bed Released. Wallet Updated.", billAmount: appointment.totalAmount });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// POST /api/hospital/panel/discharge/finalize
// const finalizeDischargeWithBilling = async (req, res) => {
//     try {
//         const { appointmentId, billingItems } = req.body; 
//         // billingItems: [{ serviceName: 'Lab Test', price: 200 }, { serviceName: 'Pharmacy', price: 800 }]

//         const appointment = await Appointment.findById(appointmentId);
//         if(!appointment) return res.status(404).json({ message: "Record not found" });

//         const additionalTotal = billingItems.reduce((sum, item) => sum + Number(item.price), 0);
        
//         appointment.status = 'Completed';
//         appointment.totalAmount += additionalTotal;
//         appointment.pricingBreakdown.extraCharges = additionalTotal;
//         appointment.billingDetails = billingItems; // Breakdown array for Bill PDF

//         await appointment.save();

//         // Release the Bed automatically
//         if (appointment.bedId) {
//             await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Available' } });
//             await Ward.findOneAndUpdate({ name: appointment.wardName }, { $inc: { availableBeds: 1 } });
//         }

//         res.json({ success: true, message: "Patient Discharged. Final Bill Generated.", totalBill: appointment.totalAmount });
//     } catch (error) { res.status(500).json({ message: error.message }); }
// };

// --- 4. COUPON MANAGEMENT (Screenshot 18, 19) ---
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

        const appointment = await Appointment.findById(appointmentId);
        if (!appointment) return res.status(404).json({ message: "Case not found" });

        appointment.status = 'In-Progress';
        appointment.tracking = {
            ...appointment.tracking,
            ambulanceId: ambulanceId // Link the ambulance partner
        };

        // Mark ambulance as busy
        await Ambulance.findByIdAndUpdate(ambulanceId, { availableForEmergency: false });

        await appointment.save();
        res.json({ success: true, message: "Driver Assigned Successfully" });
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
        .populate('tracking.ambulanceId', 'name vehicleNumber');

        res.json({ success: true, data: referrals });
    } catch (error) { res.status(500).json({ message: error.message }); }
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
        const { status, search } = req.query; // status: 'In-Progress', 'Completed'
        let query = { hospitalId: req.user.id, bookingType: 'Admission' };

        if (status) query.status = status;
        
        const admissions = await Appointment.find(query)
            .populate('userId', 'name phone')
            .populate('doctorId', 'name speciality')
            .sort({ createdAt: -1 });

        res.json({ success: true, data: admissions });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { 
    getHospitalMasterData,getHospitalDashboardStats,
    createWardUnit,getBedsInWard,updateBedDetails,admitPatientToBed, updateWardBeds,deleteSpecificBed, addHospitalService, updateHospitalService, 
    generateFinalBillAndDischarge, generateHospitalCoupon, getHospitalCoupons, getHospitalWards, updateWardInfo, deleteWard, getAllHospitalAdmissions,
    getHospitalServices, getWardStatus,updateBedStatus,assignDoctorToAdmission, getAvailableDrivers, assignDriverToCase,
    getIncomingReferrals
};