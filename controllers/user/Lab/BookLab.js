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
// --- UPDATED HELPER: Pricing Logic with Slot Charges ---
// --- UPDATED HELPER: Bill Calculation with Slot Premium ---
const calculateBill = async (labId, items, patientsCount, collectionType, couponCode, isRapid, userId, appointmentTime) => {
    let itemTotal = 0;

    // Cart se aa raha hai toh items.items hoga, Direct booking hai toh items.tests/packages hoga
    const tests = items.items ? items.items.filter(i => i.productType === 'LabTest') : (items.tests || []);
    const packages = items.items ? items.items.filter(i => i.productType === 'LabPackage') : (items.packages || []);

    // 1. Calculate Tests Total
    for (let t of tests) {
        // Cart mein 'itemId' hota hai, Direct booking mein 'testId'
        const id = t.itemId || t.testId;
        const test = await LabTest.findById(id);
        if (test) itemTotal += test.discountPrice || test.amount;
    }

    // 2. Calculate Packages Total
    for (let p of packages) {
        const id = p.itemId || p.packageId;
        const pkg = await LabPackage.findById(id);
        if (pkg) itemTotal += pkg.offerPrice || pkg.mrp;
    }

    // Multiply items by patient count
    itemTotal = itemTotal * patientsCount;

    // ... baaki logic (Delivery, Slot Charge, Coupon) same rahega ...
    let homeVisitCharge = 0;
    let rapidCharge = 0;
    const charges = await DeliveryCharge.findOne({ vendorId: labId });
    if (collectionType === 'Home Collection' && charges) homeVisitCharge = charges.fixedPrice || 0;
    if (isRapid && charges) rapidCharge = (charges.fastDeliveryExtra || 0) * patientsCount;

    let slotCharge = 0;
    const availConfig = await Availability.findOne({ vendorId: labId });
    if (availConfig && appointmentTime) {
        const premium = availConfig.premiumSlots.find(ps => ps.time === appointmentTime);
        if (premium) slotCharge = premium.extraFee || 0;
    }

    let couponDiscount = 0;
    let couponId = null;
    if (couponCode) {
        const coupon = await Coupon.findOne({ couponName: couponCode.toUpperCase(), isActive: true });
        if (coupon && itemTotal >= coupon.minOrderAmount) {
            couponDiscount = Math.min((itemTotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
            couponId = coupon._id;
        }
    }

    const totalAmount = (itemTotal - couponDiscount) + homeVisitCharge + rapidCharge + slotCharge;
    return { itemTotal, couponDiscount, couponId, homeVisitCharge, rapidDeliveryCharge: rapidCharge, slotCharge, totalAmount };
};


 // 1. NEW: Get Delivery Charges for Lab in User Cart
const getLabDeliveryCharges = async (req, res) => {
    try {
        const cart = await Cart.findOne({ userId: req.user.id });
        if (!cart || !cart.labCart.labId) {
            return res.status(400).json({ success: false, message: "No lab selected in cart" });
        }

        const labId = cart.labCart.labId;

        // Vendor specific charges fetch karein
        let charges = await DeliveryCharge.findOne({ vendorId: labId });

        // Agar vendor ne set nahi kiya, toh standard defaults return karein
        if (!charges) {
            return res.json({ 
                success: true, 
                isDefault: true,
                data: { fixedPrice: 50, fixedDistance: 5, pricePerKM: 10, fastDeliveryExtra: 100 } 
            });
        }
        
        res.json({ success: true, data: charges, isDefault: false });
    } catch (error) { res.status(500).json({ message: error.message }); }
};





// GET /user/labs/standard-tests?mainCategory=Pathology&search=Sugar
const getStandardCatalogTests = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const { search, mainCategory } = req.query;

        let matchQuery = { isActive: true };
        if (mainCategory) matchQuery.mainCategory = mainCategory;
        if (search) matchQuery.testName = new RegExp(search, 'i');

        const aggregate = MasterLabTest.aggregate([
            { $match: matchQuery },
            {
                $lookup: {
                    from: "labtests", // DB collection name
                    localField: "_id",
                    foreignField: "masterTestId",
                    as: "vendorList",
                    pipeline: [{ $match: { isActive: true } }]
                }
            },
            {
                $addFields: {
                    vendorCount: { $size: "$vendorList" },
                    minPrice: { $min: "$vendorList.discountPrice" }
                }
            },
            { $sort: { vendorCount: -1, testName: 1 } },
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [{ $skip: skip }, { $limit: limit }]
                }
            }
        ]);

        const result = await aggregate;
        const total = result[0].metadata[0]?.total || 0;

        res.json({
            success: true,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            data: result[0].data
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// 1. SEARCH STANDARD TESTS (POST - Master Catalog)
const searchStandardTests = async (req, res) => {
    try {
        const { query, mainCategory } = req.body; // Search string aur Category body se
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;

        let matchQuery = { isActive: true };
        if (mainCategory) matchQuery.mainCategory = mainCategory;
        if (query) matchQuery.testName = new RegExp(query, 'i');

        const aggregate = MasterLabTest.aggregate([
            { $match: matchQuery },
            {
                $lookup: {
                    from: "labtests", // Lab specific prices check karne ke liye
                    localField: "_id",
                    foreignField: "masterTestId",
                    as: "vendorList",
                    pipeline: [{ $match: { isActive: true } }]
                }
            },
            {
                $addFields: {
                    vendorCount: { $size: "$vendorList" },
                    minPrice: { $min: "$vendorList.discountPrice" }
                }
            },
            { $sort: { vendorCount: -1, testName: 1 } }, // Popularity (vendor count) ke hisab se sort
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [{ $skip: skip }, { $limit: limit }]
                }
            }
        ]);

        const result = await aggregate;
        const total = result[0].metadata[0]?.total || 0;

        res.json({
            success: true,
            total,
            page,
            pages: Math.ceil(total / limit),
            data: result[0].data
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// --- NEW: GET STANDARD CATALOG PACKAGES (For User Discovery) ---
// GET /user/labs/standard-packages?category=Full Body Checkup
const getStandardPackages = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const { search, category } = req.query;

        let matchQuery = { isActive: true };
        if (search) matchQuery.packageName = new RegExp(search, 'i');
        if (category) matchQuery.category = category;

        const aggregate = MasterLabPackage.aggregate([
            { $match: matchQuery },
            {
                $lookup: {
                    from: "labpackages",
                    localField: "_id",
                    foreignField: "masterPackageId",
                    as: "vendorList",
                    pipeline: [{ $match: { isActive: true } }]
                }
            },
            {
                $addFields: {
                    vendorCount: { $size: "$vendorList" },
                    minPrice: { $min: "$vendorList.offerPrice" }
                }
            },
            { $sort: { vendorCount: -1, packageName: 1 } },
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [{ $skip: skip }, { $limit: limit }]
                }
            }
        ]);

        const result = await aggregate;
        const total = result[0].metadata[0]?.total || 0;

        res.json({
            success: true,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            data: result[0].data
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// 2. SEARCH STANDARD PACKAGES (POST - Master Catalog)
const searchStandardPackages = async (req, res) => {
    try {
        const { query, category } = req.body;
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;

        let matchQuery = { isActive: true };
        if (query) matchQuery.packageName = new RegExp(query, 'i');
        if (category) matchQuery.category = category;

        const aggregate = MasterLabPackage.aggregate([
            { $match: matchQuery },
            {
                $lookup: {
                    from: "labpackages",
                    localField: "_id",
                    foreignField: "masterPackageId",
                    as: "vendorList",
                    pipeline: [{ $match: { isActive: true } }]
                }
            },
            {
                $addFields: {
                    vendorCount: { $size: "$vendorList" },
                    minPrice: { $min: "$vendorList.offerPrice" }
                }
            },
            { $sort: { vendorCount: -1, packageName: 1 } },
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [{ $skip: skip }, { $limit: limit }]
                }
            }
        ]);

        const result = await aggregate;
        const total = result[0].metadata[0]?.total || 0;

        res.json({
            success: true,
            total,
            page,
            pages: Math.ceil(total / limit),
            data: result[0].data
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// GET STANDARD PACKAGES FOR FEMALE
// Endpoint: GET /user/labs/standard-packages/female?page=1
const getFemaleStandardPackages = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;
        const { search } = req.query; // Optional Search

        // FILTER LOGIC: Gender should be 'Female' OR 'Both'
        let matchQuery = { 
            isActive: true, 
            gender: { $in: ['Female'] } 
        };

        if (search) matchQuery.packageName = new RegExp(search, 'i');

        const aggregate = MasterLabPackage.aggregate([
            { $match: matchQuery },
            {
                $lookup: {
                    from: "labpackages", // Check availability in labs
                    localField: "_id",
                    foreignField: "masterPackageId",
                    as: "vendorList",
                    pipeline: [{ $match: { isActive: true } }]
                }
            },
            {
                $addFields: {
                    vendorCount: { $size: "$vendorList" },
                    minPrice: { $min: "$vendorList.offerPrice" }
                }
            },
            { $sort: { gender: 1, vendorCount: -1 } }, // 'Female' specific ones can come first
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [{ $skip: skip }, { $limit: limit }]
                }
            }
        ]);

        const result = await aggregate;
        const total = result[0].metadata[0]?.total || 0;

        res.json({
            success: true,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            data: result[0].data
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
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

// 1. GET LAB PROFILE (Sirf Lab ki basic info)
const getLabDetails = async (req, res) => {
    try {
        const lab = await Lab.findById(req.params.id)
            .select('name city address profileImage rating totalReviews isHomeCollectionAvailable isRapidServiceAvailable about');
        
        if (!lab) return res.status(404).json({ success: false, message: "Lab not found" });
        res.json({ success: true, data: lab });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. GET LAB TESTS (Paginated - 20 per page)
const getLabInventoryTests = async (req, res) => {
    try {
        const { labId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;

        const total = await LabTest.countDocuments({ labId, isActive: true });
        const tests = await LabTest.find({ labId, isActive: true })
            .populate('masterTestId')
            .sort({ testName: 1 })
            .skip(skip)
            .limit(limit);

        res.json({
            success: true,
            total,
            page,
            pages: Math.ceil(total / limit),
            data: tests
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. SEARCH LAB TESTS (POST API - Paginated)
const searchLabInventoryTests = async (req, res) => {
    try {
        const { labId } = req.params;
        const { query } = req.body;
        const page = parseInt(req.query.page) || 1;
        const limit = 20;

        const searchCriteria = {
            labId,
            isActive: true,
            testName: { $regex: query, $options: 'i' }
        };

        const total = await LabTest.countDocuments(searchCriteria);
        const tests = await LabTest.find(searchCriteria)
            .populate('masterTestId')
            .limit(limit)
            .skip((page - 1) * limit);

        res.json({ success: true, total, data: tests });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. GET LAB PACKAGES (Paginated - 20 per page)
const getLabInventoryPackages = async (req, res) => {
    try {
        const { labId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = 20;

        const total = await LabPackage.countDocuments({ labId, isActive: true });
        const packages = await LabPackage.find({ labId, isActive: true })
            .populate({ path: 'tests', model: 'MasterLabTest' })
            .skip((page - 1) * limit)
            .limit(limit);

        res.json({ success: true, total, page, pages: Math.ceil(total / limit), data: packages });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 5. SEARCH LAB PACKAGES (POST API - Paginated)
const searchLabInventoryPackages = async (req, res) => {
    try {
        const { labId } = req.params;
        const { query } = req.body;
        
        const searchCriteria = {
            labId,
            isActive: true,
            packageName: { $regex: query, $options: 'i' }
        };

        const packages = await LabPackage.find(searchCriteria)
            .populate({ path: 'tests', model: 'MasterLabTest' })
            .limit(20);

        res.json({ success: true, count: packages.length, data: packages });
    } catch (error) { res.status(500).json({ message: error.message }); }
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
// 1. GET AVAILABLE SLOTS (Ab price ke saath aayenge)
const getLabSlotsForUser = async (req, res) => {
    try {
        const { labId, date } = req.query;
        const config = await Availability.findOne({ vendorId: labId });
        if (!config) return res.status(404).json({ message: "Availability not set" });

        const dayName = new Date(date).toLocaleString('en-us', { weekday: 'long' });
        if (config.offDays.includes(dayName)) return res.json({ success: true, isClosed: true, slots: [] });

        const allGeneratedSlots = generateTimeSlots(config);

        const bookedCounts = await LabBooking.aggregate([
            { $match: { labId: new mongoose.Types.ObjectId(labId), appointmentDate: new Date(date), status: { $ne: 'Cancelled' } } },
            { $group: { _id: "$appointmentTime", count: { $sum: 1 } } }
        ]);

        const finalSlots = allGeneratedSlots.map(slot => {
            const booking = bookedCounts.find(b => b._id === slot.time);
            return {
                ...slot, // Isme ab 'extraFee' automatic aa raha hai helper se
                isFull: config.maxClientsPerSlot !== 0 && (booking ? booking.count : 0) >= config.maxClientsPerSlot
            };
        });

        res.json({ success: true, slots: finalSlots });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. GET AVAILABLE COUPONS (Admin Global + Specific Vendor)
const getAvailableCoupons = async (req, res) => {
    try {
        // 1. User ki cart find karein
        const cart = await Cart.findOne({ userId: req.user.id });
        
        if (!cart || !cart.labCart || !cart.labCart.labId) {
            return res.status(400).json({ success: false, message: "No lab in cart" });
        }

        const labId = cart.labCart.labId;
        const today = new Date();

        // 2. Coupons search karein
        const list = await Coupon.find({ 
            isActive: true,
            // Expiry date aaj se badi ya barabar honi chahiye
            expiryDate: { $gte: today }, 
            $or: [
                // CASE 1: Us specific Lab ka apna coupon
                { vendorId: labId }, 
                
                // CASE 2: Admin ka banaya Global coupon jo 'Lab' ke liye hai
                { 
                    isAdminCreated: true, 
                    vendorType: 'Lab', // Make sure 'Lab' matches Schema Enum exactly
                    vendorId: null 
                }
            ]
        }).sort({ createdAt: -1 });

        // DEBUGGING: Agar coupons nahi aa rahe toh console check karein
        console.log("Searching coupons for LabId:", labId);
        console.log("Found Coupons Count:", list.length);

        res.json({ success: true, count: list.length, data: list });
    } catch (error) { 
        console.error("Coupon Error:", error);
        res.status(500).json({ message: error.message }); 
    }
};


// 3. FINAL CHECKOUT (Integrating Delivery & Coupons)
// 2. CHECKOUT (Integrating Slot Charge)
const checkoutLabBooking = async (req, res) => {
    try {
        const { appointmentDate, appointmentTime, address, paymentMethod, couponCode, isRapid, selectedPatientIds, collectionType } = req.body;
        const userId = req.user.id;

        const cart = await Cart.findOne({ userId });
        if (!cart || cart.labCart.items.length === 0) return res.status(400).json({ message: "Cart is empty" });

        // Bill calculation (Now includes appointmentTime for slot pricing)
        const bill = await calculateBill(
            cart.labCart.labId, 
            cart.labCart, 
            selectedPatientIds.length, 
            collectionType, 
            couponCode, 
            isRapid, 
            userId,
            appointmentTime 
        );

        const booking = await LabBooking.create({
            bookingId: `ORD-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
            userId,
            labId: cart.labCart.labId,
            patients: await mapPatients(userId, selectedPatientIds),
            items: {
                tests: cart.labCart.items.filter(i => i.productType === 'LabTest').map(i => ({ testId: i.itemId, price: i.price, name: i.name })),
                packages: cart.labCart.items.filter(i => i.productType === 'LabPackage').map(i => ({ packageId: i.itemId, price: i.price, name: i.name }))
            },
            collectionType, address, appointmentDate, appointmentTime,
            billSummary: {
                ...bill,
                slotCharge: bill.slotCharge // Ensure slotCharge is stored
            },
            paymentMethod,
            status: 'Confirmed'
        });

        await Cart.findOneAndUpdate({ userId }, { $set: { "labCart.items": [], "labCart.labId": null, "labCart.categoryType": null } });
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
        getStandardCatalogTests,searchStandardTests, getStandardPackages, searchStandardPackages,getFemaleStandardPackages,
    getLabs, getLabDetails,getLabInventoryTests,searchLabInventoryTests,getLabInventoryPackages,searchLabInventoryPackages,
    
    getLabSlots, getLabDeliveryCharges,
    bookLabTest, uploadPrescriptionFlow, 
    getMyBookings, getBookingDetails ,
    checkoutLabBooking,
    getLabsByMasterTest, getLabsByMasterPackage,
    getMasterTestDetails, getMasterPackageDetails,
    cancelBooking, confirmPrescriptionBooking, rateLabOrder ,
    getAvailableCoupons, getLabSlots
};