const Hospital = require('../../../models/Hospital');
const Ward = require('../../../models/Ward');
const Bed = require('../../../models/Bed');
const Appointment = require('../../../models/Appointment');
const HospitalService = require('../../../models/HospitalService');
const Coupon = require('../../../models/Coupon');
const Doctor = require('../../../models/Doctor');
const { getDistance } = require('../../../utils/helpers');
const crypto = require('crypto');
const moment = require('moment');

// 1. LIST HOSPITALS (Screenshot 18, 19)
const getHospitals = async (req, res) => {
    try {
        const { search, city, userLat, userLng } = req.body;
        
        let query = { profileStatus: 'Approved', isActive: true };
        if (city) query.city = { $regex: city, $options: 'i' };
        if (search) query.name = { $regex: search, $options: 'i' };

        let hospitals = await Hospital.find(query)
            .select('name address city state hospitalImage type averageRating totalReviews location')
            .lean(); // .lean() use karein taaki object modify kar sakein

        // Distance Calculation
        const dataWithDistance = await Promise.all(hospitals.map(async (hosp) => {
            let distance = 0;
            if (userLat && userLng && hosp.location?.lat) {
                distance = await getDistance(
                    parseFloat(userLat),
                    parseFloat(userLng),
                    hosp.location.lat,
                    hosp.location.lng
                );
            }
            return { ...hosp, distance };
        }));

        // Sort by distance (Nearest first)
        dataWithDistance.sort((a, b) => a.distance - b.distance);

        res.json({ success: true, count: dataWithDistance.length, data: dataWithDistance });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getHospitalDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const hospital = await Hospital.findById(id).select('-password -token').lean();
        if (!hospital) return res.status(404).json({ message: "Hospital not found" });

        // Fetch Wards, Doctors, and Admin-added Services (Figma S-29)
        const [wards, doctors, services] = await Promise.all([
            Ward.find({ hospitalId: id, isActive: true }),
            Doctor.find({ hospitalId: id, profileStatus: 'Approved' }).select('name speciality profileImage fees averageRating consultationStatus'),
            HospitalService.find({ hospitalId: id }) // Fetch Nurse, Security, etc.
        ]);

        res.json({
            success: true,
            data: { hospital, wards, doctors, services }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// 2. WARD & BED AVAILABILITY (Screenshot 22, 27)
// 2. WARD AVAILABILITY
const getWards = async (req, res) => {
    try {
        const { hospitalId, type } = req.query;
        console.log("Fetching Wards for Hospital:", hospitalId, "Type:", type);
        
        // Agar hospitalId nahi mili to error do
        if (!hospitalId) return res.status(400).json({ message: "hospitalId is required" });

        const query = { hospitalId, isActive: true };
        if (type) query.type = type;

        const wards = await Ward.find(query);
        res.json({ success: true, count: wards.length, data: wards });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// 3. BED GRID
const getBedGrid = async (req, res) => {
    try {
        const { wardId } = req.params;
        if (!wardId) return res.status(400).json({ message: "wardId is required" });

        const beds = await Bed.find({ wardId }).select('bedNumber status pricePerDay isVentilatorAvailable');
        res.json({ success: true, data: beds });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 2. CHECKOUT SUMMARY (Beds + Doctors) ---
// 4. CHECKOUT SUMMARY (Unified for Beds & Doctors)
const getHospitalCheckoutSummary = async (req, res) => {
    try {
        const { doctorId, bedId, consultationType, couponCode, selectedServiceIds, triageLevel } = req.body;

        let baseFee = 0;
        let subtotal = 0;

        // CASE A: Doctor Logic (Checks if ON/OFF)
        if (doctorId) {
            const doctor = await Doctor.findById(doctorId);
            const typeMap = { 'Video Consult': 'online', 'Clinic Visit': 'clinic', 'Home Visit': 'home' };
            const key = typeMap[consultationType];

            if (!doctor.consultationStatus[key]) {
                return res.status(400).json({ message: "This consultation type is currently disabled by the doctor." });
            }
            baseFee = doctor.fees[key];
        } 
        // CASE B: Bed Logic
        else if (bedId) {
            const bed = await Bed.findById(bedId);
            if (bed.status !== 'Available') return res.status(400).json({ message: "Bed is no longer available" });
            baseFee = bed.pricePerDay;
        }

        // --- DYNAMIC EXTRA SERVICES (Figma Screenshot 29) ---
        let serviceCharge = 0;
        if (selectedServiceIds && selectedServiceIds.length > 0) {
            const extraServices = await HospitalService.find({ _id: { $in: selectedServiceIds } });
            serviceCharge = extraServices.reduce((sum, s) => sum + s.price, 0);
        }

        // Triage Surcharge (Emergency Extra)
        const triageSurcharge = triageLevel === 'Emergency' ? 200 : 0;

        subtotal = baseFee + serviceCharge + triageSurcharge;

        // Coupon Logic
        let discount = 0;
        if (couponCode) {
            const coupon = await Coupon.findOne({ couponName: couponCode.toUpperCase(), isActive: true });
            if (coupon && subtotal >= coupon.minOrderAmount) {
                discount = Math.min((subtotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
            }
        }

        res.json({
            success: true,
            data: {
                baseFee,
                serviceCharge,
                triageSurcharge,
                discount,
                subtotal,
                totalPayable: subtotal - discount,
                currency: "₹"
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 5. FINAL BOOKING (Admission & Appointment)
const finalHospitalBooking = async (req, res) => {
    try {
        const { 
            hospitalId, doctorId, bedId, bookingType, triageLevel, 
            appointmentDate, appointmentTime, patients, pricing, 
            consultationType, selectedServiceIds, couponId, couponCode 
        } = req.body;

        // 1. STRIKT AVAILABILITY VALIDATION
        if (bedId) {
            const bed = await Bed.findById(bedId);
            // Check karein ki bed exist karta hai aur available hai ya nahi
            if (!bed || bed.status !== 'Available') {
                return res.status(400).json({ 
                    success: false, 
                    message: "Selected bed is no longer available. Please select another bed." 
                });
            }
        }

        const bookingId = `HKH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const trackingOTP = Math.floor(1000 + Math.random() * 9000).toString();

        // 2. PATIENT DATA PREPARATION
        const formattedPatients = patients.map(p => ({
            patientName: p.patientName || p.name,
            patientAge: Number(p.patientAge || p.age),
            gender: p.gender,
            relation: p.relation || 'Self',
            isMainUser: p.isMainUser || false
        }));

        // 3. CREATE APPOINTMENT
        const appointment = await Appointment.create({
            userId: req.user.id,
            hospitalId,
            doctorId: doctorId || null,
            bedId: bedId || null,
            bookingType: bedId ? 'Admission' : 'Appointment',
            triageLevel: triageLevel || 'Routine',
            patients: formattedPatients,
            appointmentDate,
            appointmentTime: bedId ? 'Admission' : appointmentTime,
            consultationType: bedId ? 'Clinic Visit' : consultationType,
            
            pricingBreakdown: {
                baseFee: pricing.baseFee,
                visitCharges: pricing.triageSurcharge || 0,
                extraCharges: pricing.serviceCharge || 0,
                discountAmount: pricing.discount || 0,
                subtotal: pricing.subtotal
            },
            totalAmount: pricing.totalPayable, // Root Level Required Key
            bookingId,
            status: 'Confirmed', // Direct Confirm if bed is occupied
            paymentStatus: 'Paid',
            'tracking.otp': trackingOTP
        });

        // 4. REAL-TIME BED & WARD SYNC (IMMEDIATE OCCUPIED)
        if (bedId) {
            // Bed ko 'Occupied' mark karein
            const occupiedBed = await Bed.findByIdAndUpdate(
                bedId, 
                { $set: { status: 'Occupied' } }, 
                { new: true }
            );

            // Ward ki available beds count -1 karein
            await Ward.findByIdAndUpdate(
                occupiedBed.wardId, 
                { $inc: { availableBeds: -1 } }
            );
        }

        res.status(201).json({ 
            success: true, 
            message: "Bed Booked & Marked Occupied Successfully", 
            bookingId, 
            data: appointment 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};



// 5. GET MY BOOKINGS (Screenshot 20, 21 - Upcoming, Pending, History)
const getMyHospitalBookings = async (req, res) => {
    try {
        const { tab } = req.query; // 'Upcoming', 'Pending', 'History'
        let query = { userId: req.user.id };

        if (tab === 'Upcoming') query.status = 'Confirmed';
        else if (tab === 'Pending') query.status = { $in: ['Pending', 'Hospital-Pending'] };
        else if (tab === 'History') query.status = { $in: ['Completed', 'Cancelled-By-User', 'Cancelled-By-Hospital'] };

        const data = await Appointment.find(query)
            .populate('hospitalId', 'name address hospitalImage')
            .populate('doctorId', 'name speciality profileImage')
            .sort({ appointmentDate: 1 });

        res.json({ success: true, data });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// GET FAMILY MEMBERS FOR BUBBLES (Screenshot 24)
const getBookingProfiles = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('name profilePic familyMember');
        // Main User + Family members ka array merge karke bhejein
        const profiles = [
            { id: user._id, name: "My Self", profilePic: user.profilePic, relation: 'Self' },
            ...user.familyMember.map(fm => ({ id: fm._id, name: fm.memberName, profilePic: fm.profilePic, relation: fm.relation }))
        ];
        res.json({ success: true, data: profiles });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


module.exports = { 
    getHospitals, getWards, getBedGrid,
    getHospitalCheckoutSummary, finalHospitalBooking, getMyHospitalBookings, getBookingProfiles,
    getHospitalDetails
};