const Nurse = require('../../../models/Nurse');
const NurseBooking = require('../../../models/NurseBooking');
const NurseService = require('../../../models/NurseService');
const NursePackage = require('../../../models/NursePackage'); 
const Availability = require('../../../models/Availability');
const DeliveryCharge = require('../../../models/DeliveryCharge');
const { isNurseAvailable, generateNurseSlots } = require('../../../utils/timeSlotHelper');
const NurseConsumable = require('../../../models/MasterConsumable');
const Coupon = require('../../../models/Coupon');

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

// 1. GET COUPONS FOR A SPECIFIC NURSE
const getAvailableCoupons = async (req, res) => {
    try {
        const { nurseId } = req.params;

        const coupons = await Coupon.find({
            isActive: true,
            expiryDate: { $gte: new Date() },
            $or: [
                // 1. Admin ke global coupons (jo Nurse bureau ya sab ke liye hain)
                { isAdminCreated: true, vendorType: { $in: ['Nurse', 'All'] } },
                // 2. Is specific Nurse Bureau ke apne coupons
                { vendorId: nurseId }
            ]
        }).select('couponName discountPercentage maxDiscount minOrderAmount expiryDate description');

        res.json({ success: true, count: coupons.length, data: coupons });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
// 2. VALIDATE COUPON (Manual Check)
const validateCoupon = async (req, res) => {
    try {
        const { couponCode, nurseId, totalAmount } = req.body;
        const userId = req.user.id;

        if (!couponCode || !nurseId) {
            return res.status(400).json({ success: false, message: "Coupon code and Nurse ID are required" });
        }

        const coupon = await Coupon.findOne({
            couponName: couponCode.toUpperCase(),
            isActive: true,
            expiryDate: { $gte: new Date() },
            $or: [
                { isAdminCreated: true, vendorType: { $in: ['Nurse', 'All'] } },
                { vendorId: nurseId }
            ]
        });

        if (!coupon) {
            return res.status(404).json({ success: false, message: "Invalid or Expired Coupon Code" });
        }

        // Check 1: Minimum Order Amount
        if (totalAmount < coupon.minOrderAmount) {
            return res.status(400).json({ 
                success: false, 
                message: `Minimum order amount for this coupon is ₹${coupon.minOrderAmount}` 
            });
        }

        // Check 2: Max Usage per User
        const userUsage = coupon.usedBy.find(u => u.userId.toString() === userId.toString());
        const usageCount = userUsage ? userUsage.usageCount : 0;

        if (usageCount >= coupon.maxUsagePerUser) {
            return res.status(400).json({ 
                success: false, 
                message: "You have already reached the maximum usage limit for this coupon" 
            });
        }

        // Calculate Discount
        let discountAmount = (totalAmount * coupon.discountPercentage) / 100;
        if (discountAmount > coupon.maxDiscount) {
            discountAmount = coupon.maxDiscount;
        }

        res.json({
            success: true,
            message: "Coupon Applied Successfully!",
            data: {
                couponId: coupon._id,
                couponName: coupon.couponName,
                discountPercentage: coupon.discountPercentage,
                discountAmount: Math.round(discountAmount),
                finalPayable: Math.round(totalAmount - discountAmount)
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. CHECKOUT (The Revamped Pricing Engine)
const checkoutNurseBooking = async (req, res) => {
    try {
        const { 
            nurseId, serviceId, packageId, isPackage, selectedType, 
            startDate, endDate, startTime, endTime, isFasterService, 
            patientCount, selectedConsumables, couponCode 
        } = req.body;

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

        // --- TRIPLE PRICING LOGIC ---
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
        else {
            units = moment(endTime, "HH:mm").diff(moment(startTime, "HH:mm"), 'hours') || 1;
            basePrice = item.pricing.hourly.final * units;
            const pSlot = config.premiumSlots?.find(ps => ps.time === startTime);
            if (pSlot) slotSurcharge = pSlot.extraFee;
        }

        const consumableTotal = (selectedConsumables || []).reduce((acc, curr) => acc + (Number(curr.price) || 0), 0);
        
        // --- 🎫 COUPON LOGIC START ---
        let couponDiscount = 0;
        let couponInfo = null;

        // Subtotal jisme discount milega (Base + Surcharge + Consumables) * Patients
        const subTotalForCoupon = (basePrice + slotSurcharge + consumableTotal) * pCount;

        if (couponCode) {
            const coupon = await Coupon.findOne({
                couponName: couponCode.toUpperCase(),
                isActive: true,
                expiryDate: { $gte: new Date() },
                $or: [
                    { isAdminCreated: true, vendorType: { $in: ['Nurse', 'All'] } }, // Admin coupons
                    { vendorId: nurseId } // Vendor's own coupons
                ]
            });

            if (coupon) {
                // Check Min Order Amount
                if (subTotalForCoupon >= coupon.minOrderAmount) {
                    // Check Max Usage for this specific user
                    const userUsage = coupon.usedBy.find(u => u.userId.toString() === req.user.id.toString());
                    const usageCount = userUsage ? userUsage.usageCount : 0;

                    if (usageCount < coupon.maxUsagePerUser) {
                        let discount = (subTotalForCoupon * coupon.discountPercentage) / 100;
                        if (discount > coupon.maxDiscount) discount = coupon.maxDiscount;
                        
                        couponDiscount = Math.round(discount);
                        couponInfo = { couponId: coupon._id, couponName: coupon.couponName };
                    }
                }
            }
        }
        // --- 🎫 COUPON LOGIC END ---

        const fasterCharge = isFasterService ? (delivery?.fastDeliveryExtra || 0) : 0;
        const totalAfterDiscount = (subTotalForCoupon - couponDiscount) + fasterCharge;

        // Dynamic Tax
        let tax = 0;
        if (delivery?.taxPercentage) tax = (totalAfterDiscount * delivery.taxPercentage) / 100;
        if (delivery?.taxInRupees) tax += delivery.taxInRupees;

        res.json({
            success: true,
            breakdown: {
                baseServicePrice: Math.round(basePrice * pCount),
                slotSurcharge: Math.round(slotSurcharge * pCount),
                consumableTotal: Math.round(consumableTotal * pCount),
                couponDiscount: couponDiscount, // 👈 New Key
                fasterServiceCharge: fasterCharge,
                taxAmount: Math.round(tax),
                totalPrice: Math.round(totalAfterDiscount + tax),
                units,
                pCount,
                appliedCoupon: couponInfo
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 5. PLACE BOOKING (With Coupon Usage Tracking) ---
const placeNurseBooking = async (req, res) => {
    try {
        const { nurseId, serviceId, packageId, isPackage, schedule, priceBreakdown, patients, address, selectedConsumables, assessmentLocation, appliedCoupon } = req.body;
        
        const item = isPackage ? await NursePackage.findById(packageId) : await NurseService.findById(serviceId);
        const bId = `HKN-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        const booking = await NurseBooking.create({
            userId: req.user.id,
            nurseId,
            serviceId: isPackage ? null : serviceId,
            packageId: isPackage ? packageId : null,
            bookingId: bId,
            serviceDetails: {
                title: isPackage ? item.packageName : item.title,
                type: isPackage ? "Package Bundle" : item.type,
                duration: schedule.duration,
                basePrice: item.pricing.oneDay.final
            },
            priceBreakdown,
            appliedCoupon: appliedCoupon ? {
                couponId: appliedCoupon.couponId,
                discountAmount: priceBreakdown.couponDiscount,
                couponName: appliedCoupon.couponName
            } : null,
            patients,
            schedule,
            address,
            assessmentLocation,
            selectedConsumables,
            status: 'Pending'
        });

        // 🚀 UPDATE COUPON USAGE HISTORY
        if (appliedCoupon && appliedCoupon.couponId) {
            const coupon = await Coupon.findById(appliedCoupon.couponId);
            if (coupon) {
                const userIndex = coupon.usedBy.findIndex(u => u.userId.toString() === req.user.id.toString());
                if (userIndex > -1) {
                    coupon.usedBy[userIndex].usageCount += 1;
                } else {
                    coupon.usedBy.push({ userId: req.user.id, usageCount: 1 });
                }
                await coupon.save();
            }
        }

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

const getGlobalPackages = async (req, res) => {
    try {
        const { lat, lng, search } = req.body;

        if (!lat || !lng) {
            return res.status(400).json({ success: false, message: "Location (lat, lng) is required to find nearby packages" });
        }

        // AGGREGATION PIPELINE
        const packages = await Nurse.aggregate([
            {
                // STEP 1: Find nearby Nurses first
                $geoNear: {
                    near: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
                    distanceField: "distance", // Distance calculate karke is field mein dalega
                    spherical: true,
                    query: { profileStatus: 'Approved', isActive: true } // Sirf approved vendors
                }
            },
            {
                // STEP 2: Join with NursePackage collection
                $lookup: {
                    from: "nursepackages", // MongoDB collection name (usually plural)
                    localField: "_id",
                    foreignField: "nurseId",
                    as: "vendorPackages"
                }
            },
            {
                // STEP 3: Unwind packages so each package becomes a separate document
                $unwind: "$vendorPackages"
            },
            {
                // STEP 4: Filter only Approved and Active packages
                $match: {
                    "vendorPackages.status": "Approved",
                    "vendorPackages.isActive": true,
                    ...(search ? { "vendorPackages.packageName": new RegExp(search, 'i') } : {})
                }
            },
            {
                // STEP 5: Format the output
                $project: {
                    _id: "$vendorPackages._id",
                    packageName: "$vendorPackages.packageName",
                    description: "$vendorPackages.description",
                    pricing: "$vendorPackages.pricing",
                    photos: "$vendorPackages.photos",
                    includedServices: "$vendorPackages.includedServices",
                    vendorDetails: {
                        _id: "$_id",
                        name: "$name",
                        profileImage: "$profileImage",
                        rating: "$rating",
                        city: "$city",
                        distance: { $divide: ["$distance", 1000] } // Meters to KM
                    }
                }
            },
            {
                // STEP 6: Sort by distance (Geonear already does this, but keeping it explicit)
                $sort: { "vendorDetails.distance": 1 }
            }
        ]);

        res.json({
            success: true,
            count: packages.length,
            data: packages
        });

    } catch (error) {
        console.error("Global Package Error:", error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = { getNurses,getNurseDetails,searchNurses,checkoutNurseBooking, placeNurseBooking,checkRangeAvailability, getNurseAvailability,getMyNurseBookings, rateNurseService,
    getAppointmentStatus, 
    uploadBookingPrescription,getNurseDeliveryConfig, getGlobalPackages, getAvailableCoupons, validateCoupon };