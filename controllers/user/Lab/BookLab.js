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
const moment = require('moment');
const { generateTimeSlots } = require('../../../utils/timeSlotHelper');
const crypto = require('crypto');
const mongoose = require('mongoose');

// --- HELPER: Pricing Logic (Production Level) ---
const calculateBill = async (labId, items, patientsCount, collectionType, couponCode, isRapid) => {
    let itemTotal = 0;
    let itemDiscount = 0; // Lab side overall discount tracking

    // 1. Calculate Tests Total (Using LabTest.discountPrice)
    if (items.tests && items.tests.length > 0) {
        for (let t of items.tests) {
            const test = await LabTest.findById(t.testId);
            if (test) {
                // Item total is MRP, itemDiscount tracks what's saved
                itemTotal += test.discountPrice || test.amount;
            }
        }
    }

    // 2. Calculate Packages Total (Using LabPackage.offerPrice)
    if (items.packages && items.packages.length > 0) {
        for (let p of items.packages) {
            const pkg = await LabPackage.findById(p.packageId);
            if (pkg) {
                itemTotal += pkg.offerPrice || pkg.mrp;
            }
        }
    }

    // 3. Delivery / Home Visit Charges
    let homeVisitCharge = 0;
    let rapidCharge = 0;
    const charges = await DeliveryCharge.findOne({ vendorId: labId });
    
    if (collectionType === 'Home Collection' && charges) {
        homeVisitCharge = charges.fixedPrice || 0;
    }
    
    if (isRapid && charges) {
        // Rapid charge usually per patient (Tata 1mg logic)
        rapidCharge = (charges.fastDeliveryExtra || 0) * patientsCount;
    }

    // 4. Coupon Discount Logic
    let couponDiscount = 0;
    let couponId = null;
    if (couponCode) {
        const coupon = await Coupon.findOne({ couponName: couponCode.toUpperCase(), isActive: true });
        if (coupon && itemTotal >= coupon.minOrderAmount) {
            // Numeric percent calculation
            couponDiscount = Math.min((itemTotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
            couponId = coupon._id;
        }
    }

    const totalAmount = (itemTotal - couponDiscount) + homeVisitCharge + rapidCharge;

    return { 
        itemTotal, 
        itemDiscount, // Optional: tracking if needed
        couponDiscount, 
        couponId, 
        homeVisitCharge, 
        rapidDeliveryCharge: rapidCharge, 
        totalAmount 
    };
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
    getLabsByMasterTest, getLabsByMasterPackage,
    getMasterTestDetails, getMasterPackageDetails
};