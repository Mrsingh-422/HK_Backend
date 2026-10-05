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
const MasterRequest = require('../../../models/MasterRequest');
const VendorKMLimit = require('../../../models/VendorKMLimit');
const Review = require('../../../models/Review'); // 👈 Import the polymorphic Review model
const UserSubscription = require('../../../models/UserSubscription');

const Cart = require('../../../models/Cart'); // Import check karein
const User = require('../../../models/User');
const moment = require('moment');
const { generateTimeSlots } = require('../../../utils/timeSlotHelper');
const { getDistance } = require('../../../utils/helpers');
const crypto = require('crypto');
const mongoose = require('mongoose');
const countries = require('../../../data/countries.json');
const states = require('../../../data/states.json');
const cities = require('../../../data/cities.json');
const Fuse = require('fuse.js');
const LabCategory = require('../../../models/LabCategory');
const LabPrescriptionRequest = require('../../../models/LabPrescriptionRequest'); // Import new model
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const fs = require('fs');
const path = require('path');
const { deleteFile } = require('../../../utils/fileHandler')
const { processCancellationRefund } = require('../../../utils/policyHelper');


// for rating and reviews
const Doctor = require('../../../models/Doctor'); 
const Pharmacy = require('../../../models/Pharmacy');
const Ambulance = require('../../../models/Ambulance');
const Hospital = require('../../../models/Hospital');
const Nurse = require('../../../models/Nurse');
const Driver = require('../../../models/Driver');
// end rating

const { sendPushNotification,notifyAdminsAndVendor } = require('../../../utils/notification'); // For Notifications

const { createRazorpayOrder, verifyRazorpaySignature, fetchAndMapRazorpayPayment } = require('../../../utils/razorpay'); // 👈 Razorpay Helpers Imported
const { checkAndApplyBenefit, deductBenefitCount, refundBenefitCount } = require('../../../utils/subscriptionBenefitHelper');
const { isCodEnabled } = require('../../../utils/policyHelper');





// --- UPDATED: CALCULATE BILL (Per Patient Rapid Charge Logic) ---
const calculateBillHelper = async (labId, items, patientsCount, collectionType, couponCode, isRapid, userId, appointmentTime) => {
    let itemTotal = 0;
    
    // Items total calculation (Preserving existing logic)
    const tests = items.items ? items.items.filter(i => i.productType === 'LabTest') : (items.tests || []);
    const packages = items.items ? items.items.filter(i => i.productType === 'LabPackage') : (items.packages || []);

    for (let t of tests) {
        const id = t.itemId || t.testId;
        const test = await LabTest.findById(id);
        if (test) itemTotal += (test.discountPrice || test.amount);
    }
    for (let p of packages) {
        const id = p.itemId || p.packageId;
        const pkg = await LabPackage.findById(id);
        if (pkg) itemTotal += (pkg.offerPrice || pkg.mrp);
    }

    itemTotal = itemTotal * patientsCount; 

    let homeVisitCharge = 0;
    const charges = await DeliveryCharge.findOne({ vendorId: labId });

    if (collectionType === 'Home Collection') {
        let standardFee = charges ? Number(charges.fixedPrice) : 40;
        
        // 🚨 SUBSCRIPTION CHECK: Free Lab Delivery Check
        const labDeliveryBenefit = await checkAndApplyBenefit(userId, 'freeLabDeliveriesCount', standardFee);
        
        if (labDeliveryBenefit.isApplied) {
            homeVisitCharge = 0; // Set to 0 if plan benefit is active
        } else if (charges && charges.freeDeliveryThreshold && itemTotal >= charges.freeDeliveryThreshold) {
            homeVisitCharge = 0;
        } else {
            homeVisitCharge = standardFee;
        }
    }
    
    let rapidCharge = 0;
    if (isRapid) {
        rapidCharge = charges ? Number(charges.fastDeliveryExtra) : 100;
    }

    let slotCharge = 0;
    if (appointmentTime && appointmentTime !== 'Immediate') {
        const availConfig = await Availability.findOne({ vendorId: labId });
        if (availConfig && availConfig.premiumSlots) {
            const premiumSlotMatch = availConfig.premiumSlots.find(ps => ps.time.trim() === appointmentTime.trim());
            if (premiumSlotMatch) slotCharge = Number(premiumSlotMatch.extraFee) || 0;
        }
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

    return { 
        itemTotal, 
        couponDiscount, 
        couponId,
        homeVisitCharge, 
        rapidDeliveryCharge: rapidCharge, 
        slotCharge, 
        totalAmount: Math.round(totalAmount)
    };
};


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
// --- NEW HELPER: Multi-Patient, Multi-Address Bill Calculation ---
const calculateStructuredBill = async (labId, patientMappings, collectionType, couponCode, isRapid, userId, appointmentTime) => {
    let itemTotal = 0;
    const totalPatients = patientMappings.length;

    // 1. Calculate sum of assigned items for each patient
    for (let mapping of patientMappings) {
        for (let item of mapping.items) {
            if (item.productType === 'LabTest') {
                const test = await LabTest.findById(item.itemId);
                if (test) itemTotal += (test.discountPrice || test.amount);
            } else if (item.productType === 'LabPackage') {
                const pkg = await LabPackage.findById(item.itemId);
                if (pkg) itemTotal += (pkg.offerPrice || pkg.mrp);
            }
        }
    }

    // 2. Calculate Home Visit Charge
    let homeVisitCharge = 0;
    const charges = await DeliveryCharge.findOne({ vendorId: labId });

    if (collectionType === 'Home Collection') {
        let standardFee = charges ? Number(charges.fixedPrice) : 40;
        
        // Subscription check for free home visits
        const labDeliveryBenefit = await checkAndApplyBenefit(userId, 'freeLabDeliveriesCount', standardFee);
        
        if (labDeliveryBenefit.isApplied) {
            homeVisitCharge = 0;
        } else if (charges && charges.freeDeliveryThreshold && itemTotal >= charges.freeDeliveryThreshold) {
            homeVisitCharge = 0;
        } else {
            homeVisitCharge = standardFee;
        }
    }
    
    // 3. Calculate Rapid Delivery Surcharge (Calculated per assigned patient)
    let rapidCharge = 0;
    if (isRapid) {
        const baseRapidCharge = charges ? Number(charges.fastDeliveryExtra) : 100;
        rapidCharge = baseRapidCharge * totalPatients;
    }

    // 4. Calculate Premium Slot Charge
    let slotCharge = 0;
    if (appointmentTime && appointmentTime !== 'Immediate') {
        const availConfig = await Availability.findOne({ vendorId: labId });
        if (availConfig && availConfig.premiumSlots) {
            const premiumSlotMatch = availConfig.premiumSlots.find(ps => ps.time.trim() === appointmentTime.trim());
            if (premiumSlotMatch) slotCharge = Number(premiumSlotMatch.extraFee) || 0;
        }
    }

    // 5. Calculate Coupon Discounts
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

    return { 
        itemTotal, 
        couponDiscount, 
        couponId,
        homeVisitCharge, 
        rapidDeliveryCharge: rapidCharge, 
        slotCharge, 
        totalAmount: Math.round(totalAmount)
    };
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
        
        // 🚨 CHANGE 1: Minimum check changed to 1 character for instant search
        if (search && search.trim().length >= 1) {
            matchQuery.testName = new RegExp(search.trim(), 'i');
        }

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
                    minPrice: { $min: "$vendorList.discountPrice" },
                    
                    // 🚨 CHANGE 2: Dynamic Category Weight Assignment for strict sorting order
                    // 1: Pathology, 2: Radiology, 3: Microbiology, 4: Others
                    categoryWeight: {
                        $switch: {
                            branches: [
                                { case: { $eq: ["$mainCategory", "Pathology"] }, then: 1 },
                                { case: { $eq: ["$mainCategory", "Radiology"] }, then: 2 },
                                { case: { $eq: ["$mainCategory", "Microbiology"] }, then: 3 }
                            ],
                            default: 4
                        }
                    }
                }
            },
            // Sort by Category Weight first, then by Popularity (vendorCount), and then alphabetically by Name
            { $sort: { categoryWeight: 1, vendorCount: -1, testName: 1 } },
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
        res.status(500).json({ success: false, message: error.message }); 
    }
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


