const Nurse = require('../../../models/Nurse');
const NurseBooking = require('../../../models/NurseBooking');
const NurseService = require('../../../models/NurseService');
const Availability = require('../../../models/Availability');
const DeliveryCharge = require('../../../models/DeliveryCharge');
const NurseConsumable = require('../../../models/NurseConsumable');
const { generateNurseSlots } = require('../../../utils/timeSlotHelper');
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

// 2. GET NURSE DETAILS
// const getNurseDetails = async (req, res) => {
//     try {
//         const nurseId = req.params.id;
//         const nurse = await Nurse.findById(nurseId).lean();
//         if (!nurse) return res.status(404).json({ message: "Nurse not found" });

//         const services = await NurseService.find({ nurseId: nurseId, isActive: true }).populate('consumablesUsed');
//         const consumables = await NurseConsumable.find({ nurseId: nurseId, isActive: true });

//         res.json({ success: true, data: { ...nurse, services, consumables } });
//     } catch (error) { res.status(500).json({ message: error.message }); }
// };

// 3. GET AVAILABILITY (Slot Generation)
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
            status: { $in: ['Confirmed', 'Assigned', 'In-Progress'] }
        });

        const data = allSlots.map(slot => {
            const bookingCount = bookings.filter(b => b.schedule.startTime === slot.time).length;
            return {
                ...slot,
                isAvailable: config.maxClientsPerSlot === 0 ? true : bookingCount < config.maxClientsPerSlot,
            };
        });

        res.json({ success: true, nurseId, date, bookingType: type, data });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

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

// 2. CHECKOUT (Verified Billing based on Service Pricing)
const checkoutNurseBooking = async (req, res) => {
    try {
        const { nurseId, serviceId, selectedType, slotTime, selectedConsumables, fasterService } = req.body;

        const service = await NurseService.findById(serviceId);
        const deliveryConfig = await DeliveryCharge.findOne({ vendorId: nurseId });
        const availConfig = await Availability.findOne({ vendorId: nurseId });

        if (!service) return res.status(404).json({ message: "Service not found" });

        // A. Pick Price from Service based on Figma Dropdown Selection
        let basePrice = 0;
        if (selectedType === 'One day One Time') basePrice = service.oneDayPrice;
        else if (selectedType === 'For Multiple Days') basePrice = service.multipleDaysPrice;
        else if (selectedType === 'Acc. To Per/Hours') basePrice = service.hourlyPrice;

        // B. Premium Slot / High Demand Fee (+79 logic from config)
        const premiumSlot = availConfig?.premiumSlots?.find(ps => ps.time === slotTime);
        const slotSurcharge = premiumSlot ? premiumSlot.extraFee : 79; // Default 79 as per Figma if not specified

        // C. Consumables Calculation
        let consumableTotal = 0;
        if (selectedConsumables?.length > 0) {
            const items = await NurseConsumable.find({ _id: { $in: selectedConsumables } });
            consumableTotal = items.reduce((acc, item) => acc + item.price, 0);
        }

        // D. Emergency Fee
        const emergencyFee = fasterService ? (deliveryConfig?.fastDeliveryExtra || 0) : 0;

        const totalPayable = basePrice + slotSurcharge + consumableTotal + emergencyFee;

        res.json({
            success: true,
            breakdown: {
                serviceName: service.title,
                selectedType,
                basePrice,
                slotSurcharge,
                consumableCharge: consumableTotal,
                emergencyFee,
                totalPayable: Math.round(totalPayable)
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. PLACE BOOKING (Final Snapshot)
const placeNurseBooking = async (req, res) => {
    try {
        const { selectedConsumables } = req.body;
        let consumablesDetail = [];
        if (selectedConsumables?.length > 0) {
            const items = await NurseConsumable.find({ _id: { $in: selectedConsumables } });
            consumablesDetail = items.map(i => ({
                consumableId: i._id, itemName: i.itemName, price: i.price, unitType: i.unitType
            }));
        }

        const bookingId = `OD${crypto.randomInt(100000, 999999)}`;
        const booking = await NurseBooking.create({
            ...req.body,
            userId: req.user.id,
            bookingId,
            selectedConsumables: consumablesDetail,
            status: 'Pending'
        });

        res.status(201).json({ success: true, message: "Booking Created", data: booking });
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


module.exports = { getNurses,getNurseDetails,searchNurses,checkoutNurseBooking, placeNurseBooking, getNurseAvailability,getMyNurseBookings, rateNurseService,
    getAppointmentStatus, 
    uploadBookingPrescription  };