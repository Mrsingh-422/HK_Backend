const Lab = require('../../../models/Lab');
const LabTest = require('../../../models/LabTest');
const LabPackage = require('../../../models/LabPackage');
const LabBooking = require('../../../models/LabBooking');
const Prescription = require('../../../models/Prescription');
const DeliveryCharge = require('../../../models/DeliveryCharge');
const Availability = require('../../../models/Availability');
const Coupon = require('../../../models/Coupon');
const MasterLabTest = require('../../../models/MasterLabTest');
const MasterLabPackage = require('../../../models/MasterLabPackage');

const Cart = require('../../../models/Cart'); // Import check karein
const User = require('../../../models/User');
const moment = require('moment');
const { generateTimeSlots } = require('../../../utils/timeSlotHelper');
const crypto = require('crypto');
const mongoose = require('mongoose');

// --- HELPER: Pricing Logic (Production Level) ---
const calculateBill = async (labId, items, patientsCount, collectionType, couponCode, isRapid, userId) => {
    let itemTotal = 0;
    
    // 1. Calculate Items Total
    for (let t of items.tests) {
        const test = await LabTest.findById(t.testId);
        if (test) itemTotal += test.discountPrice || test.amount;
    }
    for (let p of items.packages) {
        const pkg = await LabPackage.findById(p.packageId);
        if (pkg) itemTotal += pkg.offerPrice || pkg.mrp;
    }

    // 2. Delivery / Home Visit Charges
    let homeVisitCharge = 0;
    let rapidCharge = 0;
    const charges = await DeliveryCharge.findOne({ vendorId: labId });

    if (collectionType === 'Home Collection' && charges) {
        homeVisitCharge = charges.fixedPrice || 0;
    }
    if (isRapid && charges) {
        rapidCharge = (charges.fastDeliveryExtra || 0) * patientsCount;
    }

    // 3. Strict Coupon Logic
    let couponDiscount = 0;
    let couponId = null;
    if (couponCode) {
        const coupon = await Coupon.findOne({ couponName: couponCode.toUpperCase(), isActive: true });
        if (coupon) {
            // Check usage limit for THIS specific user
            const userUsage = coupon.usedBy.filter(u => u.userId.toString() === userId.toString()).length;
            if (itemTotal >= coupon.minOrderAmount && userUsage < coupon.maxUsagePerUser) {
                couponDiscount = Math.min((itemTotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
                couponId = coupon._id;
            }
        }
    }

    const totalAmount = (itemTotal - couponDiscount) + homeVisitCharge + rapidCharge;
    return { itemTotal, couponDiscount, couponId, homeVisitCharge, rapidDeliveryCharge: rapidCharge, totalAmount };
};
 

// 1. GET LABS LIST WITH FILTERS
const getLabs = async (req, res) => {
    try {
        const { city, isHomeCollection, isRapid, search } = req.query;
        let query = { profileStatus: 'Approved', isActive: true };
        
        if (city) query.city = new RegExp(city, 'i');
        if (isHomeCollection === 'true') query.isHomeCollectionAvailable = true;
        if (isRapid === 'true') query.isRapidServiceAvailable = true;
        if (search) query.name = new RegExp(search, 'i');
        
        const labs = await Lab.find(query).select('name city profileImage rating totalReviews isHomeCollectionAvailable isRapidServiceAvailable');
        res.json({ success: true, data: labs });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. GET LAB DETAILS (Updated with Deep Population)
// 2. GET LAB DETAILS (Lab-wise Inventory)
const getLabDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const [tests, packages, lab] = await Promise.all([
            // Tests with master details
            LabTest.find({ labId: id, isActive: true }).populate('masterTestId'),
            // Packages with nested test and their master details
            LabPackage.find({ labId: id, isActive: true }).populate({
                path: 'tests',
                model: 'MasterLabTest'
            }),
            Lab.findById(id)
        ]);
        
        if (!lab) return res.status(404).json({ success: false, message: "Lab not found" });
        
        res.json({ success: true, lab, tests, packages });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

// 3. GET AVAILABLE SLOTS
const getLabSlots = async (req, res) => {
    try {
        const { labId, date } = req.query;
        const config = await Availability.findOne({ vendorId: labId });
        if (!config) return res.status(404).json({ message: "Slots not configured by Lab" });

        const dayName = new Date(date).toLocaleString('en-us', { weekday: 'long' });
        if (config.offDays.includes(dayName)) {
            return res.json({ success: true, message: "Lab is closed on this day", slots: [] });
        }

        const slots = generateTimeSlots(config);
        res.json({ success: true, slots });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- INTERNAL HELPER: Delivery Calculation ---
const calculateDeliveryFee = (distance, orderTotal, charges) => {
    if (!charges) return 50; // Default fallback
    if (orderTotal >= charges.freeDeliveryThreshold) return 0;
    
    if (distance <= charges.fixedDistance) {
        return charges.fixedPrice;
    } else {
        const extraDistance = distance - charges.fixedDistance;
        return charges.fixedPrice + (extraDistance * charges.pricePerKM);
    }
};

// 1. GET AVAILABLE SLOTS (For User Slot Selection)
const getLabSlotsForUser = async (req, res) => {
    try {
        const { labId, date } = req.query; // date format: YYYY-MM-DD
        const config = await Availability.findOne({ vendorId: labId });
        
        if (!config) return res.status(404).json({ message: "Lab has not set availability yet." });

        // Off-day check
        const dayName = new Date(date).toLocaleString('en-us', { weekday: 'long' });
        if (config.offDays.includes(dayName)) {
            return res.json({ success: true, isClosed: true, slots: [] });
        }

        const allGeneratedSlots = generateTimeSlots(config);

        // Check availability per slot (Conflict logic)
        const bookedCounts = await LabBooking.aggregate([
            { $match: { labId: new mongoose.Types.ObjectId(labId), appointmentDate: new Date(date), status: { $ne: 'Cancelled' } } },
            { $group: { _id: "$appointmentTime", count: { $sum: 1 } } }
        ]);

        const finalSlots = allGeneratedSlots.map(slot => {
            const booking = bookedCounts.find(b => b._id === slot.time);
            const currentCount = booking ? booking.count : 0;
            return {
                ...slot,
                isFull: config.maxClientsPerSlot !== 0 && currentCount >= config.maxClientsPerSlot
            };
        });

        res.json({ success: true, isClosed: false, slots: finalSlots });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. GET AVAILABLE COUPONS (Admin Global + Specific Vendor)
const getAvailableCoupons = async (req, res) => {
    try {
        const { labId } = req.query;
        // Logic: Fetch all Admin coupons OR coupons created by this specific Lab
        const coupons = await Coupon.find({
            isActive: true,
            expiryDate: { $gte: new Date() },
            $or: [
                { vendorType: 'Admin' },
                { vendorId: labId }
            ]
        }).sort({ createdAt: -1 });

        res.json({ success: true, data: coupons });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. FINAL CHECKOUT (Integrating Delivery & Coupons)
const checkoutLabBooking = async (req, res) => {
    try {
        const { 
            appointmentDate, appointmentTime, address, paymentMethod, 
            couponCode, isRapid, selectedPatientIds, distanceInKm 
        } = req.body;

        const userId = req.user.id;
        const cart = await Cart.findOne({ userId });
        if (!cart || cart.labCart.items.length === 0) return res.status(400).json({ message: "Cart is empty" });

        const labId = cart.labCart.labId;

        // --- STEP A: Calculate Item Total ---
        let itemTotal = 0;
        cart.labCart.items.forEach(item => { itemTotal += item.price * item.quantity; });

        // --- STEP B: Delivery Charges ---
        const chargesConfig = await DeliveryCharge.findOne({ vendorId: labId });
        let deliveryFee = 0;
        if (req.body.collectionType === 'Home Collection') {
            deliveryFee = calculateDeliveryFee(distanceInKm || 0, itemTotal, chargesConfig);
        }

        // --- STEP C: Rapid Delivery ---
        let rapidCharge = 0;
        if (isRapid && chargesConfig) {
            rapidCharge = chargesConfig.fastDeliveryExtra * selectedPatientIds.length;
        }

        // --- STEP D: Coupon Validation ---
        let couponDiscount = 0;
        let couponId = null;
        if (couponCode) {
            const coupon = await Coupon.findOne({ couponName: couponCode.toUpperCase(), isActive: true });
            if (coupon) {
                const userUsage = coupon.usedBy.filter(u => u.userId.toString() === userId).length;
                if (itemTotal >= coupon.minOrderAmount && userUsage < coupon.maxUsagePerUser) {
                    couponDiscount = Math.min((itemTotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
                    couponId = coupon._id;
                }
            }
        }

        const totalAmount = (itemTotal - couponDiscount) + deliveryFee + rapidCharge;

        // Create Booking object
        const booking = await LabBooking.create({
            bookingId: `ORD-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
            userId,
            labId,
            patients: await mapPatients(userId, selectedPatientIds), // Helper to fetch patient data
            items: cart.labCart.items.map(i => ({ testId: i.itemId, price: i.price, name: i.name })),
            collectionType: req.body.collectionType,
            address,
            appointmentDate,
            appointmentTime,
            billSummary: {
                itemTotal,
                couponDiscount,
                homeVisitCharge: deliveryFee,
                rapidDeliveryCharge: rapidCharge,
                totalAmount
            },
            paymentMethod,
            status: paymentMethod === 'COD' ? 'Confirmed' : 'Pending'
        });

        // Clear Cart & Update Coupon usage
        await Cart.findOneAndUpdate({ userId }, { $set: { "labCart.items": [] } });
        if(couponId) await Coupon.findByIdAndUpdate(couponId, { $push: { usedBy: { userId } } });

        res.status(201).json({ success: true, data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Helper to map patient IDs to full objects
async function mapPatients(userId, pids) {
    const user = await User.findById(userId);
    return pids.map(id => {
        if (id === 'Self') return { name: user.name, age: user.age || 25, gender: user.gender || 'Male', relation: 'Self' };
        const m = user.familyMember.id(id);
        return { patientId: id, name: m.memberName, age: m.age, gender: m.gender, relation: m.relation };
    });
}

// 4. INITIATE BOOKING (Direct)
const bookLabTest = async (req, res) => {
    try {
        const { 
            labId, patients, items, collectionType, isRapid,
            appointmentDate, appointmentTime, address, couponCode, paymentMethod 
        } = req.body;

        // Generate Order ID
        const bookingId = `ORD-${Date.now().toString().slice(-6)}${crypto.randomInt(100, 999)}`;
        
        // Dynamic bill calculation based on new model fields
        const bill = await calculateBill(labId, items, patients.length, collectionType, couponCode, isRapid);

        const booking = await LabBooking.create({
            bookingId,
            userId: req.user.id,
            labId,
            patients, // Array of family members
            items: {
                tests: items.tests || [],
                packages: items.packages || []
            },
            collectionType,
            address,
            appointmentDate,
            appointmentTime,
            billSummary: bill,
            paymentMethod,
            status: paymentMethod === 'COD' ? 'Confirmed' : 'Pending',
            paymentStatus: 'Pending'
        });

        res.status(201).json({ success: true, data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 5. UPLOAD PRESCRIPTION FLOW (Figma logic)
const uploadPrescriptionFlow = async (req, res) => {
    try {
        const { labId, patients, collectionType, address } = req.body;
        if (!req.files || req.files.length === 0) return res.status(400).json({ message: "Please upload prescription image" });

        const images = req.files.map(f => f.path);
        
        // 1. Prescription metadata
        const presc = await Prescription.create({
            userId: req.user.id,
            prescriptionImages: images,
            isManualUpload: true
        });

        // 2. Booking in "Under Review" state
        const booking = await LabBooking.create({
            bookingId: `ORD-PR-${crypto.randomInt(1000, 9999)}`,
            userId: req.user.id,
            labId,
            patients,
            collectionType,
            address,
            prescriptionId: presc._id,
            bookingType: 'Prescription-Based',
            status: 'Under Review' 
        });

        res.json({ success: true, message: "Lab will review and suggest tests", bookingId: booking.bookingId });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 6. GET MY BOOKINGS
const getMyBookings = async (req, res) => {
    try {
        const { status } = req.query;
        let query = { userId: req.user.id };
        if (status) query.status = status;

        const bookings = await LabBooking.find(query)
            .populate('labId', 'name city profileImage')
            .sort({ createdAt: -1 });
            
        res.json({ success: true, data: bookings });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 7. GET BOOKING DETAILS (For Tracking Screen)
const getBookingDetails = async (req, res) => {
    try {
        const booking = await LabBooking.findById(req.params.id)
            .populate('labId')
            .populate('phlebotomistId')
            .populate('items.tests.testId')
            .populate('items.packages.packageId')
            .populate({
                path: 'items.tests.testId',
                populate: { path: 'masterTestId' } // Deeper population for parameters
            });

        if (!booking) return res.status(404).json({ message: "Booking not found" });
        res.json({ success: true, data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// 8. CANCEL BOOKING (User Side)
const cancelBooking = async (req, res) => {
    try {
        const { reason } = req.body;
        const booking = await LabBooking.findOne({ _id: req.params.id, userId: req.user.id });

        if (!booking) return res.status(404).json({ message: "Booking not found" });

        // Logic: Sirf 'Confirmed' ya 'Pending' status me hi cancel ho sakta hai
        const nonCancellable = ['Sample Collected', 'Testing', 'Report Generated', 'Completed'];
        if (nonCancellable.includes(booking.status)) {
            return res.status(400).json({ message: "Cannot cancel. Phlebotomist is already on the way or sample is in lab." });
        }

        booking.status = 'Cancelled';
        booking.cancelReason = reason;
        await booking.save();

        res.json({ success: true, message: "Booking cancelled successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 9. CONFIRM SUGGESTED TESTS (Prescription Flow - Figma Screen 67)
// Jab Lab tests add kar dega, tab user yahan se payment karke booking confirm karega
const confirmPrescriptionBooking = async (req, res) => {
    try {
        const { bookingId, appointmentDate, appointmentTime, address, paymentMethod, couponCode } = req.body;
        
        const booking = await LabBooking.findOne({ _id: bookingId, userId: req.user.id });
        if (!booking || booking.status !== 'Tests Added') {
            return res.status(400).json({ message: "Invalid booking or tests not yet added by Lab" });
        }

        // Recalculate bill based on tests added by Lab
        const bill = await calculateBill(
            booking.labId, 
            booking.items, 
            booking.patients.length, 
            booking.collectionType, 
            couponCode, 
            false // rapid is usually decided earlier
        );

        booking.appointmentDate = appointmentDate;
        booking.appointmentTime = appointmentTime;
        booking.address = address;
        booking.billSummary = bill;
        booking.paymentMethod = paymentMethod;
        booking.status = 'Confirmed';
        booking.paymentStatus = paymentMethod === 'COD' ? 'Pending' : 'Done';
        
        await booking.save();
        res.json({ success: true, message: "Booking confirmed!", data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 10. ADD RATING & REVIEW
const rateLabOrder = async (req, res) => {
    try {
        const { bookingId, rating, comment } = req.body;
        const booking = await LabBooking.findById(bookingId);

        if (!booking || booking.status !== 'Completed') {
            return res.status(400).json({ message: "You can only rate completed orders" });
        }

        // Update Lab model's average rating logic here
        const lab = await Lab.findById(booking.labId);
        const totalReviews = lab.totalReviews + 1;
        const newRating = ((lab.rating * lab.totalReviews) + rating) / totalReviews;

        await Lab.findByIdAndUpdate(booking.labId, {
            rating: newRating.toFixed(1),
            totalReviews: totalReviews
        });

        res.json({ success: true, message: "Thank you for your feedback!" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};





// NAYA: Kisi specific Master Test ko kaun-kaun si Labs provide kar rahi hain?
const getLabsByMasterTest = async (req, res) => {
    try {
        const { masterTestId } = req.params;
        // Un saari Labs ko dhundo jinhone ye test list kiya hai
        const labsOfferingTest = await LabTest.find({ masterTestId, isActive: true })
            .populate('labId', 'name profileImage rating totalReviews address city')
            .sort({ discountPrice: 1 }); // Sasta wala pehle

        res.json({ success: true, data: labsOfferingTest });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// NAYA: Kisi specific Master Package ko kaun-kaun si Labs provide kar rahi hain?
const getLabsByMasterPackage = async (req, res) => {
    try {
        const { masterPackageId } = req.params;
        let query = { isActive: true };

        // Check if ID or Name
        if (mongoose.Types.ObjectId.isValid(masterPackageId)) {
            query.masterPackageId = masterPackageId;
        } else {
            // Agar Name hai tohpackageName se dhundo
            query.packageName = masterPackageId; 
        }

        const labsOfferingPackage = await LabPackage.find(query)
            .populate('labId', 'name profileImage rating totalReviews address city')
            .sort({ offerPrice: 1 });

        res.json({ success: true, data: labsOfferingPackage });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// NEW: Get Master Test Details for User
const getMasterTestDetails = async (req, res) => {
    try {
        const data = await MasterLabTest.findById(req.params.id); // params.id match route
        if (!data) return res.status(404).json({ success: false, message: "Test not found" });
        res.json({ success: true, data });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

// NEW: Get Master Package Details for User
const getMasterPackageDetails = async (req, res) => {
    try {
        const { id } = req.params; // Yeh ID bhi ho sakti hai ya Name bhi
        let data;

        // 1. Check karein ki kya 'id' ek valid MongoDB ObjectId hai?
        const isValidId = mongoose.Types.ObjectId.isValid(id);

        if (isValidId) {
            // A. Agar ID hai, toh pehle Master Templates mein dhundo
            data = await MasterLabPackage.findById(id).populate('tests');

            // B. Agar master mein nahi mila, toh LabPackage (Vendor listing) mein dhundo
            if (!data) {
                data = await LabPackage.findById(id).populate({
                    path: 'tests',
                    model: 'MasterLabTest'
                });
            }
        } else {
            // 2. Agar ID nahi hai (Matlab yeh Name string hai), toh LabPackage mein Name se dhundo
            // Hum .findOne use karenge kyunki humein sirf package ka structure (tests/description) chahiye
            data = await LabPackage.findOne({ packageName: id }).populate({
                path: 'tests',
                model: 'MasterLabTest'
            });
        }

        if (!data) {
            return res.status(404).json({ success: false, message: "Package information not found" });
        }

        res.json({ success: true, data });
    } catch (error) {
        // CastError ya koi aur error handle karne ke liye
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { 
    getLabs, getLabDetails, getLabSlots, 
    bookLabTest, uploadPrescriptionFlow, 
    getMyBookings, getBookingDetails ,
    checkoutLabBooking,
    getLabsByMasterTest, getLabsByMasterPackage,
    getMasterTestDetails, getMasterPackageDetails,
    cancelBooking, confirmPrescriptionBooking, rateLabOrder ,
    getAvailableCoupons, getLabSlots
};