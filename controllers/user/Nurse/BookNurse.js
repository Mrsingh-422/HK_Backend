const Nurse = require('../../../models/Nurse');
const NurseBooking = require('../../../models/NurseBooking');
const NurseService = require('../../../models/NurseService');
const NursePackage = require('../../../models/NursePackage'); 
const Availability = require('../../../models/Availability');
const DeliveryCharge = require('../../../models/DeliveryCharge');
const { isNurseAvailable, generateNurseSlots } = require('../../../utils/timeSlotHelper');
const NurseConsumable = require('../../../models/MasterConsumable');

// const { generateNurseSlots } = require('../../../utils/timeSlotHelper');
const moment = require('moment');
const crypto = require('crypto');

// 1. LIST NURSES
const getNurses = async (req, res) => {
    try {
        const { city, search, speciality } = req.body;
        
        let query = { profileStatus: 'Approved', isActive: true };
        
        // Filter logic
        if (city) query.city = new RegExp(city, 'i');
        if (search) query.name = new RegExp(search, 'i');
        if (speciality) query.speciality = speciality;

        // 1. Pehle Approved Nurses dhoondo
        const nurses = await Nurse.find(query).lean();
        console.log(`Found ${nurses.length} approved nurses in DB`);

        const data = [];

        for (let nurse of nurses) {
            // 2. Nurse ki services check karo
            const services = await NurseService.find({ nurseId: nurse._id });
            console.log(`Nurse ${nurse.name} has ${services.length} services`);

            let minPrice = 0;
            let serviceTitles = [];

            if (services.length > 0) {
                // Naya Pricing Logic Check (Final Price)
                const validPrices = services
                    .map(s => (s.pricing && s.pricing.oneDay ? s.pricing.oneDay.final : 0))
                    .filter(p => p > 0);
                
                minPrice = validPrices.length > 0 ? Math.min(...validPrices) : 0;
                serviceTitles = services.slice(0, 2).map(s => s.title);
            }

            // Data push (Service ho ya na ho, Nurse list mein aayegi)
            data.push({
                _id: nurse._id,
                name: nurse.name,
                profileImage: nurse.profileImage,
                rating: nurse.rating || 0,
                city: nurse.city,
                experienceYears: nurse.experienceYears || 0,
                startingPrice: minPrice || 0, 
                topServices: serviceTitles,
                location: nurse.location,
                profileStatus: nurse.profileStatus
            });
        }
        
        res.json({ success: true, count: data.length, data });

    } catch (error) { 
        console.error("getNurses Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

const getNurseDetails = async (req, res) => {
    try {
        const nurseId = req.params.id;
        if (!nurseId) return res.status(400).json({ message: "Nurse ID required" });

        const nurse = await Nurse.findById(nurseId).lean();
        if (!nurse) return res.status(404).json({ message: "Nurse not found" });

        // Parallel fetching for performance
        const [services, packages, config] = await Promise.all([
            NurseService.find({ nurseId, status: 'Approved' })
                .populate('consumablesUsed.masterItemId')
                .lean(),
            NursePackage.find({ nurseId, status: 'Approved' })
                .populate('includedServices')
                .populate('consumablesUsed.masterItemId')
                .lean(),
            Availability.findOne({ vendorId: nurseId }).lean()
        ]);

        res.json({ 
            success: true, 
            data: { 
                ...nurse, 
                services: services || [], 
                packages: packages || [], 
                availability: config || null 
            } 
        });
    } catch (e) { 
        console.error("Critical Details Error:", e);
        res.status(500).json({ success: false, message: "Server encountered an error loading details" }); 
    }
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
        const { serviceId, packageId, isPackage, type } = req.query;

        const [config, item] = await Promise.all([
            Availability.findOne({ vendorId: nurseId }),
            isPackage === 'true' ? NursePackage.findById(packageId) : NurseService.findById(serviceId)
        ]);

        if (!config || !item) return res.status(404).json({ message: "Config or Item missing" });

        // Triple Pricing Logic (Dono models mein key same hai: pricing.oneDay.final)
        let base = item.pricing.oneDay.final;
        if(type === 'Acc. To Per/Hours') base = item.pricing.hourly.final;

        res.json({
            success: true,
            serviceBasePrice: base,
            premiumDates: config.premiumDates, 
            timeSlots: generateNurseSlots(config, type, base) 
        });
    } catch (e) { res.status(500).json({ message: e.message }); }
};

// 4. CHECKOUT (The Revamped Pricing Engine)
const checkoutNurseBooking = async (req, res) => {
    try {
        const { 
            nurseId, serviceId, packageId, isPackage, selectedType, 
            startDate, endDate, startTime, endTime, isFasterService, 
            patientCount, selectedConsumables 
        } = req.body;

        // 1. Fetch correct booking item (Service or Package)
        const [item, config, delivery] = await Promise.all([
            isPackage ? NursePackage.findById(packageId) : NurseService.findById(serviceId),
            Availability.findOne({ vendorId: nurseId }),
            DeliveryCharge.findOne({ vendorId: nurseId })
        ]);

        if (!item) return res.status(404).json({ message: "Service/Package not found" });
        const pCount = Number(patientCount) || 1;

        let basePrice = 0;
        let slotSurcharge = 0;
        let units = 1;

        // 2. Triple Pricing Logic (Universal for Service & Package)
        if (selectedType === 'For Multiple Days') {
            units = moment(endDate).diff(moment(startDate), 'days') + 1;
            basePrice = item.pricing.multipleDays.final * units;
            
            let curr = moment(startDate);
            while (curr <= moment(endDate)) {
                const p = config.premiumDates?.find(pd => pd.date === curr.format('YYYY-MM-DD'));
                if (p) slotSurcharge += p.extraFee;
                curr.add(1, 'days');
            }
        } 
        else if (selectedType === 'One day One Time') {
            basePrice = item.pricing.oneDay.final;
            const pDate = config.premiumDates?.find(pd => pd.date === moment(startDate).format('YYYY-MM-DD'));
            if (pDate) slotSurcharge += pDate.extraFee;
            
            const pSlot = config.premiumSlots?.find(ps => ps.time === startTime);
            if (pSlot) slotSurcharge += pSlot.extraFee;
        } 
        else if (selectedType === 'Acc. To Per/Hours') {
            units = moment(endTime, "HH:mm").diff(moment(startTime, "HH:mm"), 'hours') || 1;
            basePrice = item.pricing.hourly.final * units;
            const pSlot = config.premiumSlots?.find(ps => ps.time === startTime);
            if (pSlot) slotSurcharge = pSlot.extraFee;
        }

        // 3. Add-ons & Surcharges
        const consumableTotal = (selectedConsumables || []).reduce((acc, curr) => acc + (Number(curr.price) || 0), 0);
        const subTotal = (basePrice + slotSurcharge + consumableTotal) * pCount;
        const fasterCharge = isFasterService ? (delivery?.fastDeliveryExtra || 0) : 0;
        const totalBeforeTax = subTotal + fasterCharge;

        // 4. Dynamic Tax
        let tax = 0;
        if (delivery?.taxPercentage) tax = (totalBeforeTax * delivery.taxPercentage) / 100;
        if (delivery?.taxInRupees) tax += delivery.taxInRupees;

        res.json({
            success: true,
            breakdown: {
                baseServicePrice: Math.round(basePrice * pCount),
                slotSurcharge: Math.round(slotSurcharge * pCount),
                consumableTotal: Math.round(consumableTotal * pCount),
                fasterServiceCharge: fasterCharge,
                taxAmount: Math.round(tax),
                totalPrice: Math.round(totalBeforeTax + tax),
                units,
                pCount
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- PLACE BOOKING ---
const placeNurseBooking = async (req, res) => {
    try {
        const { 
            nurseId, serviceId, packageId, isPackage, schedule, 
            priceBreakdown, patients, healthDetails, address, 
            selectedConsumables, assessmentLocation 
        } = req.body;

        // Fetch Individual Price Snapshot
        const item = isPackage ? await NursePackage.findById(packageId) : await NurseService.findById(serviceId);
        
        const bId = `HKN-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        const booking = await NurseBooking.create({
            userId: req.user.id,
            nurseId,
            serviceId: isPackage ? null : serviceId, // Link service if not package
            packageId: isPackage ? packageId : null, // Link package if selected
            bookingId: bId,
            serviceDetails: {
                title: isPackage ? item.packageName : item.title,
                type: isPackage ? "Package Bundle" : item.type,
                duration: schedule.duration,
                basePrice: item.pricing.oneDay.final // Individual snapshot
            },
            priceBreakdown: {
                baseServicePrice: priceBreakdown.baseServicePrice,
                slotSurcharge: priceBreakdown.slotSurcharge,
                consumableTotal: priceBreakdown.consumableTotal,
                fasterServiceCharge: priceBreakdown.fasterServiceCharge,
                taxAmount: priceBreakdown.taxAmount,
                totalPrice: priceBreakdown.totalPrice
            },
            patients,
            schedule,
            address,
            assessmentLocation,
            selectedConsumables: (selectedConsumables || []).map(c => ({
                consumableId: c.consumableId,
                itemName: c.itemName,
                price: c.price,
                unitType: c.unitType
            })),
            needConsumable: selectedConsumables && selectedConsumables.length > 0,
            healthDetails,
            status: 'Pending'
        });

        res.status(201).json({ success: true, message: "Booking Success", data: booking });
    } catch (error) { 
        console.error("Booking Error:", error);
        res.status(500).json({ message: error.message }); 
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