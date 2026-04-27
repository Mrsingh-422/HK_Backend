const Nurse = require('../../../models/Nurse');
const NurseBooking = require('../../../models/NurseBooking');
const NurseService = require('../../../models/NurseService');
const Availability = require('../../../models/Availability');
const VendorKMLimit = require('../../../models/VendorKMLimit');
const DeliveryCharge = require('../../../models/DeliveryCharge');
const { getDistance } = require('../../../utils/helpers');
const { generateTimeSlots } = require('../../../utils/timeSlotHelper');
const moment = require('moment');
const crypto = require('crypto');

// 1. LIST NURSES (Search)
const getNurses = async (req, res) => {
    try {
        const { lat, lng, city, search } = req.body;
        let query = { profileStatus: 'Approved', isActive: true };

        if (city) query.city = new RegExp(city, 'i');
        if (search) query.name = new RegExp(search, 'i');

        const nurses = await Nurse.find(query).lean();
        const data = [];

        for (let nurse of nurses) {
            const services = await NurseService.find({ nurseId: nurse._id, isActive: true });
            if (services.length > 0) {
                const minPrice = Math.min(...services.map(s => s.price));
                data.push({
                    _id: nurse._id,
                    name: nurse.name,
                    profileImage: nurse.profileImage,
                    rating: nurse.rating,
                    city: nurse.city,
                    startingPrice: minPrice,
                    topServices: services.slice(0, 2).map(s => s.title)
                });
            }
        }
        res.json({ success: true, count: data.length, data });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. GET NURSE DETAILS
const getNurseDetails = async (req, res) => {
    try {
        const nurse = await Nurse.findById(req.params.id).lean();
        if (!nurse) return res.status(404).json({ message: "Nurse not found" });
        const services = await NurseService.find({ nurseId: nurse._id, isActive: true });
        res.json({ success: true, data: { ...nurse, services } });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getNurseAvailability = async (req, res) => {
    try {
        const { nurseId } = req.params;
        const { date } = req.query;

        const config = await Availability.findOne({ vendorId: nurseId });
        if (!config) return res.status(404).json({ message: "Nurse schedule not found" });

        // Helper slots generate karega
        let allSlots = generateTimeSlots(config);

        const queryDate = moment(date).startOf('day').toDate();
        const bookings = await NurseBooking.find({
            nurseId,
            "schedule.startDate": queryDate,
            status: { $in: ['Confirmed', 'Assigned', 'In-Progress'] }
        });

        const data = allSlots.map(slot => {
            const bookingCount = bookings.filter(b => b.schedule.startTime === slot.time).length;
            
            // Premium Info fetch from config
            const premiumInfo = config.premiumSlots.find(ps => ps.time === slot.time);

            return {
                time: slot.time,
                displayTime: moment(slot.time, "HH:mm").format("hh:mm A"),
                category: slot.category,
                isPremium: !!premiumInfo,
                extraFee: premiumInfo ? premiumInfo.extraFee : 0, // Premium charge
                isAvailable: bookingCount < config.maxClientsPerSlot,
                remainingCapacity: config.maxClientsPerSlot - bookingCount
            };
        });

        res.json({ success: true, date, data });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. CHECKOUT (Service + Surcharge + Premium + KM-based Delivery Charge)
const checkoutNurseBooking = async (req, res) => {
    try {
        const { nurseId, serviceId, slotTime, fasterService } = req.body;

        // 1. Fetch Necessary Data
        const service = await NurseService.findById(serviceId);
        const availConfig = await Availability.findOne({ vendorId: nurseId });
        const deliveryConfig = await DeliveryCharge.findOne({ vendorId: nurseId });

        if (!service || !availConfig || !deliveryConfig) {
            return res.status(404).json({ message: "Configuration data missing (Service/Availability/Delivery)" });
        }

        // 2. Calculations
        const basePrice = service.price;

        // Premium Slot Fee
        const premiumSlot = availConfig.premiumSlots ? availConfig.premiumSlots.find(ps => ps.time === slotTime) : null;
        const premiumFee = premiumSlot ? premiumSlot.extraFee : 0;

        // Faster/Emergency Service Fee
        const finalFasterFee = fasterService ? deliveryConfig.fastDeliveryExtra : 0;

        // Tax Calculation (If defined in your DeliveryCharge model)
        let taxAmount = 0;
        if (deliveryConfig.taxPercentage > 0) {
            taxAmount = (basePrice + premiumFee + finalFasterFee) * (deliveryConfig.taxPercentage / 100);
        } else if (deliveryConfig.taxInRupees > 0) {
            taxAmount = deliveryConfig.taxInRupees;
        }

        // 3. Final Total
        const totalPayable = basePrice + premiumFee + finalFasterFee + taxAmount;

        res.json({
            success: true,
            breakdown: {
                serviceName: service.title,
                serviceType: service.type, // Daily Care / Package
                basePrice: basePrice,
                premiumSlotFee: premiumFee,
                fasterServiceFee: finalFasterFee,
                taxAmount: Math.round(taxAmount),
                totalPayable: Math.round(totalPayable),
                // Additional UI Details for Figma Screen 8
                consumablesIncluded: service.consumablesUsed || [],
                procedureIncluded: service.procedureIncluded || "Standard Procedure"
            }
        });

    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 3. PLACE BOOKING
const placeNurseBooking = async (req, res) => {
    try {
        const bookingId = `OD${crypto.randomInt(100000, 999999)}`;
        const booking = await NurseBooking.create({
            ...req.body,
            userId: req.user.id,
            bookingId,
            status: 'Pending'
        });
        res.status(201).json({ success: true, data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 6. TRACKING & STATUS
const getAppointmentStatus = async (req, res) => {
    try {
        const booking = await NurseBooking.findById(req.params.id)
            .populate('nurseId', 'name profileImage rating city address location')
            .populate('assignedStaffId', 'name phone profilePic status');

        if (!booking) return res.status(404).json({ message: "Order not found" });

        res.json({ 
            success: true, 
            data: {
                orderStatus: booking.status,
                nurseInfo: booking.nurseId,
                assignedStaff: booking.assignedStaffId,
                summary: {
                    id: booking.bookingId,
                    total: booking.totalPrice,
                    date: booking.schedule.startDate,
                    time: booking.schedule.startTime
                }
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