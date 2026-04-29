const Nurse = require('../../../models/Nurse');
const NurseBooking = require('../../../models/NurseBooking');
const NurseService = require('../../../models/NurseService');
const Availability = require('../../../models/Availability');
const DeliveryCharge = require('../../../models/DeliveryCharge');
const { isNurseAvailable, generateNurseSlots } = require('../../../utils/timeSlotHelper');
const NurseConsumable = require('../../../models/NurseConsumable');
// const { generateNurseSlots } = require('../../../utils/timeSlotHelper');
const moment = require('moment');
const crypto = require('crypto');

// 1. LIST NURSES
const getNurses = async (req, res) => {
    try {
        const { city, search, speciality } = req.body;
        let query = { profileStatus: 'Approved', isActive: true };
        if (city) query.city = new RegExp(city, 'i');
        if (search) query.name = new RegExp(search, 'i');
        if (speciality) query.speciality = speciality;

        const nurses = await Nurse.find(query).lean();
        const data = [];

        for (let nurse of nurses) {
            const services = await NurseService.find({ nurseId: nurse._id, isActive: true });
            if (services.length > 0) {
                // Starting price based on finalPrice of services
                const minPrice = Math.min(...services.map(s => s.finalPrice));
                data.push({
                    _id: nurse._id,
                    name: nurse.name,
                    profileImage: nurse.profileImage,
                    rating: nurse.rating,
                    city: nurse.city,
                    experienceYears: nurse.experienceYears,
                    startingPrice: minPrice,
                    topServices: services.slice(0, 2).map(s => s.title)
                });
            }
        }
        res.json({ success: true, count: data.length, data });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. GET AVAILABILITY (Slot Generation)
// const getNurseAvailability = async (req, res) => {
//     try {
//         const { nurseId } = req.params;
//         const { date, type } = req.query;

//         const config = await Availability.findOne({ vendorId: nurseId });
//         if (!config) return res.status(404).json({ message: "Nurse schedule not found" });

//         let allSlots = generateNurseSlots(config, type);
//         const queryDate = moment(date).startOf('day').toDate();
        
//         const bookings = await NurseBooking.find({
//             nurseId,
//             "schedule.startDate": queryDate,
//             status: { $in: ['Confirmed', 'Assigned', 'In-Progress'] }
//         });

//         const data = allSlots.map(slot => {
//             const bookingCount = bookings.filter(b => b.schedule.startTime === slot.time).length;
//             return {
//                 ...slot,
//                 isAvailable: config.maxClientsPerSlot === 0 ? true : bookingCount < config.maxClientsPerSlot,
//                 extraFee: slot.extraFee || 79 // Slot price dynamic from helper
//             };
//         });

//         res.json({ success: true, data });
//     } catch (error) { res.status(500).json({ message: error.message }); }
// };


const getNurseDetails = async (req, res) => {
    try {
        const nurseId = req.params.id;
        const nurse = await Nurse.findById(nurseId).lean();
        if (!nurse) return res.status(404).json({ message: "Nurse not found" });

        // Services aur Consumables dono fetch karein
        const [services, consumables, availConfig] = await Promise.all([
            NurseService.find({ nurseId, isActive: true }),
            NurseConsumable.find({ nurseId, isActive: true }),
            Availability.findOne({ vendorId: nurseId })
        ]);

        res.json({ 
            success: true, 
            data: { ...nurse, services, consumables, availability: availConfig } 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getNurseDeliveryConfig = async (req, res) => {
    try {
        const { nurseId } = req.params;
        const [delivery, availability] = await Promise.all([
            DeliveryCharge.findOne({ vendorId: nurseId }),
            Availability.findOne({ vendorId: nurseId })
        ]);

        res.json({
            success: true,
            data: {
                fastDeliveryExtra: delivery?.fastDeliveryExtra || 0,
                baseSurcharge: 79, // Aapka fixed standard slot surcharge
                pricePerKM: delivery?.pricePerKM || 0,
                fixedDistance: delivery?.fixedDistance || 0
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const checkRangeAvailability = async (req, res) => {
    try {
        const { nurseId, startDate, endDate } = req.query;

        if (!startDate || !endDate) return res.status(400).json({ message: "Start and End date required" });

        const reqStart = moment(startDate).startOf('day');
        const reqEnd = moment(endDate).endOf('day');

        // Check if ANY booking exists between these two dates
        const conflictingBookings = await NurseBooking.find({
            nurseId,
            status: { $in: ['Confirmed', 'Assigned', 'On-The-Way', 'Arrived', 'Service-Started'] },
            $or: [
                { 
                    "schedule.startDate": { $lte: reqEnd.toDate() }, 
                    "schedule.endDate": { $gte: reqStart.toDate() } 
                }
            ]
        });

        if (conflictingBookings.length > 0) {
            // Hum un dates ki list bhej sakte hain jo already booked hain
            const busyDates = conflictingBookings.map(b => ({
                from: moment(b.schedule.startDate).format('YYYY-MM-DD'),
                to: moment(b.schedule.endDate).format('YYYY-MM-DD'),
                type: b.schedule.duration
            }));

            return res.json({ 
                success: false, 
                isAvailable: false, 
                message: "Nurse is busy on some days within this range", 
                busyDates 
            });
        }

        res.json({ success: true, isAvailable: true, message: "Nurse is available for the entire range" });

    } catch (error) { res.status(500).json({ message: error.message }); }
};
// B. Updated Checkout (100% Dynamic)
const getNurseAvailability = async (req, res) => {
    try {
        const { nurseId } = req.params;
        const { date, type } = req.query;

        const config = await Availability.findOne({ vendorId: nurseId });
        if (!config) return res.status(404).json({ message: "Nurse schedule not found" });

        let allSlots = generateNurseSlots(config, type);
        const queryDate = moment(date).startOf('day').toDate();
        
        const bookings = await NurseBooking.find({
            nurseId,
            "schedule.startDate": queryDate,
            status: { $in: ['Confirmed', 'Assigned', 'In-Progress', 'Pending'] }
        });

        const data = allSlots.map(slot => {
            const bookingCount = bookings.filter(b => b.schedule.startTime === slot.time).length;
            return {
                ...slot,
                isAvailable: config.maxClientsPerSlot === 0 ? true : bookingCount < config.maxClientsPerSlot,
                // extraFee helper se 0 ya premium price lekar aayega
            };
        });

        res.json({ success: true, data });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. Checkout API Fix
const checkoutNurseBooking = async (req, res) => {
    try {
        const { nurseId, serviceId, selectedType, startDate, endDate, startTime, endTime, isFasterService } = req.body;

        const [service, delivery, config] = await Promise.all([
            NurseService.findById(serviceId),
            DeliveryCharge.findOne({ vendorId: nurseId }),
            Availability.findOne({ vendorId: nurseId })
        ]);

        if (!service) return res.status(404).json({ message: "Service not found" });

        let basePrice = 0;
        let units = 1;

        // Base Pricing Logic
        if (selectedType === 'One day One Time') basePrice = service.oneDayPrice || service.finalPrice;
        else if (selectedType === 'For Multiple Days') {
            units = moment(endDate).diff(moment(startDate), 'days') + 1;
            basePrice = (service.multipleDaysPrice || service.finalPrice) * units;
        } else if (selectedType === 'Acc. To Per/Hours') {
            units = moment(endTime, "HH:mm").diff(moment(startTime, "HH:mm"), 'hours') || 1;
            basePrice = (service.hourlyPrice || service.finalPrice) * units;
        }

        // 1. Dynamic Faster Charge (Using fastDeliveryExtra key only)
        const fasterCharge = isFasterService ? (delivery?.fastDeliveryExtra || 0) : 0;

        // 2. Dynamic Slot Surcharge (Only from premiumSlots, otherwise 0)
        const premiumSlot = config?.premiumSlots?.find(p => p.time === startTime);
        const slotSurcharge = premiumSlot ? premiumSlot.extraFee : 0; 

        const tax = Math.round(basePrice * 0.05);

        res.json({
            success: true,
            breakdown: {
                basePrice: Number(basePrice),
                slotSurcharge: Number(slotSurcharge),
                fasterServiceCharge: Number(fasterCharge),
                taxAmount: tax,
                totalPrice: basePrice + slotSurcharge + fasterCharge + tax,
                units,
                selectedType
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// 2. PLACE BOOKING (Snapshot logic Figma Image 9)
const placeNurseBooking = async (req, res) => {
    try {
        const { nurseId, serviceId, schedule, priceBreakdown, healthDetails, patients, address, triageFacility } = req.body;

        const service = await NurseService.findById(serviceId);
        const available = await isNurseAvailable(nurseId, { selectedType: schedule.duration, ...schedule }, NurseBooking, Availability);
        if (!available) return res.status(400).json({ message: "Slot not available!" });

        const booking = await NurseBooking.create({
            userId: req.user.id,
            nurseId,
            serviceId,
            bookingId: `NB${Date.now().toString().slice(-6)}`,
            serviceDetails: {
                title: service.title,
                type: service.type,
                duration: schedule.duration,
                basePrice: service.finalPrice,
                procedureIncluded: service.procedureIncluded,
                servicesOffered: service.servicesOffered
            },
            priceBreakdown,
            patients,
            healthDetails,
            schedule: {
                ...schedule,
                startDate: moment(schedule.startDate).startOf('day').toDate(),
                endDate: schedule.duration === 'For Multiple Days' ? moment(schedule.endDate).endOf('day').toDate() : moment(schedule.startDate).endOf('day').toDate()
            },
            address,
            triageFacility,
            assessmentLocation: req.body.assessmentLocation || 'At Home',
            status: 'Pending'
        });

        res.status(201).json({ success: true, data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 6. TRACKING STATUS (Populated Response)
const getAppointmentStatus = async (req, res) => {
    try {
        const booking = await NurseBooking.findById(req.params.id)
            .populate('nurseId', 'name profileImage rating city address location')
            .populate('serviceId', 'title description procedureIncluded consumablesUsed')
            .populate('assignedStaffId', 'name phone profilePic status');

        if (!booking) return res.status(404).json({ message: "Booking not found" });

        // Calculate ETA Simulation (Figma: "On the way • 25 mins arrival")
        const eta = "25 mins"; 
        const distance = "3.2 km";

        res.json({ 
            success: true, 
            data: {
                ...booking._doc,
                eta,
                distance
            } 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

 
// 4. UPLOAD PRESCRIPTION (Figma Screen: Add Prescription)
const uploadBookingPrescription = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Please upload a prescription" });
        
        const booking = await NurseBooking.findByIdAndUpdate(
            req.params.id,
            { prescriptionImage: req.file.path },
            { new: true }
        );
        res.json({ success: true, message: "Prescription Added", data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};




const getMyNurseBookings = async (req, res) => {
    try {
        const bookings = await NurseBooking.find({ userId: req.user.id })
            .populate('nurseId', 'name profileImage speciality')
            .sort({ createdAt: -1 });

        res.json({ success: true, count: bookings.length, data: bookings });
    } catch (error) { res.status(500).json({ message: error.message }); }
};




const rateNurseService = async (req, res) => {
    try {
        const { bookingId, rating, comment } = req.body;

        const booking = await NurseBooking.findById(bookingId);
        if (!booking || booking.status !== 'Completed') {
            return res.status(400).json({ message: "Can only rate completed services" });
        }

        // Update Nurse Model Rating Logic
        const nurse = await Nurse.findById(booking.nurseId);
        const newTotalReviews = nurse.totalReviews + 1;
        const newAverageRating = ((nurse.rating * nurse.totalReviews) + rating) / newTotalReviews;

        await Nurse.findByIdAndUpdate(booking.nurseId, {
            rating: newAverageRating.toFixed(1),
            totalReviews: newTotalReviews
        });

        // Update Booking with Review
        booking.review = { rating, comment, createdAt: new Date() };
        await booking.save();

        res.json({ success: true, message: "Thank you for your feedback!" });
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


module.exports = { getNurses,getNurseDetails,searchNurses,checkoutNurseBooking, placeNurseBooking,checkRangeAvailability, getNurseAvailability,getMyNurseBookings, rateNurseService,
    getAppointmentStatus, 
    uploadBookingPrescription,getNurseDeliveryConfig  };