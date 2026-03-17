const Provider = require('../../../models/Provider'); // Vendor model with category: 'Lab'
const LabTest = require('../../../models/LabTest');
const LabPackage = require('../../../models/LabPackage');
const LabBooking = require('../../../models/LabBooking');
const crypto = require('crypto');

// 1. GET ALL LABS (POST for complex filtering)
// endpoint: POST /api/user/labs/list
const getLabs = async (req, res) => {
    try {
        const { city, lat, lng, isHomeCollection, isInsuranceAccepted, isRapidService } = req.body;

        let query = { 
            category: 'Lab', 
            profileStatus: 'Approved', 
            isActive: true 
        };

        // Filters
        if (city) query.city = new RegExp(city, 'i');
        if (isHomeCollection) query.isHomeCollectionAvailable = true;
        if (isInsuranceAccepted) query.isInsuranceAccepted = true;
        if (isRapidService) query.isRapidServiceAvailable = true;

        // Note: Geospatial search ($near) production me lat/lng ke liye use hota hai
        const labs = await Provider.find(query).select('name city state address profileImage rating totalReviews startingPrice');

        res.json({ success: true, count: labs.length, data: labs });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. SEARCH TESTS & PACKAGES (POST for advanced filtering)
// endpoint: POST /api/user/labs/search-items
const searchLabItems = async (req, res) => {
    try {
        const { q, category, gender, ageGroup, minPrice, maxPrice, labId } = req.body;

        let testQuery = {};
        let packageQuery = {};

        // Keyword Search
        if (q) {
            testQuery.testName = new RegExp(q, 'i');
            packageQuery.packageName = new RegExp(q, 'i');
        }

        // Filters
        if (labId) {
            testQuery.labId = labId;
            packageQuery.labId = labId;
        }
        if (category) testQuery.category = category;
        if (gender) packageQuery.gender = { $in: [gender, 'Both'] };
        if (ageGroup) packageQuery.ageGroup = ageGroup;
        if (minPrice || maxPrice) {
            testQuery.offerPrice = { $gte: minPrice || 0, $lte: maxPrice || 99999 };
            packageQuery.offerPrice = { $gte: minPrice || 0, $lte: maxPrice || 99999 };
        }

        const [tests, packages] = await Promise.all([
            LabTest.find(testQuery).populate('labId', 'name city'),
            LabPackage.find(packageQuery).populate('labId', 'name city')
        ]);

        res.json({ success: true, tests, packages });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. BOOK LAB TEST (Figma Cart & Checkout)
// endpoint: POST /api/user/labs/book
const bookLabTest = async (req, res) => {
    try {
        const { 
            labId, patients, items, collectionType, 
            appointmentDate, appointmentTime, billSummary, collectionAddress 
        } = req.body;

        if (!patients || patients.length === 0) {
            return res.status(400).json({ message: "At least one patient is required" });
        }

        const bookingId = `ORD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

        const newBooking = await LabBooking.create({
            bookingId,
            userId: req.user.id,
            labId,
            patients,
            items,
            collectionType,
            collectionAddress,
            appointmentDate,
            appointmentTime,
            billSummary,
            status: 'Pending'
        });

        res.status(201).json({ 
            success: true, 
            message: "Lab test booked successfully!", 
            bookingId,
            data: newBooking 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 4. UPLOAD PRESCRIPTION (Figma: Under Review logic)
// endpoint: POST /api/user/labs/upload-prescription
const uploadPrescription = async (req, res) => {
    try {
        const { orderingFor } = req.body; // Patient name or ID
        
        if (!req.file) return res.status(400).json({ message: "Prescription file is required" });

        // Logic: Save to a separate PrescriptionRequest model
        res.json({ 
            success: true, 
            status: "Under Review", 
            prescriptionId: `PRESC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
            message: "Our medical team will review your prescription within 30-45 minutes." 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 5. GET RECENT BOOKINGS (Figma: My Tests Screen)
// endpoint: GET /api/user/labs/my-bookings?status=Pending
const getMyLabBookings = async (req, res) => {
    try {
        const { status } = req.query;
        let query = { userId: req.user.id };
        if (status) query.status = status;

        const bookings = await LabBooking.find(query)
            .populate('labId', 'name profileImage city')
            .sort({ createdAt: -1 });

        res.json({ success: true, data: bookings });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { getLabs, searchLabItems, bookLabTest, uploadPrescription, getMyLabBookings };