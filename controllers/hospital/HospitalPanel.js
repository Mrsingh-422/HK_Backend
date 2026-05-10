const Hospital = require('../../models/Hospital');
const Ward = require('../../models/Ward');
const Bed = require('../../models/Bed');
const HospitalService = require('../../models/HospitalService');
const Appointment = require('../../models/Appointment');
const Coupon = require('../../models/Coupon');
const Specialization = require('../../models/Specialization');
const Ambulance = require('../../models/Ambulance');
const { deleteFile } = require('../../utils/fileHandler');

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

// --- 1. CREATE WARD & AUTO-GENERATE BEDS (Production Standard) ---
const createWardUnit = async (req, res) => {
    try {
        const { name, type, totalBeds, pricePerDay } = req.body;

        // 1. Create Ward Record
        const ward = await Ward.create({
            hospitalId: req.user.id,
            name, type, totalBeds,
            availableBeds: totalBeds
        });

        // 2. Auto-Generate Bed Numbers (Naming: WardName-Count)
        // Clean Ward Name for numbering (e.g. "Surgical ICU" -> "SICU")
        const shortName = name.split(' ').map(word => word[0]).join('').toUpperCase();
        
        const bedData = [];
        for (let i = 1; i <= totalBeds; i++) {
            bedData.push({
                hospitalId: req.user.id,
                wardId: ward._id,
                bedNumber: `${shortName}-${i.toString().padStart(2, '0')}`, // e.g. SICU-01
                status: 'Available',
                pricePerDay: pricePerDay || (type === 'ICU' ? 2500 : 500)
            });
        }

        // 3. Bulk Insert Beds
        await Bed.insertMany(bedData);

        res.status(201).json({ 
            success: true, 
            message: `${totalBeds} beds generated for ${name}`, 
            ward 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// --- 2. GET BEDS BY WARD (For Grid View in Figma Screenshot 27) ---
const getBedsInWard = async (req, res) => {
    try {
        const { wardId } = req.params;
        const beds = await Bed.find({ wardId });
        res.json({ success: true, data: beds });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 3. ADMIT PATIENT (Admin Panel Flow) ---
const admitPatientToBed = async (req, res) => {
    try {
        const { appointmentId, bedId } = req.body;

        const bed = await Bed.findById(bedId);
        // Bed Availability Validation
        if (!bed || bed.status !== 'Available') {
            return res.status(400).json({ message: "Selected bed is already occupied or reserved" });
        }

        const appointment = await Appointment.findById(appointmentId);
        if(!appointment) return res.status(404).json({ message: "Admission request not found" });

        // Update Bed
        bed.status = 'Occupied';
        await bed.save();

        // Update Appointment
        appointment.bedId = bedId;
        appointment.wardName = (await Ward.findById(bed.wardId)).name;
        appointment.bedNumber = bed.bedNumber;
        appointment.status = 'In-Progress'; // Patient is now admitted
        await appointment.save();

        // Update Ward Capacity
        await Ward.findByIdAndUpdate(bed.wardId, { $inc: { availableBeds: -1 } });

        res.json({ success: true, message: `Patient admitted to ${bed.bedNumber}` });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
const updateWardBeds = async (req, res) => {
    try {
        const { wardId, action, bedCount } = req.body; // action: 'add' or 'remove'
        const ward = await Ward.findById(wardId);
        
        if (action === 'add') {
            ward.totalBeds += Number(bedCount);
            ward.availableBeds += Number(bedCount);
        } else {
            if(ward.availableBeds < bedCount) return res.status(400).json({ message: "Cannot remove occupied beds" });
            ward.totalBeds -= Number(bedCount);
            ward.availableBeds -= Number(bedCount);
        }
        
        await ward.save();
        res.json({ success: true, message: "Capacity Updated", data: ward });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// 2. GET WARD CAPACITY & UNITS (Screenshot 7)
const getWardStatus = async (req, res) => {
    try {
        const wards = await Ward.find({ hospitalId: req.user.id });
        const total = wards.reduce((sum, w) => sum + w.totalBeds, 0);
        const allocated = wards.reduce((sum, w) => sum + (w.totalBeds - w.availableBeds), 0);
        
        res.json({
            success: true,
            capacity: {
                totalBeds: total,
                allocatedBeds: allocated,
                remainingBeds: total - allocated
            },
            units: wards
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 2. UPDATE INDIVIDUAL BED STATUS (Figma Screenshot 27/28) ---
// Used when Admin manually marks a bed for Maintenance or releases it
const updateBedStatus = async (req, res) => {
    try {
        const { bedId, status } = req.body; // status: 'Available', 'Occupied', 'Maintenance'
        
        const bed = await Bed.findById(bedId);
        if(!bed) return res.status(404).json({ message: "Bed record not found" });

        const oldStatus = bed.status;
        bed.status = status;
        await bed.save();

        // Ward Capacity Sync Logic
        // Agar bed 'Available' ho gaya hai toh count badhao, agar 'Available' se hat gaya toh kam karo
        if(oldStatus !== 'Available' && status === 'Available') {
            await Ward.findByIdAndUpdate(bed.wardId, { $inc: { availableBeds: 1 } });
        } else if(oldStatus === 'Available' && status !== 'Available') {
            await Ward.findByIdAndUpdate(bed.wardId, { $inc: { availableBeds: -1 } });
        }

        res.json({ success: true, message: `Bed ${bed.bedNumber} is now ${status}` });
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
        // billingItems: [{ name: 'Oxygen', price: 500 }, { name: 'Consultation', price: 1000 }]

        const appointment = await Appointment.findOne({ _id: appointmentId, hospitalId: req.user.id });
        if (!appointment) return res.status(404).json({ message: "Admission Record Not Found" });

        const extraTotal = billingItems.reduce((sum, item) => sum + Number(item.price), 0);
        
        // Update Appointment for Discharge
        appointment.status = 'Completed';
        appointment.totalAmount += extraTotal;
        // Pricing breakdown mein extra services append karein
        appointment.pricingBreakdown.extraCharges = extraTotal;
        appointment.billingDetails = billingItems; // Array of items for PDF receipt

        await appointment.save();

        // Release the bed
        if (appointment.bedId) {
            await Ward.findOneAndUpdate({ "beds._id": appointment.bedId }, { $set: { "beds.$.isAvailable": true } });
        }

        res.json({ success: true, message: "Patient Discharged Successfully", billAmount: appointment.totalAmount });
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
        const { couponName, discountPercentage, maxDiscount, expiryDate } = req.body;
        
        const coupon = await Coupon.create({
            creatorId: req.user.id,
            vendorId: req.user.id,
            vendorType: 'Hospital',
            couponName,
            discountPercentage,
            maxDiscount,
            expiryDate,
            isAdminCreated: false
        });

        res.status(201).json({ success: true, message: "Coupon Generated", data: coupon });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getHospitalCoupons = async (req, res) => {
    try {
        const coupons = await Coupon.find({ vendorId: req.user.id });
        res.json({ success: true, data: coupons });
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


module.exports = { 
    getHospitalMasterData,
    createWardUnit,getBedsInWard,admitPatientToBed, updateWardBeds, addHospitalService, updateHospitalService, 
    generateFinalBillAndDischarge, generateHospitalCoupon, getHospitalCoupons,
    getHospitalServices, getWardStatus,updateBedStatus,assignDoctorToAdmission, getAvailableDrivers, assignDriverToCase
};