// --- NEW: GET STANDARD CATALOG PACKAGES (For User Discovery) --- // pagination 20
// GET /user/labs/standard-packages?category=Full Body Checkup
const getStandardPackages = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;
        const { search, category } = req.query;

        let matchQuery = { isActive: true };
        if (search) matchQuery.packageName = new RegExp(search, 'i');
        if (category) matchQuery.category = category;

        const aggregate = MasterLabPackage.aggregate([
            { $match: matchQuery },
            
            // 1. LOOKUP VENDORS (Sirf Price aur Count nikalne ke liye)
            {
                $lookup: {
                    from: "labpackages",
                    localField: "_id",
                    foreignField: "masterPackageId",
                    as: "vendorList",
                    pipeline: [{ $match: { isActive: true } }]
                }
            },
            
            // 2. LIGHTWEIGHT FIELDS (Sirf zaroori data)
            {
                $addFields: {
                    vendorCount: { $size: "$vendorList" },
                    minPrice: { $min: "$vendorList.offerPrice" },
                    testCount: { $size: "$tests" } // Sirf ginti bhejein, pura data nahi
                }
            },
            
            // 3. PROJECT: Heavy fields ko hata dein
            { 
                $project: { 
                    vendorList: 0, 
                    tests: 0,        // <--- Tests array hata diya (Heavy field)
                    description: 0,  // <--- Description bhi details mein dikhayenge
                    precaution: 0    // <--- Precaution details mein
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
        res.json({
            success: true,
            total: result[0].metadata[0]?.total || 0,
            currentPage: page,
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
// Endpoint: GET /user/labs/standard-packages/female?page=1&mainCategory=Pathology
const getFemaleStandardPackages = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;
        const { search, mainCategory } = req.query; // 👈 Extracted mainCategory from query

        // FILTER LOGIC: Gender should be 'Female'
        let matchQuery = { 
            isActive: true, 
            gender: { $in: ['Female'] } 
        };

        if (search) matchQuery.packageName = new RegExp(search, 'i');
        if (mainCategory) matchQuery.mainCategory = mainCategory; // 👈 Added mainCategory Filter [2]

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
            { $sort: { gender: 1, vendorCount: -1 } }, 
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

//  Endpoint: GET /user/labs/standard-tests/female?page=1&mainCategory=Pathology
const getFemaleStandardTests = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;
        const { search, mainCategory } = req.query; // 👈 Extracted mainCategory and optional search [2]

        // FILTER: Female tests
        let matchQuery = { 
            isActive: true, 
            gender: { $in: ['Female'] } 
        };

        if (search) matchQuery.testName = new RegExp(search, 'i'); // Optional search support
        if (mainCategory) matchQuery.mainCategory = mainCategory; // 👈 Added mainCategory Filter [2]

        const aggregate = MasterLabTest.aggregate([
            { $match: matchQuery },
            {
                $lookup: {
                    from: "labtests",
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
            { $sort: { testName: 1 } },
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [{ $skip: skip }, { $limit: limit }]
                }
            }
        ]);

        const result = await aggregate;
        const total = result[0].metadata[0]?.total || 0; // Total calculation aligned with standard pagination [2]

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




// Default Location: Delhi (Coordinates)
const DEFAULT_LAT = 28.6139;
const DEFAULT_LNG = 77.2090;

// endpoint: GET /user/labs/suggestions?query=Del
const getSearchSuggestions = (req, res) => {
    try {
        const { query } = req.query;
        if (!query || query.length < 2) return res.json({ success: true, data: [] });

        const search = query.toLowerCase();

        // 1. Search in Cities (City, State, Country)
        const matchedCities = cities
            .filter(c => c.name.toLowerCase().includes(search))
            .slice(0, 10); // Performance: Sirf 10 results

        const suggestions = matchedCities.map(city => {
            const state = states.find(s => s.id == city.state_id);
            const country = countries.find(c => c.id == state?.country_id);
            
            return {
                city: city.name,
                state: state?.name || "",
                country: country?.name || "",
                display: `${city.name}, ${state?.name || ''}, ${country?.name || ''}`
            };
        });

        res.json({ success: true, data: suggestions });
    } catch (error) {
        res.status(500).json({ message: "Error fetching suggestions" });
    }
};
// endpoint: GET /user/labs/lab-suggestions?query=Mud
// searchbar ke liye in Labs
const getLabSuggestions = async (req, res) => {
    try {
        const { query } = req.query;
        if (!query || query.length < 2) return res.json({ success: true, data: [] });

        const searchRegex = new RegExp(query, 'i');

        // Database mein Lab names dhoondein
        const labs = await Lab.find({
            name: searchRegex,
            profileStatus: 'Approved',
            isActive: true
        })
        .select('name city profileImage') // Sirf zaroori data uthayein
        .limit(10)
        .lean();

        const suggestions = labs.map(lab => ({
            id: lab._id,
            name: lab.name,
            city: lab.city,
            image: lab.profileImage,
            display: lab.name // Frontend display ke liye
        }));

        res.json({ success: true, data: suggestions });
    } catch (error) {
        res.status(500).json({ message: "Error fetching lab suggestions" });
    }
};


// POST /user/labs/list
const getLabs = async (req, res) => {
    try {
        let { lat, lng, search, city, state, country } = req.body;

        const filterLat = lat || DEFAULT_LAT;
        const filterLng = lng || DEFAULT_LNG;

        // Strictly filters: Only APPROVED and ACTIVE labs (isActive must be true, offline ones included)
        let query = { profileStatus: 'Approved', isActive: true };

        if (city) query.city = new RegExp(`^${city}$`, 'i');
        if (state) query.state = new RegExp(`^${state}$`, 'i');
        if (country) query.country = new RegExp(`^${country}$`, 'i');

        if (search) {
            const searchRegex = new RegExp(search, 'i');
            if (city) {
                query.name = searchRegex;
            } else {
                query.$or = [
                    { name: searchRegex },
                    { city: searchRegex },
                    { state: searchRegex }
                ];
            }
        }

        // Projecting 'isOnline' along with other fields
        const labs = await Lab.find(query).select('name profileImage city state country address rating totalReviews isHomeCollectionAvailable isRapidServiceAvailable location is24x7 isInsuranceAccepted acceptedInsurances labImages isOnline').lean();

        let finalLabs = [];
        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Lab', isActive: true });
        const maxRadius = limitConfig ? limitConfig.kmLimit : 100;

        for (let lab of labs) {
            let distance = null;

            if (lab.location?.lat) {
                distance = await getDistance(filterLat, filterLng, lab.location.lat, lab.location.lng);
            }
            
            const isBroadSearch = !!(city || search);

            if (isBroadSearch || distance <= maxRadius) {
                const [minTest, minPackage] = await Promise.all([
                    LabTest.findOne({ labId: lab._id, isActive: true }).sort({ discountPrice: 1 }).select('discountPrice'),
                    LabPackage.findOne({ labId: lab._id, isActive: true }).sort({ offerPrice: 1 }).select('offerPrice')
                ]);

                const startingPrice = Math.min(minTest?.discountPrice || Infinity, minPackage?.offerPrice || Infinity);

                finalLabs.push({
                    ...lab,
                    distance: distance ? distance.toFixed(1) : "N/A",
                    startingPrice: startingPrice === Infinity ? 0 : startingPrice
                });
            }
        }

        finalLabs.sort((a, b) => {
            if (a.distance === "N/A") return 1;
            if (b.distance === "N/A") return -1;
            return parseFloat(a.distance) - parseFloat(b.distance);
        });

        res.json({ 
            success: true, 
            count: finalLabs.length, 
            locationApplied: (!lat || !lng) ? "Delhi (Default Base)" : "User GPS Base",
            isGlobalSearch: !!(city || search),
            data: finalLabs 
        });

    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};
// 1. GET LAB PROFILE (Sirf Lab ki basic info)
const getLabDetails = async (req, res) => {
    try {
        const { id } = req.params;

        const lab = await Lab.findById(id)
            .select('name country state city address profileImage rating totalReviews isHomeCollectionAvailable isRapidServiceAvailable isInsuranceAccepted acceptedInsurances about location documents.labImages is24x7 isActive isOnline')
            .lean();
        
        // 🚨 CRITICAL CHECK: Block access if lab is inactive by Admin
        if (!lab || lab.isActive === false) {
            return res.status(404).json({ success: false, message: "Lab profile is inactive or not found." });
        }

        const config = await Availability.findOne({ vendorId: id });
        
        let openStatus = "Closed";
        let timingLabel = "Timings not set";
        let nextSlot = null;

        if (config) {
            const now = moment();
            timingLabel = `Open ${config.startTime} - ${config.endTime}`;

            const isOffDay = config.offDays.includes(now.format('dddd'));
            const startTime = moment(config.startTime, "HH:mm");
            const endTime = moment(config.endTime, "HH:mm");
            
            if (!isOffDay && now.isBetween(startTime, endTime)) {
                openStatus = "Open Now";
            }

            const allSlots = generateTimeSlots(config);
            
            const bookedCounts = await LabBooking.aggregate([
                { $match: { labId: lab._id, appointmentDate: new Date(now.startOf('day')), status: { $ne: 'Cancelled' } } },
                { $group: { _id: "$appointmentTime", count: { $sum: 1 } } }
            ]);

            for (let slot of allSlots) {
                const slotTime = moment(slot.time, "hh:mm A");
                if (slotTime.isAfter(now)) {
                    const booking = bookedCounts.find(b => b._id === slot.time);
                    const isFull = config.maxClientsPerSlot !== 0 && (booking ? booking.count : 0) >= config.maxClientsPerSlot;
                    
                    if (!isFull) {
                        nextSlot = {
                            date: "Today",
                            time: slot.time
                        };
                        break;
                    }
                }
            }

            if (!nextSlot) {
                nextSlot = {
                    date: "Tomorrow",
                    time: allSlots[0]?.time || "N/A"
                };
            }
        }

        const recentReviews = await Review.find({ targetId: id, targetType: 'Lab' })
            .select('userName rating comment createdAt')
            .sort({ createdAt: -1 })
            .limit(3)
            .lean();

        res.json({ 
            success: true, 
            data: {
                ...lab,
                openStatus,           
                timingLabel,          
                gallery: lab.documents?.labImages || [], 
                nextAvailableSlot: nextSlot, 
                recentReviews,
                isOnline: lab.isOnline ?? true // Sends online status to UI
            } 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
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
            .populate('masterPackageId') // Populates Master template dynamically [cite: getLabInventoryPackages]
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();

        const resolvedPackages = packages.map(pkg => {
            const master = pkg.masterPackageId || {};
            
            // 🚨 UNIFIED ID RESOLUTION: [cite: 2.1]
            // If custom, masterPackageId is set to pkg._id (the listed package ID itself).
            // If standard, it falls back to master._id (the template ID).
            const unifiedMasterId = pkg.isCustom ? pkg._id : (master._id || pkg._id);

            return {
                ...pkg,
                shortDescription: pkg.shortDescription || master.shortDescription || "",
                longDescription: pkg.longDescription || master.longDescription || "",
                isFastingRequired: pkg.isFastingRequired !== undefined ? pkg.isFastingRequired : (master.isFastingRequired || false),
                fastingDuration: pkg.fastingDuration || master.fastingDuration || "",
                preparations: (pkg.preparations && pkg.preparations.length > 0) ? pkg.preparations : (master.preparations || []),
                detailedDescription: (pkg.detailedDescription && pkg.detailedDescription.length > 0) ? pkg.detailedDescription : (master.detailedDescription || []),
                faqs: (pkg.faqs && pkg.faqs.length > 0) ? pkg.faqs : (master.faqs || []),
                tags: (pkg.tags && pkg.tags.length > 0) ? pkg.tags : (master.tags || []),
                lifestyleTags: (pkg.lifestyleTags && pkg.lifestyleTags.length > 0) ? pkg.lifestyleTags : (master.lifestyleTags || []),
                packageImage: pkg.packageImage || master.packageImage || null,
                mainCategory: pkg.mainCategory || master.mainCategory || "Pathology",
                category: pkg.category || master.category || "",
                
                // 🚨 COMMON KEY: masterPackageId holds the unified ID for both standard and custom packages! [cite: 2.1]
                masterPackageId: unifiedMasterId
            };
        });

        res.json({ 
            success: true, 
            total, 
            page, 
            pages: Math.ceil(total / limit), 
            data: resolvedPackages 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
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
        const { labId, date } = req.query; // date format: YYYY-MM-DD
        
        if (!labId || !date) {
            return res.status(400).json({ success: false, message: "Lab ID and Date are required" });
        }

        const config = await Availability.findOne({ vendorId: labId });
        if (!config) return res.status(404).json({ success: false, message: "Slots not configured by Lab" });

        // 1. Check for Weekly Off-days (e.g., Sunday)
        const dayName = moment(date).format('dddd');
        if (config.offDays.includes(dayName)) {
            return res.json({ success: true, isClosed: true, message: "Lab is closed (Weekly Off)", slots: [] });
        }

        // 2. Check for Specific Blocked Dates (Holidays/Emergency)
        if (config.blockedDates && config.blockedDates.includes(date)) {
            return res.json({ success: true, isClosed: true, message: "Lab is closed on this specific date", slots: [] });
        }

        // 3. Generate base slots using helper
        const allGeneratedSlots = generateTimeSlots(config);

        // 4. Capacity Logic: Calculate existing bookings for this date
        // Hum un bookings ko count karenge jo 'Cancelled' nahi hain
        const bookedCounts = await LabBooking.aggregate([
            { 
                $match: { 
                    labId: new mongoose.Types.ObjectId(labId), 
                    appointmentDate: new Date(date), 
                    status: { $ne: 'Cancelled' } 
                } 
            },
            { 
                $group: { 
                    _id: "$appointmentTime", 
                    count: { $sum: 1 } 
                } 
            }
        ]);

        // 5. Merge Booking count with Generated Slots
        const finalSlots = allGeneratedSlots.map(slot => {
            const booking = bookedCounts.find(b => b._id === slot.time);
            const currentCount = booking ? booking.count : 0;

            return {
                ...slot, // includes time, category, and extraFee from helper
                currentBookings: currentCount,
                // Agar maxClientsPerSlot 0 hai toh unlimited, warna limit check karein
                isFull: config.maxClientsPerSlot !== 0 && currentCount >= config.maxClientsPerSlot
            };
        });

        res.json({ 
            success: true, 
            isClosed: false, 
            labName: config.vendorType, 
            slots: finalSlots 
        });

    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. GET AVAILABLE COUPONS (Admin Global + Specific Vendor)
const getAvailableCoupons = async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. User ki cart find karein aur Item Total calculate karein
        const cart = await Cart.findOne({ userId });
        
        if (!cart || !cart.labCart || !cart.labCart.labId || cart.labCart.items.length === 0) {
            return res.status(200).json({ success: false, message: "Cart empty or No lab selected" });
        }

        const labId = cart.labCart.labId;
        const itemTotal = cart.labCart.items.reduce((acc, i) => acc + (i.price * i.quantity), 0);
        const today = new Date();

        // 2. Base Coupons Fetch karein (Active + Not Expired + Vendor Match)
        const allCoupons = await Coupon.find({ 
            isActive: true,
            expiryDate: { $gte: today }, 
            $or: [
                { vendorId: labId },       // Specific Lab ke coupons
                { 
                    isAdminCreated: true, 
                    vendorType: { $in: ['Lab', 'All'] }, // Admin ke Global coupons (Lab ya All category)
                    vendorId: null 
                }
            ]
        }).sort({ createdAt: -1 });

        // 3. Logic Implementation: Har coupon ko current user/cart ke liye validate karein
        const validatedCoupons = allCoupons.map(coupon => {
            let isApplicable = true;
            let reason = "Coupon is available";
            let amountToCollect = 0;

            // A. Check Min Order Amount
            if (itemTotal < coupon.minOrderAmount) {
                isApplicable = false;
                amountToCollect = coupon.minOrderAmount - itemTotal;
                reason = `Add ₹${amountToCollect} more to apply this coupon.`;
            }

            // B. Check Max Usage for this specific User
            // Note: usedBy array se user ki ID aur usageCount match karein
            const userUsage = coupon.usedBy.find(u => u.userId.toString() === userId.toString());
            if (userUsage && userUsage.usageCount >= coupon.maxUsagePerUser) {
                isApplicable = false;
                reason = "You have reached the maximum usage limit for this coupon.";
            }

            // C. Return coupon details with status flags (Frontend help ke liye)
            return {
                ...coupon._doc, // Mongoose document se data extract karein
                isApplicable,
                validationMessage: reason,
                amountShort: amountToCollect,
                potentialDiscount: Math.min((itemTotal * coupon.discountPercentage) / 100, coupon.maxDiscount)
            };
        });

        res.json({ 
            success: true, 
            count: validatedCoupons.length, 
            cartTotal: itemTotal,
            data: validatedCoupons 
        });

    } catch (error) { 
        console.error("Coupon Validation Error:", error);
        res.status(500).json({ message: error.message }); 
    }
};
const validateLabCoupon = async (req, res) => {
    try {
        const { couponName, labId, totalAmount } = req.body;
        const coupon = await Coupon.findOne({ 
            couponName: couponName.toUpperCase(), 
            $or: [{ vendorId: labId }, { vendorType: 'Lab' }, { vendorType: 'All' }],
            isActive: true,
            expiryDate: { $gte: new Date() }
        });

        if (!coupon) return res.status(404).json({ message: "Invalid or expired coupon" });
        if (totalAmount < coupon.minOrderAmount) return res.status(400).json({ message: `Min order ₹${coupon.minOrderAmount} required` });

        const discount = Math.min((totalAmount * coupon.discountPercentage) / 100, coupon.maxDiscount);
        res.json({ success: true, discount });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// @desc    Evaluate Lab Checkout Bill Summary (Screenshot & Logistics Config Synced)
// @route   POST /user/labs/checkout
// @access  Private (User)
const checkoutLabBooking = async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "User not authenticated." });
        }

        const { 
            labId, 
            collectionType = 'Home Collection', 
            isRapid = false, 
            couponCode,
            userLat,
            userLng
        } = req.body;

        if (!labId) {
            return res.status(400).json({ success: false, message: "labId is required." });
        }

        // 1. Fetch Lab Cart
        const cart = await Cart.findOne({ userId });
        if (!cart || !cart.labCart || !cart.labCart.items || cart.labCart.items.length === 0) {
            return res.status(400).json({ 
                success: false, 
                errorStep: "CART_EMPTY",
                message: "Your lab cart is empty. Please add tests or packages before checkout." 
            });
        }

        // 2. Resolve Patients Multiplier
        let rawPatients = req.body.selectedPatients || req.body.patients || req.body.selectedPatientIds || cart.labCart.selectedPatients || [];
        if (typeof rawPatients === 'string') {
            try { rawPatients = JSON.parse(rawPatients); } catch (e) { rawPatients = []; }
        }

        const patientMultiplier = Array.isArray(rawPatients) && rawPatients.length > 0 ? rawPatients.length : 1;

        // 3. Resolve Address
        let parsedAddress = null;
        if (req.body.address) {
            try {
                parsedAddress = typeof req.body.address === 'string' ? JSON.parse(req.body.address) : req.body.address;
            } catch (e) {
                parsedAddress = null;
            }
        }

        // 4. Calculate Base Tests Total & Multiplied Total
        let baseTestsTotal = 0;
        const processedItems = [];

        for (const item of cart.labCart.items) {
            const unitPrice = Number(item.price || 0);
            baseTestsTotal += unitPrice;

            processedItems.push({
                productType: item.productType,
                itemId: item.itemId,
                name: item.name,
                price: unitPrice,
                patientMultiplier,
                totalPrice: unitPrice * patientMultiplier
            });
        }

        const multipliedTotal = baseTestsTotal * patientMultiplier;

        // 5. Dynamic Logistics Calculation (Home Collection vs Visit Lab + Distance)
        let standardHomeCollectionCharge = 0;
        let fastReportCharge = 0;
        const isFastReporting = String(isRapid) === 'true';

        const deliveryConfig = await DeliveryCharge.findOne({ vendorId: labId, vendorType: 'Lab' });
        const baseHomeFee = Number(deliveryConfig?.fixedPrice !== undefined ? deliveryConfig.fixedPrice : 89);
        const baseDistance = Number(deliveryConfig?.fixedDistance || 5);
        const pricePerKm = Number(deliveryConfig?.pricePerKM || 15);
        const freeThreshold = Number(deliveryConfig?.freeDeliveryThreshold || 499);
        const fastReportExtraFee = Number(deliveryConfig?.fastDeliveryExtra !== undefined ? deliveryConfig.fastDeliveryExtra : 150);

        if (collectionType === 'Home Collection') {
            let distance = 0;
            if (userLat && userLng) {
                const lab = await Lab.findById(labId).select('location').lean();
                if (lab?.location?.lat && lab?.location?.lng) {
                    distance = await getDistance(Number(userLat), Number(userLng), lab.location.lat, lab.location.lng);
                }
            }

            // Base distance vs additional km calculation
            let calculatedFee = baseHomeFee;
            if (distance > baseDistance) {
                calculatedFee += Math.round((distance - baseDistance) * pricePerKm);
            }

            // Free delivery threshold check
            if (freeThreshold > 0 && multipliedTotal >= freeThreshold) {
                standardHomeCollectionCharge = 0;
            } else {
                standardHomeCollectionCharge = calculatedFee;
            }
        } else {
            // Visit Lab / Walk-in at diagnostic center
            standardHomeCollectionCharge = 0;
        }

        // Fast Express Reporting applies in BOTH Home Collection & Visit Lab if enabled!
        if (isFastReporting) {
            fastReportCharge = fastReportExtraFee;
        }

        // 6. Evaluate Subscription Benefit (Free Home Collection Quota Check)
        let deliveryBenefit = { isApplied: false, hasActiveSubscription: false, isBenefitExhausted: false, remainingCount: 0 };
        let finalHomeCollectionCharge = 0;

        if (collectionType === 'Home Collection' && standardHomeCollectionCharge > 0) {
            deliveryBenefit = await checkAndApplyBenefit(userId, 'freeLabDeliveriesCount', standardHomeCollectionCharge);
            finalHomeCollectionCharge = deliveryBenefit.amount;
        }

        // 7. Evaluate Coupon Discount on Multiplied Total
        let couponDiscount = 0;
        let validCouponId = null;

        if (couponCode && typeof couponCode === 'string' && couponCode.trim() !== '' && couponCode !== 'undefined') {
            const cleanCode = couponCode.trim().toUpperCase();
            const coupon = await Coupon.findOne({ 
                couponName: cleanCode, 
                isActive: true,
                expiryDate: { $gte: new Date() }
            });

            if (coupon && multipliedTotal >= coupon.minOrderAmount) {
                if (!coupon.vendorId || String(coupon.vendorId) === String(labId) || coupon.vendorType === 'All' || coupon.vendorType === 'Lab') {
                    couponDiscount = Math.min((multipliedTotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
                    validCouponId = coupon._id;
                }
            }
        }

        const isCodAvailable = await isCodEnabled('Lab', userId);
        const totalPayable = Math.max(0, Math.round((multipliedTotal - couponDiscount) + finalHomeCollectionCharge + fastReportCharge));

        res.status(200).json({
            success: true,
            data: {
                labId,
                collectionType,
                patientMultiplier,
                isFastReporting,
                isCodAvailable,
                billSummary: {
                    baseTestsTotal: Math.round(baseTestsTotal),
                    patientMultiplier,
                    multipliedTotal: Math.round(multipliedTotal),
                    couponDiscount: Math.round(couponDiscount),
                    couponId: validCouponId,
                    homeSampleCollectionCharge: finalHomeCollectionCharge,
                    originalHomeCollectionCharge: standardHomeCollectionCharge,
                    fastReportCharge: Math.round(fastReportCharge),
                    totalAmount: Math.round(totalPayable)
                },
                subscriptionBenefit: {
                    isApplied: deliveryBenefit.isApplied,
                    hasActiveSubscription: deliveryBenefit.hasActiveSubscription,
                    isBenefitExhausted: deliveryBenefit.isBenefitExhausted,
                    remainingCount: deliveryBenefit.remainingCount,
                    planName: deliveryBenefit.planName || "",
                    benefitField: "freeLabDeliveriesCount",
                    exhaustedMessage: deliveryBenefit.exhaustedMessage || (deliveryBenefit.isBenefitExhausted ? "Your subscription free delivery/service quota has been exhausted. Standard charges have been applied." : "")
                },
                selectedPatients: rawPatients,
                address: parsedAddress,
                items: processedItems
            }
        });

    } catch (error) {
        console.error("checkoutLabBooking Error:", error);
        res.status(500).json({ success: false, message: error.message || "Internal Server Error in lab checkout." });
    }
};

const getUniqueMainCategories = async (req, res) => {
    try {
        const categories = await MasterLabTest.distinct("mainCategory", { isActive: true });
        res.json({
            success: true,
            data: categories // Output example: ["Pathology", "Radiology", "Cardiology", "Neurology"...]
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
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

// @desc    Finalize Lab Booking (Online vs COD with Status Machine & Dynamic Charges)
// @route   POST /user/labs/book
// @access  Private (User)
const bookLabTest = async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "User not authenticated." });
        }

        // 1. Fetch Cart
        const cart = await Cart.findOne({ userId });
        if (!cart || !cart.labCart || !cart.labCart.items || cart.labCart.items.length === 0) {
            return res.status(400).json({ 
                success: false, 
                errorStep: "CART_EMPTY",
                message: "Your lab cart is empty. Please add tests or packages before booking." 
            });
        }

        const labId = cart.labCart.labId;
        const collectionType = req.body.collectionType || 'Home Collection';

        // 2. Parse Address
        let parsedAddress = null;
        try {
            if (typeof req.body.address === 'string') {
                parsedAddress = JSON.parse(req.body.address);
            } else if (typeof req.body.address === 'object') {
                parsedAddress = req.body.address;
            }
        } catch (e) {
            parsedAddress = null;
        }

        if (collectionType === 'Home Collection') {
            if (!parsedAddress || (!parsedAddress.houseNo && !parsedAddress.address) || !parsedAddress.city) {
                return res.status(400).json({
                    success: false,
                    errorStep: "ADDRESS_INCOMPLETE",
                    message: "Delivery address (houseNo/address, city, phone) is required for Home Collection."
                });
            }
        }

        // 3. Resolve Patients List & Multiplier
        let rawPatients = req.body.selectedPatients || req.body.patients || cart.labCart.selectedPatients || [];
        if (typeof rawPatients === 'string') {
            try { rawPatients = JSON.parse(rawPatients); } catch (e) { rawPatients = []; }
        }

        const patientMultiplier = Array.isArray(rawPatients) && rawPatients.length > 0 ? rawPatients.length : 1;

        // 4. Calculate Tests Total
        let baseTestsTotal = 0;
        const testItems = [];
        const packageItems = [];

        for (const item of cart.labCart.items) {
            const unitPrice = Number(item.price || 0);
            baseTestsTotal += unitPrice;

            if (item.productType === 'LabPackage') {
                packageItems.push({
                    packageId: item.itemId,
                    name: item.name,
                    price: unitPrice,
                    precaution: ""
                });
            } else {
                testItems.push({
                    testId: item.itemId,
                    name: item.name,
                    price: unitPrice,
                    precaution: ""
                });
            }
        }

        const multipliedTotal = baseTestsTotal * patientMultiplier;

        // 5. Calculate Logistics Charges from DeliveryCharge Model
        let standardHomeCollectionCharge = 0;
        let fastReportCharge = 0;
        const isFastReporting = String(req.body.isRapid) === 'true';

        const deliveryConfig = await DeliveryCharge.findOne({ vendorId: labId, vendorType: 'Lab' });
        const baseHomeFee = Number(deliveryConfig?.fixedPrice !== undefined ? deliveryConfig.fixedPrice : 89);
        const freeThreshold = Number(deliveryConfig?.freeDeliveryThreshold || 499);
        const fastReportExtraFee = Number(deliveryConfig?.fastDeliveryExtra !== undefined ? deliveryConfig.fastDeliveryExtra : 150);

        if (collectionType === 'Home Collection') {
            if (freeThreshold > 0 && multipliedTotal >= freeThreshold) {
                standardHomeCollectionCharge = 0;
            } else {
                standardHomeCollectionCharge = baseHomeFee;
            }
        }

        if (isFastReporting) {
            fastReportCharge = fastReportExtraFee;
        }

        // Apply Subscription Benefit on Home Collection Fee
        let deliveryBenefit = { isApplied: false };
        let finalHomeCollectionCharge = 0;

        if (collectionType === 'Home Collection' && standardHomeCollectionCharge > 0) {
            deliveryBenefit = await checkAndApplyBenefit(userId, 'freeLabDeliveriesCount', standardHomeCollectionCharge);
            finalHomeCollectionCharge = deliveryBenefit.amount;
        }

        // 6. Coupon Discount Calculation
        let couponDiscount = 0;
        let appliedCouponObj = null;
        const couponCode = req.body.couponCode;

        if (couponCode && typeof couponCode === 'string' && couponCode.trim() !== '' && couponCode !== 'undefined') {
            const cleanCode = couponCode.trim().toUpperCase();
            const coupon = await Coupon.findOne({
                couponName: cleanCode,
                isActive: true,
                expiryDate: { $gte: new Date() }
            });

            if (coupon && multipliedTotal >= coupon.minOrderAmount) {
                if (!coupon.vendorId || String(coupon.vendorId) === String(labId) || coupon.vendorType === 'All' || coupon.vendorType === 'Lab') {
                    couponDiscount = Math.min((multipliedTotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
                    appliedCouponObj = {
                        couponId: coupon._id,
                        couponName: coupon.couponName,
                        discountPercentage: coupon.discountPercentage,
                        maxDiscount: coupon.maxDiscount
                    };
                }
            }
        }

        const totalAmount = Math.max(0, Math.round((multipliedTotal - couponDiscount) + finalHomeCollectionCharge + fastReportCharge));

        // 7. Payment Mode Check
        const paymentMethod = req.body.paymentMethod || 'COD';
        const isCod = (paymentMethod === 'COD');

        if (isCod) {
            const codAllowed = await isCodEnabled('Lab', userId);
            if (!codAllowed) {
                return res.status(400).json({
                    success: false,
                    errorStep: "COD_DISABLED",
                    message: "Cash on Collection is currently disabled for this laboratory. Please pay online."
                });
            }
        }

        const bookingId = `ORD-${Date.now().toString().slice(-6)}${Math.floor(100 + Math.random() * 900)}`;

        let finalAppointmentDate = new Date();
        if (req.body.appointmentDate && req.body.appointmentDate !== 'undefined' && req.body.appointmentDate !== 'null') {
            const parsedD = new Date(req.body.appointmentDate);
            if (!isNaN(parsedD.getTime())) finalAppointmentDate = parsedD;
        }

        let finalAppointmentTime = req.body.appointmentTime && req.body.appointmentTime !== 'undefined' && req.body.appointmentTime !== 'null'
            ? req.body.appointmentTime.trim()
            : "09:00 AM - 11:00 AM";

        // 8. Razorpay Order Creation (Online Only)
        let rzpOrder = null;
        if (!isCod && totalAmount > 0) {
            rzpOrder = await createRazorpayOrder(totalAmount, `rcpt_${bookingId}`);
        }

        const initialStatus = isCod ? 'Confirmed' : 'Pending';

        // 9. Save Lab Booking Document
        const newBooking = await LabBooking.create({
            bookingId,
            userId,
            labId,
            bookingType: 'Direct',
            patients: rawPatients.length > 0 ? rawPatients : [{ patientId: 'Self', name: req.user?.name || 'Self', age: 30, gender: 'Male' }],
            items: {
                tests: testItems,
                packages: packageItems
            },
            collectionType,
            address: parsedAddress || {},
            appointmentDate: finalAppointmentDate,
            appointmentTime: finalAppointmentTime,
            billSummary: {
                itemTotal: Math.round(multipliedTotal),
                itemDiscount: 0,
                appliedCoupon: appliedCouponObj,
                couponDiscount: Math.round(couponDiscount),
                homeVisitCharge: finalHomeCollectionCharge,
                distanceCharge: 0,
                rapidDeliveryCharge: Math.round(fastReportCharge),
                totalAmount
            },
            paymentMethod,
            paymentStatus: 'Pending',
            status: initialStatus,
            tracking: {
                otp: Math.floor(100000 + Math.random() * 900000).toString()
            }
        });

        // 10. For COD / Zero-Amount Orders: Deduct Quota, Clear Cart & Alert Vendor
        if (isCod || totalAmount === 0) {
            if (deliveryBenefit.isApplied) {
                await deductBenefitCount(userId, 'freeLabDeliveriesCount');
            }

            if (appliedCouponObj?.couponId) {
                await Coupon.findByIdAndUpdate(appliedCouponObj.couponId, {
                    $push: { usedBy: { userId, usageCount: 1 } }
                });
            }

            await Cart.findOneAndUpdate(
                { userId },
                { $set: { "labCart.items": [], "labCart.labId": null, "labCart.categoryType": null, "labCart.selectedPatients": [] } }
            );

            try {
                await notifyAdminsAndVendor(
                    labId,
                    'lab',
                    "🧪 New Lab Booking Placed (COD)!",
                    `Booking #${bookingId} received for ₹${totalAmount}. Collection: ${collectionType}.`,
                    { bookingId: newBooking._id.toString(), orderId: bookingId, type: 'new_lab_booking' }
                );
            } catch (e) {}

            return res.status(201).json({
                success: true,
                message: "Lab booking placed successfully!",
                bookingId: newBooking.bookingId,
                pickupOtp: newBooking.tracking?.otp,
                data: newBooking
            });
        }

        // 11. Online Payment Response
        return res.status(201).json({
            success: true,
            message: "Razorpay order initialized. Complete payment to confirm booking.",
            key_id: process.env.RAZORPAY_KEY_ID,
            amount: rzpOrder.amount,
            razorpayOrderId: rzpOrder.id,
            bookingId: newBooking.bookingId,
            bookingMongoId: newBooking._id,
            status: "Pending",
            data: newBooking
        });

    } catch (error) {
        console.error("bookLabTest Error:", error);
        res.status(500).json({ success: false, message: error.message || "Internal Server Error in lab booking." });
    }
};


// 5. UPLOAD PRESCRIPTION FLOW (Figma logic)
const uploadPrescriptionFlow = async (req, res) => {
    try {
        const { labId, patients, collectionType, address } = req.body;
        if (!req.files || req.files.length === 0) return res.status(400).json({ message: "Please upload prescription image" });

        const images = req.files.map(f => f.path);
        
        const presc = await Prescription.create({
            userId: req.user.id,
            prescriptionImages: images,
            isManualUpload: true
        });

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

        // 🚨 Trigger Notification for Lab Prescription reviews
        await notifyAdminsAndVendor(
            labId,
            'lab',
            "New Lab Prescription Inquiry!",
            `Prescription upload for inquiry #${booking.bookingId} is pending manual review.`,
            { bookingId: booking._id.toString(), type: 'lab_prescription_review' }
        );

        res.json({ success: true, message: "Lab will review and suggest tests", bookingId: booking.bookingId });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// @desc    Get User Lab Bookings History with Full Breakdown & Status Badges
// @route   GET /user/labs/my-bookings
// @access  Private (User)
const getMyBookings = async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        const { status, page = 1, limit = 10 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let query = { userId };
        if (status && status !== 'All') {
            query.status = status;
        }

        const totalBookings = await LabBooking.countDocuments(query);
        const bookings = await LabBooking.find(query)
            .populate('labId', 'name address phone city profileImage rating')
            .populate('phlebotomistId', 'name phone vehicleNumber profilePic vehicleType')
            .populate('items.tests.testId', 'testName sampleType mainCategory')
            .populate('items.packages.packageId', 'packageName sampleTypes mainCategory')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const formattedBookings = bookings.map(booking => {
            const isExpress = Number(booking.billSummary?.rapidDeliveryCharge || 0) > 0;
            const isHomeCollection = booking.collectionType === 'Home Collection';

            return {
                _id: booking._id,
                bookingId: booking.bookingId,
                status: booking.status,
                paymentStatus: booking.paymentStatus,
                paymentMethod: booking.paymentMethod || 'Online',
                isCod: (booking.paymentMethod === 'COD'),
                orderType: booking.bookingType || 'Direct',
                createdAt: booking.createdAt,
                formattedDate: moment(booking.createdAt).format('DD MMM YYYY, hh:mm A'),

                // 1. Service & Collection Mode Details
                collectionType: booking.collectionType,
                deliveryMode: {
                    type: isHomeCollection ? (isExpress ? 'EXPRESS_HOME' : 'STANDARD_HOME') : (isExpress ? 'EXPRESS_WALKIN' : 'STANDARD_WALKIN'),
                    label: isHomeCollection ? (isExpress ? 'Home Collection (Fast Report)' : 'Home Collection') : (isExpress ? 'Visit Lab (Fast Report)' : 'Visit Lab (Walk-in)'),
                    isExpressReporting: isExpress,
                    fastReportCharge: booking.billSummary?.rapidDeliveryCharge || 0,
                    homeCollectionCharge: booking.billSummary?.homeVisitCharge || 0
                },

                // 2. Scheduled Timings
                schedule: {
                    date: booking.appointmentDate ? moment(booking.appointmentDate).format('YYYY-MM-DD') : null,
                    formattedDate: booking.appointmentDate ? moment(booking.appointmentDate).format('DD MMM YYYY') : null,
                    timeSlot: booking.appointmentTime || "Standard Slot"
                },

                // 3. Complete Bill Breakdown (Exact Multiplier & Charges Matching Screenshot)
                billSummary: {
                    baseTestsTotal: Number(booking.billSummary?.itemTotal || 0),
                    patientMultiplier: booking.patients?.length || 1,
                    multipliedTotal: Number(booking.billSummary?.itemTotal || 0),
                    homeSampleCollectionCharge: Number(booking.billSummary?.homeVisitCharge || 0),
                    fastReportCharge: Number(booking.billSummary?.rapidDeliveryCharge || 0),
                    couponDiscount: Number(booking.billSummary?.couponDiscount || 0),
                    totalAmount: Number(booking.billSummary?.totalAmount || 0)
                },

                // 4. Lab Details
                lab: {
                    id: booking.labId?._id || null,
                    name: booking.labId?.name || "Diagnostic Lab",
                    address: booking.labId?.address || "",
                    city: booking.labId?.city || "",
                    phone: booking.labId?.phone || "",
                    image: booking.labId?.profileImage || null,
                    rating: booking.labId?.rating || 4.8
                },

                // 5. Phlebotomist Details (if assigned)
                phlebotomist: booking.phlebotomistId ? {
                    id: booking.phlebotomistId._id,
                    name: booking.phlebotomistId.name,
                    phone: booking.phlebotomistId.phone,
                    vehicleNumber: booking.phlebotomistId.vehicleNumber,
                    profilePic: booking.phlebotomistId.profilePic
                } : null,

                pickupOtp: booking.tracking?.otp || null,
                reportFile: booking.reportFile || null,
                patientReports: booking.patientReports || [],
                patients: booking.patients || [],
                items: booking.items || {},
                deliveryAddress: booking.address || null
            };
        });

        res.status(200).json({
            success: true,
            totalBookings,
            totalPages: Math.ceil(totalBookings / parseInt(limit)),
            currentPage: parseInt(page),
            data: formattedBookings
        });

    } catch (error) {
        console.error("getMyBookings Error:", error);
        res.status(500).json({ success: false, message: error.message || "Internal Server Error in lab bookings history." });
    }
};

// @desc    Get Detailed Live Tracking Timeline & Diagnostic Report for Lab Order
// @route   GET /user/labs/details/:id/track
// @access  Private (User)
const getBookingDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id || req.user?._id;

        const isObjectId = mongoose.isValidObjectId(id);
        const query = {
            userId,
            $or: [
                { _id: isObjectId ? new mongoose.Types.ObjectId(id) : new mongoose.Types.ObjectId() },
                { bookingId: String(id).trim() }
            ]
        };

        const booking = await LabBooking.findOne(query)
            .populate('labId', 'name address phone city profileImage rating location')
            .populate('phlebotomistId', 'name phone vehicleNumber profilePic vehicleType location')
            .populate('items.tests.testId', 'testName sampleType mainCategory')
            .populate('items.packages.packageId', 'packageName sampleTypes mainCategory')
            .lean();

        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        const isExpress = Number(booking.billSummary?.rapidDeliveryCharge || 0) > 0;
        const isHome = booking.collectionType === 'Home Collection';

        // 5-Step Diagnostic Tracking Timeline
        const trackingTimeline = [
            {
                step: 1,
                title: "Booking Confirmed",
                description: `Order placed via ${booking.paymentMethod || 'Online'}`,
                time: booking.createdAt,
                isCompleted: true,
                isCurrent: booking.status === 'Confirmed'
            },
            {
                step: 2,
                title: isHome ? "Phlebotomist Assigned" : "Lab Desk Ready",
                description: booking.phlebotomistId ? `Phlebotomist ${booking.phlebotomistId.name} assigned` : "Awaiting sample arrival",
                time: booking.startedAt || null,
                isCompleted: ['Phlebotomist Assigned', 'Sample Collected', 'Sample Deposited', 'Testing', 'Report Generated', 'Completed'].includes(booking.status),
                isCurrent: booking.status === 'Phlebotomist Assigned'
            },
            {
                step: 3,
                title: "Sample Collected",
                description: isHome ? "Blood/urine sample collected at doorstep" : "Sample submitted at lab counter",
                time: booking.collectedAt || null,
                isCompleted: ['Sample Collected', 'Sample Deposited', 'Testing', 'Report Generated', 'Completed'].includes(booking.status),
                isCurrent: booking.status === 'Sample Collected'
            },
            {
                step: 4,
                title: isExpress ? "Fast Express Testing (In Progress)" : "Testing in Progress",
                description: "Sample undergoing automated clinical analyzer testing",
                time: booking.depositedAt || null,
                isCompleted: ['Testing', 'Report Generated', 'Completed'].includes(booking.status),
                isCurrent: ['Sample Deposited', 'Testing'].includes(booking.status)
            },
            {
                step: 5,
                title: "Digital Report Ready",
                description: "Pathologist verified report generated",
                time: booking.status === 'Completed' ? booking.updatedAt : null,
                isCompleted: ['Report Generated', 'Completed'].includes(booking.status),
                isCurrent: ['Report Generated', 'Completed'].includes(booking.status)
            }
        ];

        res.status(200).json({
            success: true,
            data: {
                _id: booking._id,
                bookingId: booking.bookingId,
                status: booking.status,
                paymentStatus: booking.paymentStatus,
                paymentMethod: booking.paymentMethod || 'Online',
                isCod: (booking.paymentMethod === 'COD'),
                collectionType: booking.collectionType,
                isExpressReporting: isExpress,

                // Schedule
                schedule: {
                    date: booking.appointmentDate ? moment(booking.appointmentDate).format('YYYY-MM-DD') : null,
                    formattedDate: booking.appointmentDate ? moment(booking.appointmentDate).format('DD MMM YYYY') : null,
                    timeSlot: booking.appointmentTime || "Standard Slot"
                },

                // Bill Summary
                billSummary: {
                    baseTestsTotal: Number(booking.billSummary?.itemTotal || 0),
                    patientMultiplier: booking.patients?.length || 1,
                    multipliedTotal: Number(booking.billSummary?.itemTotal || 0),
                    homeSampleCollectionCharge: Number(booking.billSummary?.homeVisitCharge || 0),
                    fastReportCharge: Number(booking.billSummary?.rapidDeliveryCharge || 0),
                    couponDiscount: Number(booking.billSummary?.couponDiscount || 0),
                    totalAmount: Number(booking.billSummary?.totalAmount || 0)
                },

                // Lab Info
                lab: {
                    id: booking.labId?._id || null,
                    name: booking.labId?.name || "Diagnostic Lab",
                    address: booking.labId?.address || "",
                    city: booking.labId?.city || "",
                    phone: booking.labId?.phone || "",
                    image: booking.labId?.profileImage || null,
                    rating: booking.labId?.rating || 4.8,
                    location: booking.labId?.location || { lat: 0, lng: 0 }
                },

                // Assigned Phlebotomist
                phlebotomist: booking.phlebotomistId ? {
                    id: booking.phlebotomistId._id,
                    name: booking.phlebotomistId.name,
                    phone: booking.phlebotomistId.phone,
                    vehicleNumber: booking.phlebotomistId.vehicleNumber,
                    profilePic: booking.phlebotomistId.profilePic,
                    currentLocation: booking.phlebotomistId.location || { lat: 0, lng: 0 }
                } : null,

                pickupOtp: booking.tracking?.otp || null,
                reportFile: booking.reportFile || null,
                patientReports: booking.patientReports || [],
                patients: booking.patients || [],
                items: booking.items || {},
                deliveryAddress: booking.address || null,
                trackingTimeline
            }
        });

    } catch (error) {
        console.error("getBookingDetails Error:", error);
        res.status(500).json({ success: false, message: error.message || "Internal Server Error in tracking lab booking." });
    }
};
// 8. CANCEL BOOKING (User Side)
const cancelBooking = async (req, res) => {
    try {
        const { reason } = req.body;
        const booking = await LabBooking.findOne({ _id: req.params.id, userId: req.user.id });

        if (!booking) return res.status(404).json({ success: false, message: "Booking not found." });

        const terminalStates = ['Testing', 'Report Generated', 'Completed', 'Cancelled', 'No-Show'];
        if (terminalStates.includes(booking.status)) {
            return res.status(400).json({ success: false, message: "Cannot cancel booking in its current state." });
        }

        // 🚨 DYNAMIC POLICY EVALUATION (Checks if phlebotomist has started the trip)
        const policyResult = await processCancellationRefund(booking, 'Lab');

        booking.status = 'Cancelled';
        booking.cancelReason = reason || "Cancelled by User";
        
        if (!booking.billSummary) booking.billSummary = {};
        booking.billSummary.cancellationFeeApplied = policyResult.cancellationFee;
        booking.paymentStatus = policyResult.cancellationFee > 0 ? 'Refund-Initiated' : 'Refunded';

        await booking.save();

        // Subscription benefit refund check
        if (booking.collectionType === 'Home Collection' && booking.billSummary?.homeVisitCharge === 0) {
            await refundBenefitCount(booking.userId, 'freeLabDeliveriesCount');
        }

        res.json({ 
            success: true, 
            message: policyResult.cancellationFee > 0
                ? `Booking cancelled successfully. A cancellation fee of ₹${policyResult.cancellationFee} was applied.`
                : "Booking cancelled successfully. No charges applied.",
            data: {
                cancellationFee: policyResult.cancellationFee,
                refundAmount: policyResult.refundAmount,
                booking
            }
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 9. CONFIRM SUGGESTED TESTS (Prescription Flow - Replacing confirmPrescriptionBooking)
const confirmPrescriptionBooking = async (req, res) => {
    try {
        const { bookingId, appointmentDate, appointmentTime, address, paymentMethod, couponCode } = req.body;
        
        const booking = await LabBooking.findOne({ _id: bookingId, userId: req.user.id });
        if (!booking || booking.status !== 'Tests Added') {
            return res.status(400).json({ message: "Invalid booking or tests not yet added by Lab" });
        }

        const bill = await calculateBill(
            booking.labId, 
            booking.items, 
            booking.patients.length, 
            booking.collectionType, 
            couponCode, 
            false 
        );

        let rzpOrder = null;
        if (paymentMethod !== 'COD') {
            rzpOrder = await createRazorpayOrder(bill.totalAmount, `receipt_${booking.bookingId}`);
        }

        booking.appointmentDate = appointmentDate;
        booking.appointmentTime = appointmentTime;
        booking.address = address;
        booking.billSummary = bill;
        booking.paymentMethod = paymentMethod;
        booking.status = paymentMethod === 'COD' ? 'Confirmed' : 'Pending';
        booking.paymentStatus = 'Pending';
        
        await booking.save();

        if (paymentMethod === 'COD') {
            // 🚨 Trigger Notification for Prescription Bookings Confirmed via COD
            await notifyAdminsAndVendor(
                booking.labId,
                'lab',
                "Prescription Booking Confirmed (COD)!",
                `Prescription order #${booking.bookingId} has been successfully confirmed.`,
                { bookingId: booking._id.toString(), type: 'new_lab_booking' }
            );

            return res.json({ success: true, message: "Booking confirmed!", data: booking });
        }

        res.json({
            success: true,
            message: "Razorpay order created for prescription booking.",
            key_id: process.env.RAZORPAY_KEY_ID,
            amount: rzpOrder.amount,
            razorpayOrderId: rzpOrder.id,
            appointmentId: booking._id
        });

    } catch (error) { res.status(500).json({ message: error.message }); }
};


// endpoint: POST /user/labs/verify-payment
const verifyLabPayment = async (req, res) => {
    console.log(`\n==================================================================`);
    console.log(`💳 [DEBUG: verifyLabPayment] -> INCOMING PAYMENT VERIFICATION`);
    console.log(`👤 User ID        :`, req.user?.id || req.user?._id);
    console.log(`📦 Request Body   :`, JSON.stringify(req.body, null, 2));
    console.log(`==================================================================`);

    try {
        const userId = req.user?.id || req.user?._id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "User not authenticated." });
        }

        // Universal Body Resolver (Supports root keys and nested SDK callbacks)
        let body = req.body || {};
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) {}
        }
        if (body.response && typeof body.response === 'object') {
            body = { ...body, ...body.response };
        }
        if (body.data && typeof body.data === 'object') {
            body = { ...body, ...body.data };
        }
        if (body.paymentDetails && typeof body.paymentDetails === 'object') {
            body = { ...body, ...body.paymentDetails };
        }

        const rzpPaymentId = body.razorpay_payment_id || 
                             body.razorpayPaymentId || 
                             body.paymentId || 
                             body.payment_id;

        const rzpOrderId = body.razorpay_order_id || 
                           body.razorpayOrderId || 
                           body.orderId || 
                           body.order_id;

        const rzpSignature = body.razorpay_signature || 
                             body.razorpaySignature || 
                             body.signature;

        const targetBookingId = body.bookingId || 
                                body.bookingMongoId || 
                                body.appointmentId || 
                                body.id || 
                                body._id;

        if (!rzpPaymentId) {
            console.error("❌ [DEBUG: verifyLabPayment] Failed: Missing razorpayPaymentId / razorpay_payment_id");
            return res.status(400).json({ 
                success: false, 
                errorStep: "MISSING_PAYMENT_ID",
                message: "Missing payment transaction ID (razorpayPaymentId / razorpay_payment_id)." 
            });
        }

        // Find Target Booking Document
        const isObjectId = mongoose.isValidObjectId(targetBookingId);
        const searchConditions = [];

        if (isObjectId) {
            searchConditions.push({ _id: new mongoose.Types.ObjectId(targetBookingId) });
        }
        if (targetBookingId) {
            searchConditions.push({ bookingId: String(targetBookingId).trim() });
        }
        if (rzpOrderId) {
            searchConditions.push({ "paymentDetails.razorpayOrderId": String(rzpOrderId).trim() });
        }

        let booking = null;
        if (searchConditions.length > 0) {
            booking = await LabBooking.findOne({
                userId,
                $or: searchConditions
            });
        }

        // Fallback: Find user's most recent Pending lab booking
        if (!booking) {
            booking = await LabBooking.findOne({
                userId,
                status: 'Pending',
                paymentStatus: 'Pending'
            }).sort({ createdAt: -1 });
        }

        if (!booking) {
            console.error("❌ [DEBUG: verifyLabPayment] Failed: No booking found for verification.");
            return res.status(404).json({ 
                success: false, 
                errorStep: "BOOKING_NOT_FOUND",
                message: "Lab booking record not found for verification." 
            });
        }

        console.log(`✅ [DEBUG: verifyLabPayment] Step 1: Found Booking #${booking.bookingId} (ID: ${booking._id})`);

        // Cryptographic Signature Verification
        let isVerified = false;
        if (rzpOrderId && rzpSignature) {
            isVerified = verifyRazorpaySignature(rzpOrderId, rzpPaymentId, rzpSignature);
        }

        // Dev sandbox bypass
        if (!isVerified && (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV)) {
            console.warn("⚠️ [DEV NOTICE]: Razorpay signature check bypassed in development environment.");
            isVerified = true;
        }

        if (!isVerified && process.env.NODE_ENV === 'production') {
            console.error("❌ [DEBUG: verifyLabPayment] Failed: Signature Mismatch in Production.");
            return res.status(400).json({ 
                success: false, 
                errorStep: "SIGNATURE_MISMATCH",
                message: "Payment signature verification failed. Invalid transaction signature." 
            });
        }

        // Map Payment Record
        let paymentRecord = null;
        try {
            if (rzpSignature) {
                paymentRecord = await fetchAndMapRazorpayPayment(rzpPaymentId, rzpSignature);
            }
        } catch (fetchErr) {
            console.warn("⚠️ Razorpay fetch details warning:", fetchErr.message);
        }

        if (!paymentRecord) {
            paymentRecord = {
                razorpayPaymentId: rzpPaymentId,
                razorpayOrderId: rzpOrderId || "",
                razorpaySignature: rzpSignature || "",
                method: 'Online',
                amount: Number(booking.billSummary?.totalAmount || 0),
                currency: "INR",
                status: 'captured',
                paidAt: new Date()
            };
        }

        // Save Booking Status
        booking.status = 'Confirmed';
        booking.paymentStatus = 'Paid';
        booking.paymentMethod = paymentRecord.method || 'Online';
        booking.paymentDetails = paymentRecord;
        booking.tracking = {
            otp: Math.floor(100000 + Math.random() * 900000).toString()
        };
        await booking.save();

        console.log(`✅ [DEBUG: verifyLabPayment] Step 2: Booking #${booking.bookingId} successfully confirmed & saved.`);

        // Deduct Subscription Quota if Free Delivery was applied
        if (booking.billSummary?.deliveryCharge === 0 && booking.collectionType === 'Home Collection') {
            await deductBenefitCount(userId, 'freeLabDeliveriesCount');
            console.log(`✨ [DEBUG: verifyLabPayment] Deducted 1 free lab delivery count.`);
        }

        // Update Coupon Usage
        if (booking.billSummary?.appliedCoupon?.couponId) {
            await Coupon.findByIdAndUpdate(booking.billSummary.appliedCoupon.couponId, {
                $push: { usedBy: { userId, usageCount: 1 } }
            });
        }

        // Auto-Clear Lab Cart
        await Cart.findOneAndUpdate(
            { userId },
            { 
                $set: { 
                    "labCart.items": [], 
                    "labCart.labId": null, 
                    "labCart.categoryType": null,
                    "labCart.selectedPatients": []
                } 
            }
        );
        console.log(`🧹 [DEBUG: verifyLabPayment] Lab cart cleared.`);

        // Real-Time Notification to Lab
        try {
            await notifyAdminsAndVendor(
                booking.labId,
                'lab',
                "🧪 New Lab Booking Paid & Confirmed!",
                `Booking #${booking.bookingId} for ₹${booking.billSummary.totalAmount} has been confirmed.`,
                { bookingId: booking._id.toString(), orderId: booking.bookingId, type: 'new_lab_booking' }
            );
        } catch (notifErr) {}

        return res.status(200).json({
            success: true,
            message: "Payment successfully verified and lab booking confirmed!",
            bookingId: booking.bookingId,
            pickupOtp: booking.tracking.otp,
            data: booking
        });

    } catch (error) {
        console.error("🚨 [DEBUG: verifyLabPayment EXCEPTION]:", error);
        return res.status(500).json({ 
            success: false, 
            message: error.message || "Internal Server Error during payment verification." 
        });
    }
};


// 10. ADD RATING & REVIEW
const rateLabOrder = async (req, res) => {
    try {
        const { bookingId, rating, comment } = req.body;
        
        // Ensure rating is valid
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, message: "Valid rating (1 to 5) is required." });
        }

        const booking = await LabBooking.findById(bookingId);

        if (!booking || booking.status !== 'Completed') {
            return res.status(400).json({ success: false, message: "You can only rate completed lab bookings." });
        }

        // A. Duplicate review validation check
        const existingReview = await Review.findOne({ userId: req.user.id, orderId: bookingId });
        if (existingReview) {
            return res.status(400).json({ success: false, message: "You have already submitted a review for this diagnostic order." });
        }

        // B. Create Polymorphic Review record
        await Review.create({
            userId: req.user.id,
            userName: req.user.name || "Verified User",
            targetId: booking.labId, // Target Lab ID
            targetType: 'Lab', // Polymorphic reference tag
            orderId: bookingId,
            rating,
            comment: comment || ""
        });

        // C. Dynamic Aggregation: Recalculate average rating & total reviews
        const stats = await Review.aggregate([
            { $match: { targetId: booking.labId, targetType: 'Lab' } },
            {
                $group: {
                    _id: null,
                    averageRating: { $avg: "$rating" },
                    totalReviews: { $sum: 1 }
                }
            }
        ]);

        if (stats.length > 0) {
            const newRating = Number(stats[0].averageRating.toFixed(1));
            const totalReviews = stats[0].totalReviews;

            // Cache metrics in Lab document for ultra-fast listings reads
            await Lab.findByIdAndUpdate(booking.labId, {
                rating: newRating,
                totalReviews: totalReviews
            });
        }

        res.json({ success: true, message: "Thank you for sharing your diagnostics experience!" });

    } catch (error) { 
        console.error("Rate Lab Order Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- 11. GET UNIVERSAL PAGINATED REVIEWS (Strictly 25 items per page) ---
// GET /user/labs/reviews/:targetType/:targetId?page=1
const getPaginatedReviews = async (req, res) => {
    try {
        const { targetType, targetId } = req.params; // targetType e.g., 'Lab', 'Doctor', 'Hospital'
        const page = parseInt(req.query.page) || 1;
        const limit = 25; // strictly paginated by 25 as requested
        const skip = (page - 1) * limit;

        // Validation for Polymorphic target Types
        const allowedTypes = ['Doctor', 'Lab', 'Pharmacy', 'Nurse', 'Hospital', 'Ambulance', 'Driver'];
        if (!allowedTypes.includes(targetType)) {
            return res.status(400).json({ success: false, message: "Invalid target type for reviews." });
        }

        if (!mongoose.Types.ObjectId.isValid(targetId)) {
            return res.status(400).json({ success: false, message: "Invalid target ID." });
        }

        const query = {
            targetId: new mongoose.Types.ObjectId(targetId),
            targetType: targetType
        };

        // Parallel count and find operations
        const [reviews, total] = await Promise.all([
            Review.find(query)
                .select('userName rating comment createdAt')
                .sort({ createdAt: -1 }) // Newest reviews first
                .skip(skip)
                .limit(limit)
                .lean(),
            Review.countDocuments(query)
        ]);

        res.json({
            success: true,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            limit,
            data: reviews
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Helper mapping for polymorphic models updates
const getModelByTargetType = (type) => {
    const models = {
        'Doctor': Doctor,
        'Hospital': Hospital,
        'Lab': Lab,
        'Pharmacy': Pharmacy,
        'Nurse': Nurse,
        'Ambulance': Ambulance,
        'Driver': Driver
    };
    return models[type] || null;
};


// --- DYNAMIC RATING RECALCULATOR HELPER ---
const recalculateTargetRating = async (targetId, targetType) => {
    const stats = await Review.aggregate([
        { $match: { targetId: new mongoose.Types.ObjectId(targetId), targetType } },
        {
            $group: {
                _id: null,
                averageRating: { $avg: "$rating" },
                totalReviews: { $sum: 1 }
            }
        }
    ]);

    if (stats.length > 0) {
        const newRating = Number(stats[0].averageRating.toFixed(1));
        const totalReviews = stats[0].totalReviews;

        const TargetModel = getModelByTargetType(targetType);
        if (TargetModel) {
            await TargetModel.findByIdAndUpdate(targetId, {
                rating: newRating,
                totalReviews: totalReviews
            });
        }
    }
};

// --- 13. UPDATE REVIEW VIA ORDER ID (Figma: Edit feedback from Order history) ---
// PUT /user/labs/review/update-by-order/:orderId
const updateReviewByOrderId = async (req, res) => {
    try {
        const { orderId } = req.params; // Booking/Order MongoDB _id
        const { rating, comment } = req.body;

        if (rating && (rating < 1 || rating > 5)) {
            return res.status(400).json({ success: false, message: "Valid rating (1 to 5) is required." });
        }

        if (!mongoose.Types.ObjectId.isValid(orderId)) {
            return res.status(400).json({ success: false, message: "Invalid order/booking ID format." });
        }

        // Find review directly using orderId and userId
        const review = await Review.findOne({ orderId: new mongoose.Types.ObjectId(orderId), userId: req.user.id });
        if (!review) {
            return res.status(404).json({ success: false, message: "No review found registered for this order." });
        }

        // Apply changes
        if (rating) review.rating = rating;
        if (comment !== undefined) review.comment = comment;
        await review.save();

        // Recalculate average rating for the target vendor
        await recalculateTargetRating(review.targetId, review.targetType);

        res.json({
            success: true,
            message: "Review successfully updated via Order ID and ratings synchronized.",
            data: review
        });

    } catch (error) {
        console.error("Update Review By Order Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 14. UPDATE REVIEW VIA VENDOR/TARGET ID & ORDER ID ---
// PUT /user/labs/review/update-by-vendor/:targetId
const updateReviewByVendorId = async (req, res) => {
    try {
        const { targetId } = req.params; // Vendor/Target MongoDB _id
        const { orderId, rating, comment } = req.body; // Order ID passed in body

        if (!mongoose.Types.ObjectId.isValid(targetId) || !mongoose.Types.ObjectId.isValid(orderId)) {
            return res.status(400).json({ success: false, message: "Invalid dynamic ObjectId formats." });
        }

        if (rating && (rating < 1 || rating > 5)) {
            return res.status(400).json({ success: false, message: "Valid rating (1 to 5) is required." });
        }

        // Find review using targetId, orderId and userId
        const review = await Review.findOne({
            targetId: new mongoose.Types.ObjectId(targetId),
            orderId: new mongoose.Types.ObjectId(orderId),
            userId: req.user.id
        });

        if (!review) {
            return res.status(404).json({ success: false, message: "No matching review found for this vendor and order." });
        }

        // Apply changes
        if (rating) review.rating = rating;
        if (comment !== undefined) review.comment = comment;
        await review.save();

        // Recalculate average rating for the target vendor
        await recalculateTargetRating(review.targetId, review.targetType);

        res.json({
            success: true,
            message: "Review successfully updated via Vendor ID and ratings synchronized.",
            data: review
        });

    } catch (error) {
        console.error("Update Review By Vendor Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 15. GET REVIEW BY ORDER ID (To check if user already reviewed a booking) ---
// GET /user/labs/review/by-order/:orderId
const getReviewByOrderId = async (req, res) => {
    try {
        const { orderId } = req.params; // Booking/Order MongoDB _id

        if (!mongoose.Types.ObjectId.isValid(orderId)) {
            return res.status(400).json({ success: false, message: "Invalid order/booking ID format." });
        }

        // Search strictly for the logged-in user's review for this specific order
        const review = await Review.findOne({ 
            orderId: new mongoose.Types.ObjectId(orderId), 
            userId: req.user.id 
        }).lean();

        if (!review) {
            // Case A: Agar user ne is booking par koi review nahi diya hai
            return res.json({
                success: true,
                hasReviewed: false,
                message: "No review has been submitted for this order yet.",
                data: null
            });
        }

        // Case B: Agar review pehle se database me exist karta hai
        res.json({
            success: true,
            hasReviewed: true,
            message: "Review found for this order.",
            data: review
        });

    } catch (error) {
        console.error("Get Review By Order Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
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
        const { id } = req.params;
        const { lat, lng } = req.body; // Location from Flutter

        // 1. Fetch Master Test Info
        const masterData = await MasterLabTest.findById(id).lean();
        if (!masterData) return res.status(404).json({ success: false, message: "Test not found" });

        // 2. KM Limit Config (Matches getLabs)
        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Lab', isActive: true });
        const maxRadius = limitConfig ? limitConfig.kmLimit : 100;

        // 3. Fetch Labs offering this test
        const labsOffering = await LabTest.find({ masterTestId: id, isActive: true })
            .populate('labId', 'name profileImage rating totalReviews location city state address isHomeCollectionAvailable isRapidServiceAvailable isActive profileStatus')
            .lean();

        const availableInLabs = [];

        for (let item of labsOffering) {
            // Sirf Approved aur Active Labs dikhayein
            if (item.labId?.profileStatus !== 'Approved' || !item.labId?.isActive) continue;

            let distance = null;
            if (lat && lng && item.labId?.location?.lat) {
                distance = await getDistance(lat, lng, item.labId.location.lat, item.labId.location.lng);
            }

            // --- RADIUS LOGIC (Matches getLabs) ---
            // Agar Lat/Lng diya hai toh Radius check hoga, warna Broad Search (All Labs)
            const isBroadSearch = !lat || !lng;

            if (isBroadSearch || distance <= maxRadius) {
                availableInLabs.push({
                    labId: item.labId?._id,
                    name: item.labId?.name,
                    image: item.labId?.profileImage,
                    rating: item.labId?.rating,
                    totalReviews: item.labId?.totalReviews,
                    address: `${item.labId?.city}, ${item.labId?.state}`,
                    distance: distance ? distance.toFixed(1) : "N/A",
                    discountPrice: item.discountPrice,
                    amount: item.amount,
                    discount: item.amount > 0 ? Math.round(((item.amount - item.discountPrice) / item.amount) * 100) : 0,
                    isHomeCollection: item.labId?.isHomeCollectionAvailable,
                    isRapid: item.labId?.isRapidServiceAvailable,
                    labTestId: item._id 
                });
            }
        }

        // Sorting: Nearest First
        availableInLabs.sort((a, b) => {
            if (a.distance === "N/A") return 1;
            if (b.distance === "N/A") return -1;
            return parseFloat(a.distance) - parseFloat(b.distance);
        });

        res.json({
            success: true,
            radiusApplied: lat ? `${maxRadius} km` : "No GPS (Broad Search)",
            data: { testDetails: masterData, availableInLabs: availableInLabs }
        });

    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. POST /user/labs/master-package/:id
const getMasterPackageDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const { lat, lng } = req.body;

        // 🚨 Validate if ObjectId format is correct to prevent server crashes
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid ID format." });
        }

        const targetId = new mongoose.Types.ObjectId(id);
        let masterData = null;
        let queryCriteria = {};

        // 🚨 STEP 1: Pehle check karein kya yeh ID listed custom/standard "LabPackage" ki hai?
        const labPkg = await LabPackage.findById(targetId)
            .populate({ path: 'tests', model: 'MasterLabTest', select: 'testName parameters' })
            .populate('masterPackageId')
            .lean();

        if (labPkg) {
            // CASE A: User clicked on a listed package from a specific Lab profile [cite: labPackageSchema]
            if (labPkg.isCustom) {
                // Custom package has no masterPackageId, so map LabPackage fields to standard MasterLabPackage structure [cite: labPackageSchema]
                masterData = {
                    _id: labPkg._id,
                    packageName: labPkg.packageName,
                    shortDescription: labPkg.shortDescription || "",
                    longDescription: labPkg.longDescription || "",
                    mainCategory: labPkg.mainCategory || "Pathology",
                    category: labPkg.category || "",
                    tests: labPkg.tests || [],
                    sampleTypes: labPkg.sampleTypes || labPkg.sampleType || [],
                    reportTime: labPkg.reportTime || "24 Hours",
                    isFastingRequired: labPkg.isFastingRequired || false,
                    fastingDuration: labPkg.fastingDuration || "",
                    preparations: labPkg.preparations || [],
                    detailedDescription: labPkg.detailedDescription || [],
                    faqs: labPkg.faqs || [],
                    gender: labPkg.gender || "Both",
                    ageGroup: labPkg.ageGroup || "All",
                    tags: labPkg.tags || [],
                    lifestyleTags: labPkg.lifestyleTags || [],
                    packageImage: labPkg.packageImage || null,
                    standardMRP: labPkg.mrp,
                    isCustom: true // 👈 Dynamic flag
                };
                
                // Since this is custom to one lab, search criteria is only for this specific package [cite: saveLabPackage]
                queryCriteria = { _id: labPkg._id };
            } else {
                // If Standard Template Package listed by lab, load the original master catalog document
                const masterPkgId = labPkg.masterPackageId?._id || labPkg.masterPackageId;
                masterData = await MasterLabPackage.findById(masterPkgId).populate('tests', 'testName parameters').lean();
                if (!masterData) {
                    return res.status(404).json({ success: false, message: "Master template of this listed package not found." });
                }
                queryCriteria = {
                    $or: [
                        { masterPackageId: masterPkgId },
                        { packageName: masterData.packageName }
                    ]
                };
            }
        } else {
            // CASE B: User clicked on a Global Standard Catalog package directly (ID belongs to MasterLabPackage) [cite: getMasterPackageDetails]
            masterData = await MasterLabPackage.findById(targetId).populate('tests', 'testName parameters').lean();
            if (!masterData) {
                return res.status(404).json({ success: false, message: "Master Package not found" }); // Mapped exactly to original error message [cite: getMasterPackageDetails]
            }
            queryCriteria = {
                $or: [
                    { masterPackageId: targetId },
                    { packageName: masterData.packageName }
                ]
            };
        }

        // 2. Fetch KM Limit
        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Lab', isActive: true });
        const maxRadius = limitConfig ? limitConfig.kmLimit : 100;

        // 3. Find all active labs offering this package (custom or standard)
        const labsPackages = await LabPackage.find({
            ...queryCriteria,
            isActive: true 
        })
        .populate({
            path: 'labId',
            match: { profileStatus: 'Approved', isActive: true }
        })
        .lean();

        const availableInLabs = [];

        for (let item of labsPackages) {
            if (!item.labId) continue;

            let distance = null;
            if (lat && lng && item.labId.location?.lat) {
                distance = await getDistance(
                    parseFloat(lat), 
                    parseFloat(lng), 
                    parseFloat(item.labId.location.lat), 
                    parseFloat(item.labId.location.lng)
                );
            }

            const isBroadSearch = !lat || !lng;
            if (isBroadSearch || (distance !== null && distance <= maxRadius)) {
                availableInLabs.push({
                    labId: item.labId._id,
                    name: item.labId.name,
                    image: item.labId.profileImage,
                    rating: item.labId.rating,
                    totalReviews: item.labId.totalReviews,
                    address: `${item.labId.city}, ${item.labId.state}`,
                    distance: distance !== null ? distance.toFixed(1) : "N/A",
                    offerPrice: item.offerPrice,
                    mrp: item.mrp,
                    discount: item.mrp > 0 ? Math.round(((item.mrp - item.offerPrice) / item.mrp) * 100) : 0,
                    isHomeCollection: item.labId.isHomeCollectionAvailable,
                    isRapid: item.labId.isRapidServiceAvailable,
                    labPackageId: item._id // 👈 Returns Listed ID for correct checkout selections
                });
            }
        }

        // Remove duplicates safely
        const uniqueLabs = [];
        const seenLabIds = new Set();
        for (let lab of availableInLabs) {
            if (!seenLabIds.has(lab.labId.toString())) {
                seenLabIds.add(lab.labId.toString());
                uniqueLabs.push(lab);
            }
        }

        uniqueLabs.sort((a, b) => (a.distance === "N/A" ? 1 : parseFloat(a.distance) - parseFloat(b.distance)));

        res.json({
            success: true,
            count: uniqueLabs.length,
            data: { 
                packageDetails: masterData, 
                availableInLabs: uniqueLabs 
            }
        });

    } catch (error) { 
        console.error("getMasterPackageDetails Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- NEW: GET PREPARATION GUIDE (Figma: Okay, I understand modal) ---
const getPreparationGuide = async (req, res) => {
    try {
        const { itemId, type } = req.query; // type: 'LabTest' or 'LabPackage'
        let data;
        if (type === 'LabTest') {
            data = await LabTest.findById(itemId).select('testName precaution');
        } else {
            data = await LabPackage.findById(itemId).select('packageName precaution');
        }
        res.json({ success: true, data });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- NEW: PERSONALIZE PACKAGE SUGGESTION (Figma: Step 1, 2, 3 flow) ---
// POST /user/labs/suggest-package
const suggestPersonalizedPackage = async (req, res) => {
    try {
        const { ageGroup, gender, symptoms, lifestyle } = req.body;
        // AgeGroup: 'Below 30', '30-55', 'Above 55'
        // Logic: Master Packages mein se filter karega jo best match ho
        
        let query = { isActive: true };
        if (gender) query.gender = { $in: [gender, 'Both'] };
        if (ageGroup) query.ageGroup = ageGroup;

        // Simple match logic (Industry standard is to match tags)
        const packages = await MasterLabPackage.find(query)
            .limit(3)
            .populate('tests');

        res.json({ 
            success: true, 
            message: "Based on your inputs, we suggest these packages", 
            data: packages 
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// not in use yet
const getTestSuggestions = async (req, res) => {
    try {
        const { query } = req.body;
        if (!query || query.length < 2) return res.json({ success: true, data: [] });

        // 1. Saare active tests fetch karein
        const allTests = await MasterLabTest.find({ isActive: true }).select('testName').lean();

        // 2. Fuse configuration
        const fuse = new Fuse(allTests, {
            keys: ['testName'],
            threshold: 0.4, 
            includeScore: true
        });

        // 3. Logic: Query ko comma (,) ya space ( ) se split karein
        // e.g. "Sugar, Thyroid" -> ["Sugar", "Thyroid"]
        const keywords = query.split(/[, ]+/).filter(k => k.trim().length > 2);

        let finalResults = [];

        if (keywords.length > 1) {
            // Har keyword ke liye alag se dhoondein
            keywords.forEach(word => {
                const matches = fuse.search(word).map(r => r.item);
                finalResults.push(...matches);
            });

            // 4. Duplicate Results Hatayein (Unique IDs only)
            const uniqueIds = new Set();
            finalResults = finalResults.filter(item => {
                const idStr = item._id.toString();
                if (!uniqueIds.has(idStr)) {
                    uniqueIds.add(idStr);
                    return true;
                }
                return false;
            });
        } else {
            // Agar single word hai toh normal search
            finalResults = fuse.search(query).map(r => r.item);
        }

        // Top 15 suggestions bhejein
        res.json({ 
            success: true, 
            count: finalResults.length, 
            data: finalResults.slice(0, 15) 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// not in use yet
const getWomenSpecialTests = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;

        // --- Strictly Women-Specific Filter ---
        const womenOnlyFilter = {
            isActive: true,
            $or: [
                // 1. Specific Female Health Tests
                { testName: { $regex: /Pap Smear|Mammography|FSH Test|LH Test|Prolactin/i } },
                
                // 2. Female Organ Imaging
                { 
                    $and: [
                        { testName: { $regex: /Ultrasound Pelvis/i } },
                        { category: "Reproductive" } 
                    ]
                }
            ]
        };

        const aggregate = MasterLabTest.aggregate([
            { $match: womenOnlyFilter },
            {
                $lookup: {
                    from: "labtests",
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
            { $sort: { testName: 1 } },
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
            data: result[0].data
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET /user/labs/women/categories
const getWomenCategories = async (req, res) => {
    try {
        // 1. Master tests se unique category names nikalen
        const womenCats = await MasterLabTest.distinct("category", {
            testName: { $regex: /Pap Smear|Mammography|FSH Test|LH Test|Prolactin|Ultrasound Pelvis/i },
            isActive: true
        });

        // 2. Database se images uthayen
        const dbCategories = await LabCategory.find({ name: { $in: womenCats } });

        // 3. Logic: Agar DB mein image hai toh 'public/' hatao, nahi toh fallback asset dikhao
        const finalData = womenCats.map(catName => {
            const dbMatch = dbCategories.find(dbCat => dbCat.name === catName);
            
            let imagePath;
            if (dbMatch && dbMatch.image) {
                // 'public/' ko string se remove karein
                imagePath = dbMatch.image.replace(/^public[\\/]/, ''); 
            } else {
                // Fallback asset path
                imagePath = `assets/images/women_${catName.toLowerCase().replace(" ", "_")}.png`;
            }

            return {
                name: catName,
                image: imagePath
            };
        });

        res.json({ success: true, data: finalData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// GET /user/labs/women/tests-by-category?category=Hormonal
const getWomenTestsByCategory = async (req, res) => {
    try {
        const { category } = req.query; 
        
        const filter = {
            category: category,
            isActive: true,
            // Strictly Women-Only tests filter
            testName: { $regex: /Pap Smear|Mammography|FSH Test|LH Test|Prolactin|Ultrasound Pelvis/i }
        };

        // Simple find ya aggregate use kar sakte hain kyunki lookup nahi chahiye
        const result = await MasterLabTest.find(filter).sort({ testName: 1 });

        res.json({ 
            success: true, 
            count: result.length, 
            data: result 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};






// ----------------------------------------------------------------
// -------------- AI Scan Prescription -----------------------------
// -----------------------------------------------------------------

// =========================================================================
// 🚀 AI PRESCRIPTION IMAGE EXTRACTOR FOR LAB TESTS
// =========================================================================
const extractLabDataWithGemini = async (filePath) => {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === ".png" ? "image/png" : "image/jpeg";

    const imageData = {
        inlineData: {
            data: Buffer.from(fs.readFileSync(filePath)).toString("base64"),
            mimeType: mimeType,
        },
    };

    const prompt = `Act as a professional medical lab technician or diagnostic expert. Extract data in STRICT JSON format: {"doctorName": "string", "date": "string", "tests": [{"name": "string"}]}`;

    const result = await model.generateContent([prompt, imageData]);
    const response = await result.response;
    const text = response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI did not return valid JSON.");
    return JSON.parse(jsonMatch[0]);
};

// 🚨 NEW: SCAN LAB PRESCRIPTION & MATCH WITH MASTER DATA
const scanLabPrescription = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "Please upload an image" });

        let aiData;
        
        // CHECK ENVIRONMENT
        if (process.env.NODE_ENV === 'production') {
            console.log("Using REAL AI Logic for Lab Prescription...");
            aiData = await extractLabDataWithGemini(req.file.path);
        } else {
            console.log("Using DEVELOPMENT MOCK Logic for Lab Prescription...");
            // Mock Response for CBC & HbA1c
            aiData = {
                doctorName: "Dr. Rajesh Sharma (Mock)",
                date: moment().format('DD-MM-YYYY'),
                tests: [
                    { name: "CBC" },
                    { name: "HbA1c" }
                ]
            };
        }

        const finalDetectedTests = [];

        // DATABASE MATCHING LOGIC (Matching with Master Tests & Packages)
        if (aiData.tests && aiData.tests.length > 0) {
            for (let testItem of aiData.tests) {
                // 1. Try to find a match in MasterLabTest
                const dbMatch = await MasterLabTest.findOne({
                    testName: { $regex: testItem.name.split(" ")[0], $options: 'i' }
                }).select('testName testCode mainCategory category standardMRP pretestPreparation').lean();

                if (dbMatch) {
                    finalDetectedTests.push({
                        masterId: dbMatch._id,
                        name: dbMatch.testName,
                        testCode: dbMatch.testCode,
                        mainCategory: dbMatch.mainCategory,
                        category: dbMatch.category,
                        standardMRP: dbMatch.standardMRP,
                        pretestPreparation: dbMatch.pretestPreparation,
                        productType: 'LabTest' // To help cart/checkout identify the item
                    });
                } else {
                    // 2. If no test found, try to match in MasterLabPackage
                    const pkgMatch = await MasterLabPackage.findOne({
                        packageName: { $regex: testItem.name.split(" ")[0], $options: 'i' }
                    }).select('packageName mainCategory category standardMRP preparations').lean();

                    if (pkgMatch) {
                        finalDetectedTests.push({
                            masterId: pkgMatch._id,
                            name: pkgMatch.packageName,
                            mainCategory: pkgMatch.mainCategory,
                            category: pkgMatch.category,
                            standardMRP: pkgMatch.standardMRP,
                            pretestPreparation: pkgMatch.preparations?.join(", ") || "",
                            productType: 'LabPackage'
                        });
                    }
                }
            }
        }

        res.json({
            success: true,
            message: process.env.NODE_ENV === 'production' ? "AI Scan Complete" : "Dev Mock Scan Complete",
            data: {
                doctorName: aiData.doctorName,
                prescriptionDate: aiData.date,
                prescriptionFile: req.file.path,
                detectedTests: finalDetectedTests
            }
        });

    } catch (error) {
        console.error("Scan Lab API Error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};


const searchMasterTestsForPrescription = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const { query } = req.query;

        let matchQuery = { isActive: true };

        // Apply regex search on testName if query is provided and meets the character threshold
        if (query && query.trim().length >= 2) {
            matchQuery.testName = new RegExp(query.trim(), 'i');
        }

        // Fetch counts and paginated documents in parallel for optimization
        const [tests, total] = await Promise.all([
            MasterLabTest.find(matchQuery)
                .select('_id testName mainCategory category standardMRP sampleType')
                .sort({ testName: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            MasterLabTest.countDocuments(matchQuery)
        ]);

        // Map results to the clean model format expected by the frontend
        const formattedResults = tests.map(t => ({
            id: t._id,
            name: t.testName,
            mainCategory: t.mainCategory,
            category: t.category,
            price: t.standardMRP || 0,
            type: 'LabTest',
            sampleType: t.sampleType || "N/A"
        }));

        res.json({
            success: true,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            limit,
            data: formattedResults
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 1. CREATE LAB PRESCRIPTION REQUEST (Accepts strictly manual test names list)
const createLabPrescriptionRequest = async (req, res) => {
    try {
        const { labId, patients, collectionType, address, requestedTests, appointmentDate, appointmentTime } = req.body;
        const userId = req.user.id;

        if (!req.file) {
            return res.status(400).json({ success: false, message: "Please upload prescription image file." });
        }

        const parsedPatients = typeof patients === 'string' ? JSON.parse(patients) : patients;
        const parsedTests = typeof requestedTests === 'string' ? JSON.parse(requestedTests) : requestedTests;

        const verifiedPatients = await mapPatients(userId, parsedPatients || ['Self']);

        // 🚨 FIXED: Map requested tests array carrying master prices, productTypes, and master IDs [1]
        const formattedRequestedTests = (parsedTests || []).map(test => {
            const masterId = test.masterId || test.id;
            return {
                name: test.name || "General Diagnostic Test",
                price: Number(test.price || 0), // 👈 Saved price fetched from master list [1]
                masterId: masterId && mongoose.isValidObjectId(masterId) ? masterId : null,
                productType: test.productType || 'Manual' // "LabTest", "LabPackage", or "Manual" if custom-typed
            };
        });

        const tempReqId = `REQ-LAB-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        const newRequest = await LabPrescriptionRequest.create({
            requestId: tempReqId,
            userId,
            labId,
            prescriptionImage: req.file.path,
            patients: verifiedPatients,
            collectionType,
            address: typeof address === 'string' ? JSON.parse(address) : address,
            requestedTests: formattedRequestedTests, // 👈 Saved formatted object array [1]
            appointmentDate: appointmentDate ? new Date(appointmentDate) : undefined, 
            appointmentTime: appointmentTime || null,                               
            status: 'Pending Review'
        });

        // Trigger Notification
        await notifyAdminsAndVendor(
            labId,
            'lab',
            "New Prescription Uploaded!",
            `A new laboratory prescription request #${tempReqId} is pending your manual audit.`,
            { requestId: newRequest._id.toString(), type: 'lab_prescription_review' }
        );

        res.status(201).json({
            success: true,
            message: "Prescription request placed successfully with test price configs!",
            data: newRequest
        });
    } catch (error) {
        console.error("createLabPrescriptionRequest Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. GET USER'S LAB PRESCRIPTION REQUESTS (List View remains unchanged)
const getUserLabPrescriptionRequests = async (req, res) => {
    try {
        const userId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;

        const requests = await LabPrescriptionRequest.find({ userId })
            .populate('labId', 'name profileImage city state address rating')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await LabPrescriptionRequest.countDocuments({ userId });

        res.json({
            success: true,
            count: requests.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: requests
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. GET SINGLE REQUEST DETAILS (Details Polling remains unchanged)
const getUserLabPrescriptionRequestDetails = async (req, res) => {
    try {
        const { requestId } = req.params;
        const userId = req.user.id;

        const isObjectId = mongoose.Types.ObjectId.isValid(requestId);
        const query = { userId };
        if (isObjectId) query._id = requestId;
        else query.requestId = requestId;

        const request = await LabPrescriptionRequest.findOne(query)
            .populate('labId', 'name phone profileImage city state address rating totalReviews location');

        if (!request) {
            return res.status(404).json({ success: false, message: "Request details not found" });
        }

        res.json({
            success: true,
            data: request
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. PAY AND CONVERT LAB REQUEST (Converts verifiedBill.items with testId: null safely)
const payAndConfirmLabRequest = async (req, res) => {
    try {
        const { requestId, paymentMethod } = req.body;
        const userId = req.user.id;

        const isObjectId = mongoose.Types.ObjectId.isValid(requestId);
        const query = { userId };
        if (isObjectId) query._id = requestId;
        else query.requestId = requestId;

        const request = await LabPrescriptionRequest.findOne(query);
        if (!request) {
            return res.status(404).json({ success: false, message: "Prescription request not found." });
        }

        if (request.status !== 'Bill Generated') {
            return res.status(400).json({ success: false, message: `Request status is currently '${request.status}'.` });
        }

        const bill = request.verifiedBill;
        const tempBookingId = `ORD-RX-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        // RAZORPAY INTEGRATION: If Online, create order, wait for verify-payment to complete booking
        if (paymentMethod !== 'COD') {
            const rzpOrder = await createRazorpayOrder(bill.totalAmount, `receipt_${tempBookingId}`);
            request.status = 'Pending Payment';
            await request.save();

            return res.json({
                success: true,
                message: "Prescription checkout verified. Complete payment.",
                key_id: process.env.RAZORPAY_KEY_ID,
                amount: rzpOrder.amount,
                razorpayOrderId: rzpOrder.id,
                appointmentId: request._id
            });
        }

        // 🚨 LOOP-HOLE FIXED: Create permanent Prescription record first for User App View [cite: custom_context]
        const presc = await Prescription.create({
            userId,
            prescriptionImages: [request.prescriptionImage], // Save original uploaded image
            isManualUpload: true
        });

        // COD Flow: Promote immediately to final LabBooking
        const finalBooking = await LabBooking.create({
            bookingId: tempBookingId,
            userId,
            labId: request.labId,
            patients: request.patients,
            prescriptionId: presc._id, // 👈 Successfully linked! [cite: custom_context]
            bookingType: 'Prescription-Based',
            items: {
                tests: (request.verifiedBill.tests || []).map(t => ({ 
                    testId: t.testId || null, 
                    price: t.pricePerUnit, 
                    name: t.name,
                    precaution: t.precaution || "" 
                })),
                packages: (request.verifiedBill.packages || []).map(p => ({ 
                    packageId: p.packageId || null, 
                    price: p.pricePerUnit, 
                    name: p.name,
                    precaution: p.precaution || "" 
                }))
            },
            collectionType: request.collectionType,
            address: request.address,
            appointmentDate: request.appointmentDate, 
            appointmentTime: request.appointmentTime,
            billSummary: {
                itemTotal: bill.itemTotal || 0,
                homeVisitCharge: bill.homeVisitCharge || 0,
                totalAmount: bill.totalAmount || 0
            },
            paymentMethod: 'COD',
            paymentStatus: 'Pending',
            status: 'Confirmed'
        });

        request.status = 'Paid';
        await request.save();

        res.status(201).json({
            success: true,
            message: "Prescription order confirmed with COD successfully!",
            data: finalBooking
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};



// 5. VERIFY LAB PRESCRIPTION PAYMENT SIGNATURE (Step 2 - Mapped with Prescription Linking)
const verifyLabPrescriptionPayment = async (req, res) => {
    try {
        const { appointmentId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

        const isVerified = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        if (!isVerified) {
            return res.status(400).json({ success: false, message: "Signature verification failed." });
        }

        const request = await LabPrescriptionRequest.findById(appointmentId);
        if (!request) return res.status(404).json({ success: false, message: "Prescription request not found." });

        const rzpDetails = await fetchAndMapRazorpayPayment(razorpayPaymentId, razorpaySignature);

        // Create permanent Prescription record first for User App View [cite: custom_context]
        const presc = await Prescription.create({
            userId: request.userId,
            prescriptionImages: [request.prescriptionImage], // Save original uploaded image [cite: custom_context]
            isManualUpload: true
        });

        // Convert the validated prescription request to final LabBooking
        const finalBooking = await LabBooking.create({
            bookingId: `ORD-RX-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
            userId: req.user.id,
            labId: request.labId,
            patients: request.patients,
            prescriptionId: presc._id, // 👈 Linked successfully with Prescription history! [cite: custom_context]
            bookingType: 'Prescription-Based',
            items: {
                // 🚨 FIXED: Separately maps tests and packages carrying precautions to prevent undefined mapping crash [cite: custom_context]
                tests: (request.verifiedBill.tests || []).map(t => ({ 
                    testId: t.testId || null, 
                    price: t.pricePerUnit, 
                    name: t.name,
                    precaution: t.precaution || "" // Mapped dynamically [cite: custom_context]
                })),
                packages: (request.verifiedBill.packages || []).map(p => ({ 
                    packageId: p.packageId || null, 
                    price: p.pricePerUnit, 
                    name: p.name,
                    precaution: p.precaution || "" // Mapped dynamically [cite: custom_context]
                }))
            },
            collectionType: request.collectionType,
            address: request.address,
            // Dynamic slots mapped from the prescription request details [cite: custom_context]
            appointmentDate: request.appointmentDate, 
            appointmentTime: request.appointmentTime,
            billSummary: {
                itemTotal: request.verifiedBill.itemTotal || 0,
                homeVisitCharge: request.verifiedBill.homeVisitCharge || 0,
                totalAmount: request.verifiedBill.totalAmount || 0
            },
            paymentMethod: 'Online',
            paymentStatus: 'Done',
            status: 'Confirmed',
            bookingType: 'Prescription-Based',
            paymentDetails: rzpDetails
        });

        request.status = 'Paid';
        await request.save();

        // Trigger Notification
        await notifyAdminsAndVendor(
            request.labId,
            'lab',
            "New Lab Booking Confirmed!",
            `Paid Lab booking #${finalBooking.bookingId} has been successfully verified.`,
            { bookingId: finalBooking._id.toString(), type: 'new_lab_booking' }
        );

        res.status(201).json({
            success: true,
            message: "Prescription payment verified and order placed successfully!",
            data: finalBooking
        });
    } catch (error) {
        console.error("verifyLabPrescriptionPayment Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// @desc    Retry Online Payment for a Pending Lab Booking (Generates Fresh Razorpay Order)
// @route   POST /user/labs/retry-payment
// @access  Private (User)
const retryLabPayment = async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        const { bookingId } = req.body;

        if (!bookingId) {
            return res.status(400).json({ 
                success: false, 
                message: "bookingId is required to retry payment." 
            });
        }

        // 1. Locate Booking by MongoDB _id or Custom bookingId
        const isObjectId = mongoose.isValidObjectId(bookingId);
        const query = {
            userId,
            $or: [
                { _id: isObjectId ? new mongoose.Types.ObjectId(bookingId) : new mongoose.Types.ObjectId() },
                { bookingId: String(bookingId).trim() }
            ]
        };

        const booking = await LabBooking.findOne(query);

        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                message: "Lab booking record not found." 
            });
        }

        // 2. Validate Payment State
        if (booking.paymentStatus === 'Paid' || booking.status === 'Confirmed') {
            return res.status(400).json({ 
                success: false, 
                message: "This booking is already paid and confirmed." 
            });
        }

        if (booking.paymentMethod === 'COD') {
            return res.status(400).json({ 
                success: false, 
                message: "This is a Cash on Collection (COD) booking. No online payment required." 
            });
        }

        const totalPayable = Number(booking.billSummary?.totalAmount || 0);
        if (totalPayable <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Payable amount is ₹0. No payment required." 
            });
        }

        // 3. Generate Fresh Razorpay Order for the same Booking
        const receiptId = `rcpt_retry_${booking.bookingId}_${Date.now().toString().slice(-4)}`;
        const rzpOrder = await createRazorpayOrder(totalPayable, receiptId);

        // Update Razorpay Order ID reference in booking
        if (!booking.paymentDetails) {
            booking.paymentDetails = {};
        }
        booking.paymentDetails.razorpayOrderId = rzpOrder.id;
        booking.paymentMethod = 'Online';
        booking.paymentStatus = 'Pending';
        await booking.save();

        console.log(`💳 [DEBUG: retryLabPayment] Fresh Razorpay Order #${rzpOrder.id} created for Booking #${booking.bookingId}`);

        // 4. Return Razorpay Checkout Payload to Frontend
        return res.status(200).json({
            success: true,
            message: "Fresh Razorpay payment order generated. Please complete payment.",
            key_id: process.env.RAZORPAY_KEY_ID,
            amount: rzpOrder.amount, // in paise (e.g. 53900 for ₹539)
            razorpayOrderId: rzpOrder.id,
            bookingId: booking.bookingId,
            bookingMongoId: booking._id,
            totalPayable: totalPayable
        });

    } catch (error) {
        console.error("retryLabPayment Error:", error);
        return res.status(500).json({ 
            success: false, 
            message: error.message || "Internal Server Error in retryLabPayment." 
        });
    }
};






module.exports = { 
        getStandardCatalogTests,searchStandardTests, getStandardPackages, searchStandardPackages,getFemaleStandardPackages,getFemaleStandardTests,getSearchSuggestions,getLabSuggestions,
    getLabs, getLabDetails,getLabInventoryTests,searchLabInventoryTests,getLabInventoryPackages,searchLabInventoryPackages,
    
    getLabSlots, getLabDeliveryCharges,
    bookLabTest, uploadPrescriptionFlow, 
    getMyBookings, getBookingDetails ,
    checkoutLabBooking,getUniqueMainCategories,
    getLabsByMasterTest, getLabsByMasterPackage,
    getMasterTestDetails, getMasterPackageDetails,
    cancelBooking, confirmPrescriptionBooking,verifyLabPayment, rateLabOrder ,getPaginatedReviews,updateReviewByOrderId, updateReviewByVendorId,getReviewByOrderId,
    getAvailableCoupons,validateLabCoupon, getLabSlots,getPreparationGuide,suggestPersonalizedPackage,getTestSuggestions,getWomenSpecialTests,getWomenCategories,getWomenTestsByCategory,
    
    // Prescription Flow
    scanLabPrescription,searchMasterTestsForPrescription,
    createLabPrescriptionRequest,
    getUserLabPrescriptionRequests,
    getUserLabPrescriptionRequestDetails,
    payAndConfirmLabRequest,
    verifyLabPrescriptionPayment,
    retryLabPayment
};