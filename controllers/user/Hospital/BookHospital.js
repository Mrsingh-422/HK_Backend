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
// 2. WARD AVAILABILITY
const getBedAvailability = async (req, res) => {
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
        const { hospitalId, wardId } = req.query;
        console.log("Fetching Beds for Ward:", wardId);

        if (!wardId) return res.status(400).json({ message: "wardId is required" });

        const beds = await Bed.find({ hospitalId, wardId });
        res.json({ success: true, count: beds.length, data: beds });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 2. CHECKOUT SUMMARY (Beds + Doctors) ---
const getHospitalCheckoutSummary = async (req, res) => {
    try {
        const { 
            doctorId, bedId, consultationType, couponCode, 
            specialServices, distance = 0, days = 1 
        } = req.body;

        let baseFee = 0;
        let visitCharge = 0;
        let subtotal = 0;

        // CASE A: Doctor Appointment Logic
        if (doctorId) {
            const doctor = await Doctor.findById(doctorId);
            if (!doctor) return res.status(404).json({ message: "Doctor not found" });

            // Type Mapping (UI to Model Keys)
            const typeMap = {
                'Video Consult': 'online',
                'Clinic Visit': 'clinic',
                'Home Visit': 'home'
            };
            const statusKey = typeMap[consultationType];

            // 1. Check if the selected service is enabled by doctor
            if (!doctor.consultationStatus || !doctor.consultationStatus[statusKey]) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Dr. ${doctor.name} is currently not accepting ${consultationType} requests.` 
                });
            }

            // 2. Assign Fee based on active status
            baseFee = doctor.fees[statusKey];

            // 3. Distance charges for Home Visit
            if (consultationType === 'Home Visit') {
                const chargeConfig = await DeliveryCharge.findOne({ vendorId: doctor.hospitalId || doctor._id });
                if (chargeConfig) {
                    visitCharge = chargeConfig.fixedPrice;
                    if (distance > chargeConfig.fixedDistance) {
                        visitCharge += (distance - chargeConfig.fixedDistance) * chargeConfig.pricePerKM;
                    }
                }
            }
        } 
        
        // CASE B: Bed Booking Logic
        else if (bedId) {
            const bed = await Bed.findById(bedId);
            if (!bed) return res.status(404).json({ message: "Bed not found" });
            if (bed.status !== 'Available') return res.status(400).json({ message: "Bed is no longer available" });
            baseFee = bed.pricePerDay * days;
        }

        // Special Services ₹100/- each (Screenshot 29)
        const serviceCharge = (specialServices?.length || 0) * 100;
        subtotal = baseFee + visitCharge + serviceCharge;

        // Coupon Logic
        let discount = 0;
        let appliedCouponId = null;
        if (couponCode) {
            const coupon = await Coupon.findOne({ couponName: couponCode.toUpperCase(), isActive: true });
            if (coupon && subtotal >= coupon.minOrderAmount) {
                discount = Math.min((subtotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
                appliedCouponId = coupon._id;
            }
        }

        res.json({
            success: true,
            data: {
                baseFee,
                visitCharge,
                serviceCharge,
                discount,
                subtotal,
                totalPayable: subtotal - discount,
                appliedCouponId,
                currency: "₹"
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 2. FINAL UNIFIED BOOKING (Admission & Appointment) ---
const finalHospitalBooking = async (req, res) => {
    try {
        const { 
            hospitalId, doctorId, bedId, bookingType, triageLevel, 
            appointmentDate, appointmentTime, patients, pricing, 
            consultationType, specialServices, couponId, couponCode 
        } = req.body;

        // 1. RE-VERIFY AVAILABILITY (Security Guard)
        if (bedId) {
            const bed = await Bed.findById(bedId);
            if (!bed || bed.status !== 'Available') return res.status(400).json({ message: "Bed is already booked" });
        }
        
        if (doctorId) {
            const doctor = await Doctor.findById(doctorId);
            const typeMap = { 'Video Consult': 'online', 'Clinic Visit': 'clinic', 'Home Visit': 'home' };
            if (!doctor.consultationStatus[typeMap[consultationType]]) {
                return res.status(400).json({ message: "Doctor just disabled this service." });
            }
        }

        // 2. AUTO-RESOLVE HOSPITAL ID & IDS
        let finalHospitalId = hospitalId;
        if (doctorId && !finalHospitalId) {
            const doc = await Doctor.findById(doctorId);
            finalHospitalId = doc?.hospitalId || null;
        }

        const bookingId = `HK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const trackingOTP = Math.floor(1000 + Math.random() * 9000).toString();

        // 3. MAP PATIENTS (Mongoose Schema Strict Keys)
        const formattedPatients = patients.map(p => ({
            patientName: p.patientName || p.name,
            patientAge: Number(p.patientAge || p.age),
            gender: p.gender,
            relation: p.relation || 'Self',
            isMainUser: p.isMainUser || false,
            reasonForVisit: p.reasonForVisit || ""
        }));

        // 4. CREATE APPOINTMENT (All-in-one logic)
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
            consultationType: bedId ? 'Clinic Visit' : consultationType,
            specialServices: specialServices || [],
            
            pricingBreakdown: {
                baseFee: Number(pricing.baseFee),
                visitCharges: Number(pricing.visitCharge || 0),
                extraCharges: Number(pricing.serviceCharge || 0),
                discountAmount: Number(pricing.discount || 0),
                subtotal: Number(pricing.subtotal)
            },
            
            couponDetails: couponId ? {
                couponId,
                couponCode,
                discountValue: Number(pricing.discount)
            } : undefined,

            totalAmount: Number(pricing.totalPayable), // 👈 Mongoose Validation Success
            bookingId,
            status: finalHospitalId ? 'Hospital-Pending' : 'Pending',
            paymentStatus: 'Paid',
            'tracking.otp': trackingOTP
        });

        // 5. LOCK BED IF ADMISSION
        if (bedId) {
            await Bed.findByIdAndUpdate(bedId, { $set: { status: 'Reserved' } });
            await Ward.findOneAndUpdate({ hospitalId: finalHospitalId }, { $inc: { availableBeds: -1 } });
        }

        res.status(201).json({ success: true, bookingId, trackingOTP, data: appointment });

    } catch (error) {
        console.error("Master Booking Error:", error);
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
    getHospitals, getBedAvailability, getBedGrid,
    getHospitalCheckoutSummary, finalHospitalBooking, getMyHospitalBookings, getBookingProfiles
};