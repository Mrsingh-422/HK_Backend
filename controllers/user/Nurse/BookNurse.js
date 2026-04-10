const Nurse = require('../../../models/Nurse');
const NurseBooking = require('../../../models/NurseBooking');
const VendorKMLimit = require('../../../models/VendorKMLimit');
const NurseService = require('../../../models/NurseService');
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
        
        // 1. KM Limit Check (Nurse ke liye VendorKMLimit se)
        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Nurse', isActive: true });
        const maxRadius = limitConfig ? limitConfig.kmLimit : 100;

        let query = { profileStatus: 'Approved', isActive: true };
        if (city) query.city = new RegExp(city, 'i');
        if (search) query.name = new RegExp(search, 'i');
        if (speciality) query.speciality = speciality;

        // 2. Fetch Nurses
        const nurses = await Nurse.find(query)
            .select('name profileImage city rating totalReviews speciality experienceYears about location')
            .lean();

        const filteredNurses = [];
        
        for (let nurse of nurses) {
            let distance = 0;
            if (lat && lng && nurse.location?.lat) {
                distance = await getDistance(lat, lng, nurse.location.lat, nurse.location.lng);
            }

            // KM Limit Filter
            if (!lat || distance <= maxRadius) {
                
                // 3. FETCH NURSING SERVICES (Daily Care/Packages)
                // Figma Screenshot 37: Home Nursing Care services
                const services = await NurseService.find({ 
                    nurseId: nurse._id 
                }).select('title price').limit(3).lean();

                // 4. CALCULATE STARTING PRICE
                // Sabse kam price wala service package/daily care
                const minService = await NurseService.findOne({ nurseId: nurse._id })
                    .sort({ price: 1 })
                    .select('price');

                const startingPrice = minService ? minService.price : 0;

                filteredNurses.push({
                    _id: nurse._id,
                    name: nurse.name,
                    profileImage: nurse.profileImage,
                    city: nurse.city,
                    rating: nurse.rating,
                    totalReviews: nurse.totalReviews,
                    speciality: nurse.speciality,
                    experienceYears: nurse.experienceYears,
                    distance: distance.toFixed(1),
                    topServices: services.map(s => s.title),
                    startingPrice: startingPrice // Figma: "Starting From ₹1499"
                });
            }
        }

        // 5. SORT: Najdeek wali pehle
        if (lat && lng) {
            filteredNurses.sort((a, b) => a.distance - b.distance);
        }

        res.json({ success: true, count: filteredNurses.length, data: filteredNurses });
    } catch (error) { 
        console.error("Nurse Listing Error:", error);
        res.status(500).json({ message: error.message }); 
    }
};
const getNurseDetails = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Fetch Nurse Info
        const nurse = await Nurse.findById(id).select('-password -token');
        if (!nurse) return res.status(404).json({ message: "Nurse not found" });

        // 2. Fetch Availability Config
        const config = await Availability.findOne({ vendorId: id });
        
        // 3. Logic to determine 'Next Available Slot'
        let nextAvailable = "N/A";
        let status = "Offline";

        if (config) {
            // Check status from Nurse schema
            status = nurse.isActive ? "Online" : "Offline";
            
            // Generate first available slot for today/tomorrow
            const now = moment();
            const startOfDay = moment().startOf('day');
            
            // Check if current time is within working hours
            const startTime = moment(config.startTime, "HH:mm");
            const endTime = moment(config.endTime, "HH:mm");

            if (now.isBetween(startTime, endTime)) {
                nextAvailable = `Available Now (${now.format("hh:mm A")})`;
            } else if (now.isBefore(startTime)) {
                nextAvailable = `Today - ${config.startTime}`;
            } else {
                nextAvailable = `Tomorrow - ${config.startTime}`;
            }
        }

        // 4. Response Matching Figma Screen
        res.json({ 
            success: true, 
            data: {
                ...nurse._doc,
                status,          // "Online" / "Busy" / "Offline"
                nextAvailable,   // "Today - 4:00 PM"
                timingLabel: config ? `Open ${config.startTime} - ${config.endTime}` : "Timing not set",
                gallery: nurse.documents?.nurseImages || [] // Portfolio photos
            } 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 2. BOOK NURSE
// endpoint: POST /api/user/nurse/book
const bookNurse = async (req, res) => {
    try {
        const { nurseId, patientDetails, serviceType, schedule, totalPrice, needConsumable } = req.body;
        
        const bookingId = `NURSE-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        
        const booking = await NurseBooking.create({
            userId: req.user.id,
            nurseId,
            patientDetails,
            serviceType,
            schedule,
            totalPrice,
            needConsumable,
            bookingId,
            status: 'Pending'
        });
        
        res.status(201).json({ success: true, message: "Booking Request Sent", data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. GET MY NURSE APPOINTMENTS
// endpoint: GET /api/user/nurse/my-appointments
const getMyNurseAppointments = async (req, res) => {
    try {
        const bookings = await NurseBooking.find({ userId: req.user.id })
            .populate('nurseId', 'name profileImage speciality')
            .sort({ createdAt: -1 });
        res.json({ success: true, data: bookings });
    } catch (error) { res.status(500).json({ message: error.message }); }
};



module.exports = { getNurses,getNurseDetails, bookNurse, getMyNurseAppointments };