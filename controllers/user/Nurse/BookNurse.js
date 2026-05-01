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
            // Nurse ki wahi services fetch karein jo active hain
            const services = await NurseService.find({ nurseId: nurse._id, isActive: true });
            
            if (services.length > 0) {
                // UPDATE: Starting price ab 'oneDayPrice' field se calculate hogi
                // Filter karke unhi services ka price uthayenge jinka price 0 se zyada hai
                const validPrices = services.map(s => s.oneDayPrice).filter(p => p > 0);
                
                if (validPrices.length > 0) {
                    const minOneDayPrice = Math.min(...validPrices);

                    data.push({
                        _id: nurse._id,
                        name: nurse.name,
                        profileImage: nurse.profileImage,
                        rating: nurse.rating,
                        city: nurse.city,
                        experienceYears: nurse.experienceYears,
                        startingPrice: minOneDayPrice, // Ab yahan 1 Day Charge dikhega
                        topServices: services.slice(0, 2).map(s => s.title)
                    });
                }
            }
        }
        
        res.json({ success: true, count: data.length, data });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
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

const getNurseDeliveryConfig = async (req, res) => {
    try {
        const { nurseId } = req.params; // LabId, NurseId ya PharmacyId
        
        const config = await DeliveryCharge.findOne({ vendorId: nurseId });

        if (!config) {
            return res.status(404).json({ 
                success: false, 
                message: "Delivery configuration not found for this vendor" 
            });
        }

        res.json({
            success: true,
            data: {
                vendorId: config.vendorId,
                vendorType: config.vendorType,
                // Base charges
                fixedPrice: config.fixedPrice,          // Base fee (e.g., 50 Rs)
                fixedDistance: config.fixedDistance,    // Upto how many KM it's fixed (e.g., 5 KM)
                pricePerKM: config.pricePerKM,          // Extra charge per KM after fixedDistance
                
                // Special charges
                fastDeliveryExtra: config.fastDeliveryExtra, // Rapid/6-hr delivery extra cost
                
                // Thresholds & Taxes
                freeDeliveryThreshold: config.freeDeliveryThreshold, // Free delivery if order > this
                taxPercentage: config.taxPercentage,
                taxInRupees: config.taxInRupees,
                
                updatedAt: config.updatedAt
            }
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
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
        const { month } = req.query; // e.g., "2026-05"

        const config = await Availability.findOne({ vendorId: nurseId });
        const service = await NurseService.findOne({ nurseId, isActive: true }); // Base price dikhane ke liye

        // Response mein premium dates bhej rahe hain taaki frontend calendar par dikha sake
        res.json({
            success: true,
            basePrice: service?.oneDayPrice || 0,
            premiumDates: config.premiumDates || [], // [{date: "2026-05-03", extraFee: 500}]
            timeSlots: generateNurseSlots(config, 'One day One Time')
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. Checkout API Fix
const checkoutNurseBooking = async (req, res) => {
    try {
        const { nurseId, serviceId, selectedType, startDate, endDate, startTime, endTime, isFasterService, patientCount, selectedConsumables } = req.body;

        const [service, config, delivery] = await Promise.all([
            NurseService.findById(serviceId),
            Availability.findOne({ vendorId: nurseId }),
            DeliveryCharge.findOne({ vendorId: nurseId })
        ]);

        if (!service) return res.status(404).json({ message: "Service not found" });
        const pCount = Number(patientCount) || 1;

        let basePricePerUnit = 0;
        let totalSurcharge = 0;
        let units = 1;

        // 1. Core Pricing Selection
        if (selectedType === 'For Multiple Days') {
            const start = moment(startDate).startOf('day');
            const end = moment(endDate).startOf('day');
            units = end.diff(start, 'days') + 1;
            basePricePerUnit = service.multipleDaysPrice;
            let curr = moment(start);
            while (curr <= end) {
                const p = config.premiumDates?.find(pd => pd.date === curr.format('YYYY-MM-DD'));
                if (p) totalSurcharge += p.extraFee;
                curr.add(1, 'days');
            }
        } 
        else if (selectedType === 'One day One Time') {
            basePricePerUnit = service.oneDayPrice;
            const p = config.premiumDates?.find(pd => pd.date === moment(startDate).format('YYYY-MM-DD'));
            if (p) totalSurcharge = p.extraFee;
        }
        else if (selectedType === 'Acc. To Per/Hours') {
            const hStart = moment(startTime, "HH:mm");
            const hEnd = moment(endTime, "HH:mm");
            units = hEnd.diff(hStart, 'hours') || 1;
            basePricePerUnit = service.hourlyPrice;
            const p = config.premiumSlots?.find(ps => ps.time === startTime);
            totalSurcharge = p ? p.extraFee : 0;
        }

        // 2. Add-ons Calculation
        const consumableTotal = (selectedConsumables || []).reduce((acc, curr) => acc + (Number(curr.price) || 0), 0);
        const fasterCharge = isFasterService ? (delivery?.fastDeliveryExtra || 0) : 0;
        
        // Subtotal before tax
        const subTotalWithPatients = ((basePricePerUnit * units) + totalSurcharge + consumableTotal) * pCount;
        const subTotalWithFaster = subTotalWithPatients + fasterCharge;

        // 3. DYNAMIC TAX LOGIC (Figma/API Sync)
        let finalTax = 0;
        if (delivery) {
            // Priority: Percentage Tax first, then fixed Rupee tax
            if (delivery.taxPercentage && delivery.taxPercentage > 0) {
                finalTax = (subTotalWithFaster * delivery.taxPercentage) / 100;
            }
            if (delivery.taxInRupees && delivery.taxInRupees > 0) {
                finalTax += delivery.taxInRupees;
            }
        }

        res.json({
            success: true,
            breakdown: {
                basePrice: basePricePerUnit * units * pCount,
                slotSurcharge: totalSurcharge * pCount,
                fasterServiceCharge: fasterCharge,
                consumableTotal: consumableTotal * pCount,
                taxAmount: Math.round(finalTax), // DYNAMIC TAX
                totalPrice: Math.round(subTotalWithFaster + finalTax),
                units,
                pCount
            }
        });
    } catch (error) { 
        console.error("Checkout Error:", error);
        res.status(500).json({ message: error.message }); 
    }
};

// 5. PLACE BOOKING (Consumables Fix)
const placeNurseBooking = async (req, res) => {
    try {
        const { nurseId, serviceId, schedule, priceBreakdown, patients, healthDetails, address, selectedConsumables, needConsumable, assessmentLocation } = req.body;
        const service = await NurseService.findById(serviceId);

        const booking = await NurseBooking.create({
            userId: req.user.id,
            nurseId, serviceId,
            bookingId: `NB${Date.now().toString().slice(-8)}`,
            serviceDetails: {
                title: service.title,
                type: service.type,
                duration: schedule.duration,
                basePrice: service.finalPrice
            },
            priceBreakdown: {
                basePrice: priceBreakdown.basePrice,
                slotSurcharge: priceBreakdown.slotSurcharge,
                fasterServiceCharge: priceBreakdown.fasterServiceCharge,
                taxAmount: priceBreakdown.taxAmount,
                totalPrice: priceBreakdown.totalPrice
            },
            patients,
            healthDetails,
            schedule: {
                startDate: moment(schedule.startDate).startOf('day').toDate(),
                endDate: moment(schedule.endDate).endOf('day').toDate(),
                startTime: schedule.startTime,
                endTime: schedule.endTime,
                duration: schedule.duration
            },
            address,
            assessmentLocation,
            selectedConsumables: selectedConsumables || [], // SAVE ARRAY
            needConsumable: needConsumable || false,        // SAVE BOOLEAN
            totalPrice: priceBreakdown.totalPrice,
            status: 'Pending'
        });

        res.status(201).json({ success: true, data: booking });
    } catch (error) { 
        console.error("Controller Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
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