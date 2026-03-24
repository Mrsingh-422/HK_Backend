const Lab = require('../../../models/Lab');
const LabTest = require('../../../models/LabTest');
const LabPackage = require('../../../models/LabPackage');
const LabBooking = require('../../../models/LabBooking');
const Prescription = require('../../../models/Prescription');
const DeliveryCharge = require('../../../models/DeliveryCharge');
const Availability = require('../../../models/Availability');
const Coupon = require('../../../models/Coupon');
const { generateTimeSlots } = require('../../../utils/timeSlotHelper');
const crypto = require('crypto');

// --- HELPER: Pricing Logic ---
const calculateBill = async (labId, items, patientsCount, collectionType, couponCode, isRapid) => {
    let itemTotal = 0;
    // 1. Calculate Items Total (Tests + Packages)
    for (let t of items.tests) {
        const test = await LabTest.findById(t.testId);
        if (test) itemTotal += test.offerPrice || test.mrp;
    }
    for (let p of items.packages) {
        const pkg = await LabPackage.findById(p.packageId);
        if (pkg) itemTotal += pkg.offerPrice || pkg.mrp;
    }

    // 2. Delivery/Home Visit Charges
    let homeVisitCharge = 0;
    let rapidCharge = 0;
    const charges = await DeliveryCharge.findOne({ vendorId: labId });
    
    if (collectionType === 'Home Collection' && charges) {
        homeVisitCharge = charges.fixedPrice;
    }
    
    if (isRapid && charges) {
        rapidCharge = charges.fastDeliveryExtra * patientsCount;
    }

    // 3. Coupon Discount
    let couponDiscount = 0;
    let couponId = null;
    if (couponCode) {
        const coupon = await Coupon.findOne({ couponName: couponCode.toUpperCase(), isActive: true });
        if (coupon && itemTotal >= coupon.minOrderAmount) {
            couponDiscount = Math.min((itemTotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
            couponId = coupon._id;
        }
    }

    const totalAmount = (itemTotal - couponDiscount) + homeVisitCharge + rapidCharge;
    return { itemTotal, couponDiscount, couponId, homeVisitCharge, rapidDeliveryCharge: rapidCharge, totalAmount };
};

// 1. GET LABS LIST WITH FILTERS
const getLabs = async (req, res) => {
    try {
        const { city, isHomeCollection, isRapid } = req.query;
        let query = { profileStatus: 'Approved', isActive: true };
        if (city) query.city = new RegExp(city, 'i');
        if (isHomeCollection) query.isHomeCollectionAvailable = true;
        
        const labs = await Lab.find(query);
        res.json({ success: true, data: labs });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. GET LAB DETAILS (Tests & Packages)
const getLabDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const [tests, packages, lab] = await Promise.all([
            LabTest.find({ labId: id }),
            LabPackage.find({ labId: id }),
            Lab.findById(id)
        ]);
        res.json({ success: true, lab, tests, packages });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. GET AVAILABLE SLOTS FOR A LAB
const getLabSlots = async (req, res) => {
    try {
        const { labId, date } = req.query;
        const config = await Availability.findOne({ vendorId: labId });
        if (!config) return res.status(404).json({ message: "Slots not configured" });

        // Check if date is an off-day
        const dayName = new Date(date).toLocaleString('en-us', { weekday: 'long' });
        if (config.offDays.includes(dayName)) {
            return res.json({ success: true, message: "Lab is closed on this day", slots: [] });
        }

        const slots = generateTimeSlots(config);
        res.json({ success: true, slots });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. INITIATE BOOKING (Direct or Prescription)
const bookLabTest = async (req, res) => {
    try {
        const { 
            labId, patients, items, collectionType, isRapid,
            appointmentDate, appointmentTime, address, couponCode, paymentMethod 
        } = req.body;

        const bookingId = `ORD-${crypto.randomInt(100000, 999999)}`;
        
        // Calculate dynamic bill
        const bill = await calculateBill(labId, items, patients.length, collectionType, couponCode, isRapid);

        const booking = await LabBooking.create({
            bookingId,
            userId: req.user.id,
            labId,
            patients,
            items,
            collectionType,
            address,
            appointmentDate,
            appointmentTime,
            billSummary: bill,
            paymentMethod,
            status: 'Confirmed' // Direct booking is confirmed after payment step
        });

        res.status(201).json({ success: true, data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 5. UPLOAD PRESCRIPTION (Figma Flow Screen 64-67)
const uploadPrescriptionFlow = async (req, res) => {
    try {
        const { labId, patients, collectionType, address } = req.body;
        if (!req.files || req.files.length === 0) return res.status(400).json({ message: "Prescription image required" });

        const images = req.files.map(f => f.path);
        
        // 1. Create Prescription Entry
        const presc = await Prescription.create({
            userId: req.user.id,
            prescriptionImages: images,
            isManualUpload: true
        });

        // 2. Create "Under Review" Booking
        const booking = await LabBooking.create({
            bookingId: `ORD-PR-${crypto.randomInt(1000, 9999)}`,
            userId: req.user.id,
            labId,
            patients,
            collectionType,
            address,
            prescriptionId: presc._id,
            bookingType: 'Prescription-Based',
            status: 'Under Review' // Figma Screen 66
        });

        res.json({ success: true, message: "Lab will review and add tests soon", bookingId: booking.bookingId });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 6. GET MY BOOKINGS (Filter by Status)
const getMyBookings = async (req, res) => {
    try {
        const bookings = await LabBooking.find({ userId: req.user.id })
            .populate('labId', 'name city profileImage')
            .sort({ createdAt: -1 });
        res.json({ success: true, data: bookings });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 7. GET BOOKING DETAILS (For Tracking Screen)
const getBookingDetails = async (req, res) => {
    try {
        const booking = await LabBooking.findById(req.params.id)
            .populate('labId phlebotomistId');
        res.json({ success: true, data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { 
    getLabs, getLabDetails, getLabSlots, 
    bookLabTest, uploadPrescriptionFlow, 
    getMyBookings, getBookingDetails 
};