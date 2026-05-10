const Hospital = require('../../../models/Hospital');
const Ward = require('../../../models/Ward');
const Bed = require('../../../models/Bed');
const Appointment = require('../../../models/Appointment');
const Coupon = require('../../../models/Coupon');
const crypto = require('crypto');
const moment = require('moment');

// 1. LIST HOSPITALS (Screenshot 18, 19)
const getHospitals = async (req, res) => {
    try {
        const { search, city } = req.query;
        let query = { profileStatus: 'Approved' };
        if (city) query.city = { $regex: city, $options: 'i' };
        if (search) query.name = { $regex: search, $options: 'i' };

        const hospitals = await Hospital.find(query)
            .select('name address city state hospitalImage type averageRating totalReviews');
        res.json({ success: true, count: hospitals.length, data: hospitals });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. WARD & BED AVAILABILITY (Screenshot 22, 27)
const getBedAvailability = async (req, res) => {
    try {
        const { hospitalId, type } = req.query; // type: 'ICU', 'General Ward', etc.
        const wards = await Ward.find({ hospitalId, type, isActive: true });
        res.json({ success: true, data: wards });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 1. GET BED GRID FOR UI (Screenshot 27) ---
// Frontend ko color coding (Green/Red/Orange) ke liye status chahiye
const getBedGrid = async (req, res) => {
    try {
        const { hospitalId, wardId } = req.query;
        // Wards ke andar beds fetch karein
        const beds = await Bed.find({ hospitalId, wardId });
        res.json({ success: true, data: beds });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 2. CHECKOUT SUMMARY (Beds + Doctors) ---
const getHospitalCheckoutSummary = async (req, res) => {
    try {
        const { hospitalId, doctorId, bedId, consultationType, couponCode, specialServices } = req.body;

        let baseFee = 0;
        let subtotal = 0;

        if (bedId) {
            const bed = await Bed.findById(bedId);
            if (!bed) return res.status(404).json({ message: "Bed not found" });
            if (bed.status !== 'Available') return res.status(400).json({ message: "This bed is no longer available" });
            baseFee = bed.pricePerDay;
        } else if (doctorId) {
            const doc = await Doctor.findById(doctorId);
            baseFee = consultationType === 'Home Visit' ? doc.fees.home : (consultationType === 'Video Consult' ? doc.fees.online : doc.fees.clinic);
        }

        // Special Services ₹100/- each (Screenshot 29)
        const serviceCharge = (specialServices?.length || 0) * 100;
        subtotal = baseFee + serviceCharge;

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
                discount,
                subtotal,
                totalPayable: subtotal - discount
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 3. FINAL UNIFIED BOOKING (Admission & Appointment) ---
const finalHospitalBooking = async (req, res) => {
    try {
        const { 
            hospitalId, doctorId, bedId, bookingType, triageLevel, 
            appointmentDate, appointmentTime, patients, pricing, 
            specialServices, couponId, couponCode 
        } = req.body;

        // 1. BED AVAILABILITY VALIDATION (Strict Production Check)
        if (bedId) {
            const bed = await Bed.findById(bedId);
            if (!bed || bed.status !== 'Available') {
                return res.status(400).json({ 
                    success: false, 
                    message: "Selected bed is already booked or under maintenance." 
                });
            }
        }

        // 2. AUTO-RESOLVE HOSPITAL ID (Agar sirf doctor book kiya ho)
        let finalHospitalId = hospitalId;
        if (doctorId && !finalHospitalId) {
            const doc = await Doctor.findById(doctorId);
            finalHospitalId = doc?.hospitalId || null;
        }

        // 3. GENERATE UNIQUE IDs
        const bookingId = `HKH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const trackingOTP = Math.floor(1000 + Math.random() * 9000).toString();

        // 4. MAP PATIENTS (Ensuring Schema patientName, patientAge)
        const formattedPatients = patients.map(p => ({
            patientName: p.patientName || p.name,
            patientAge: Number(p.patientAge || p.age),
            gender: p.gender,
            relation: p.relation || 'Self',
            isMainUser: p.isMainUser || false,
            reasonForVisit: p.reasonForVisit || ""
        }));

        // 5. CREATE APPOINTMENT (All Price Keys & Root Level Total)
        const appointment = await Appointment.create({
            userId: req.user.id,
            hospitalId: finalHospitalId,
            doctorId: doctorId || null,
            bedId: bedId || null,
            bookingType: bedId ? 'Admission' : (bookingType || 'Appointment'),
            triageLevel: triageLevel || 'Routine',
            patients: formattedPatients,
            appointmentDate: new Date(appointmentDate),
            appointmentTime: bedId ? 'Admission' : appointmentTime,
            consultationType: bedId ? 'Clinic Visit' : 'Clinic Visit', // Default for Admission
            specialServices: specialServices || [],
            
            pricingBreakdown: {
                baseFee: Number(pricing.baseFee),
                visitCharges: Number(pricing.visitCharge || 0),
                extraCharges: Number(pricing.extraServiceCharge || 0),
                discountAmount: Number(pricing.discount || 0),
                subtotal: Number(pricing.subtotal)
            },
            
            couponDetails: couponId ? {
                couponId,
                couponCode,
                discountValue: Number(pricing.discount)
            } : undefined,

            totalAmount: Number(pricing.totalPayable), // 👈 Root Level Key (Fixed)
            bookingId,
            status: finalHospitalId ? 'Hospital-Pending' : 'Pending',
            paymentStatus: 'Paid',
            'tracking.otp': trackingOTP
        });

        // 6. BED STATE LOCKING (Screenshot 27 Orange Status)
        if (bedId) {
            const bedRecord = await Bed.findById(bedId);
            // Mark bed as Reserved
            await Bed.findByIdAndUpdate(bedId, { $set: { status: 'Reserved' } });
            // Ward count decrease
            await Ward.findByIdAndUpdate(bedRecord.wardId, { $inc: { availableBeds: -1 } });
        }

        res.status(201).json({ 
            success: true, 
            message: "Booking successful", 
            bookingId, 
            trackingOTP, 
            data: appointment 
        });

    } catch (error) {
        console.error("Critical Booking Error:", error);
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

module.exports = { 
    getHospitals, getBedAvailability, getBedGrid,
    getHospitalCheckoutSummary, finalHospitalBooking, getMyHospitalBookings 
};