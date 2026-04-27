const Nurse = require('../../../models/Nurse');
const NurseBooking = require('../../../models/NurseBooking');
const VendorKMLimit = require('../../../models/VendorKMLimit');
const { getDistance } = require('../../../utils/helpers');
const { generateTimeSlots } = require('../../../utils/timeSlotHelper');
const moment = require('moment');
const Availability = require('../../../models/Availability');
const crypto = require('crypto');


// 1. SEARCH/FILTER NURSES
// endpoint: POST /api/user/nurse/list
const getNurses = async (req, res) => {
    try {
        const { lat, lng, city, search, speciality } = req.body;
        
        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Nurse', isActive: true });
        const maxRadius = limitConfig ? limitConfig.kmLimit : 100;

        let query = { profileStatus: 'Approved', isActive: true };
        if (city) query.city = new RegExp(city, 'i');
        if (search) query.name = new RegExp(search, 'i');
        if (speciality) query.speciality = speciality;

        const nurses = await Nurse.find(query).lean();
        const filteredNurses = [];
        
        for (let nurse of nurses) {
            let distance = 0;
            if (lat && lng && nurse.location?.lat) {
                distance = await getDistance(lat, lng, nurse.location.lat, nurse.location.lng);
            }

            if (!lat || distance <= maxRadius) {
                // Calculate starting price from offeredServices array
                const prices = nurse.offeredServices?.filter(s => s.isActive).map(s => s.price) || [];
                const startingPrice = prices.length > 0 ? Math.min(...prices) : 0;

                filteredNurses.push({
                    _id: nurse._id,
                    name: nurse.name,
                    profileImage: nurse.profileImage,
                    city: nurse.city,
                    rating: nurse.rating,
                    speciality: nurse.speciality,
                    experienceYears: nurse.experienceYears,
                    distance: distance.toFixed(1),
                    startingPrice: startingPrice,
                    // Figma card pe 2-3 services ke naam dikhane ke liye
                    topServices: nurse.offeredServices?.slice(0, 3).map(s => s.title) || []
                });
            }
        }

        if (lat && lng) filteredNurses.sort((a, b) => a.distance - b.distance);
        res.json({ success: true, count: filteredNurses.length, data: filteredNurses });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. GET DETAILS (Figma: Nurse Profile & Packages)
const getNurseDetails = async (req, res) => {
    try {
        const nurse = await Nurse.findById(req.params.id).select('-password -token');
        if (!nurse) return res.status(404).json({ message: "Nurse not found" });

        res.json({ success: true, data: nurse });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const bookNurse = async (req, res) => {
    try {
        const { nurseId, selectedServiceId, patientDetails, schedule, healthDetails, totalPrice, needConsumable } = req.body;
        const bookingId = `HK-NURSE-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        
        const booking = await NurseBooking.create({
            userId: req.user.id,
            nurseId,
            selectedServiceId, // Link to offeredServices ID
            patientDetails,
            schedule,
            healthDetails,
            totalPrice,
            needConsumable,
            bookingId,
            status: 'Pending'
        });
        res.status(201).json({ success: true, message: "Booking Request Sent", data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};











// 1. SEARCH/FILTER NURSES (Figma: Nursing Care/Nurse list)
// POST /user/nurse/search
const searchNurses = async (req, res) => {
    try {
        const { city, speciality, search } = req.body;
        let query = { profileStatus: 'Approved', isActive: true };
        if (city) query.city = new RegExp(city, 'i');
        if (speciality) query.speciality = speciality;
        if (search) query.name = new RegExp(search, 'i');

        const nurses = await Nurse.find(query).select('-password');
        res.json({ success: true, count: nurses.length, data: nurses });
    } catch (error) { res.status(500).json({ message: error.message }); }
};



// 3. GET MY APPOINTMENTS
// GET /api/user/nurse/my-appointments
const getMyNurseAppointments = async (req, res) => {
    try {
        const bookings = await NurseBooking.find({ userId: req.user.id }).populate('nurseId', 'name profileImage speciality');
        res.json({ success: true, data: bookings });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

 

module.exports = { getNurses,getNurseDetails,searchNurses, bookNurse, getMyNurseAppointments };