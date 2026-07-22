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


// 3. FINAL CHECKOUT (Integrating Delivery, Coupons & Razorpay Payments)
// Replacing checkoutLabBooking in controllers/user/Lab/BookLab.js
// --- 3. FINAL CHECKOUT (Supporting Patient-to-Test & Patient-to-Address Mapping) ---
// --- 3. FINAL CHECKOUT (Updated with COD and Mapped Cart checks) ---
const checkoutLabBooking = async (req, res) => {
    try {
        const { 
            appointmentDate, 
            appointmentTime, 
            address, 
            paymentMethod, 
            couponCode, 
            isRapid, 
            selectedPatientIds, 
            patientMappings,    
            collectionType 
        } = req.body;

        const cart = await Cart.findOne({ userId: req.user.id });
        if (!cart || cart.labCart.items.length === 0) {
            return res.status(400).json({ success: false, message: "Cart is empty" });
        }

        // 🚨 STRICTOR COD VALIDATION
        const isCodAllowed = await isCodEnabled('Lab');
        if (paymentMethod === 'COD' && !isCodAllowed) {
            return res.status(400).json({
                success: false,
                message: "Cash on Delivery is currently disabled for diagnostic services. Please pay online to complete your checkout."
            });
        }

        // Radiology Home Collection Safeguard
        if (collectionType === 'Home Collection') {
            if (cart.labCart.categoryType && cart.labCart.categoryType.toLowerCase() === 'radiology') {
                return res.status(400).json({ 
                    success: false, 
                    message: "Radiology scans require specialised diagnostics equipment and cannot be booked for Home Collection. Please select 'Visit Lab' / Walk-In." 
                });
            }
        }

        const targetLab = await Lab.findById(cart.labCart.labId);
        if (!targetLab || targetLab.isOnline === false) {
            return res.status(400).json({
                success: false,
                message: "Booking Blocked: Lab is currently offline and not accepting bookings."
            });
        }

        let bill;
        let resolvedPatients = [];
        const globalUniqueTests = new Set();
        const globalUniquePackages = new Set();

        const userProfile = await User.findById(req.user.id);
        if (!userProfile) {
            return res.status(404).json({ success: false, message: "User account not found." });
        }

        // =========================================================================
        // CASE A: NEW FLOW (Patient-specific addresses & test assignments)
        // =========================================================================
        if (patientMappings && Array.isArray(patientMappings) && patientMappings.length > 0) {
            bill = await calculateStructuredBill(
                cart.labCart.labId,
                patientMappings,
                collectionType,
                couponCode,
                isRapid,
                req.user.id,
                appointmentTime
            );

            for (let mapping of patientMappings) {
                let patientInfo = {};
                
                if (mapping.patientId === 'Self') {
                    patientInfo = {
                        name: userProfile.name,
                        age: userProfile.age || 25,
                        gender: userProfile.gender || 'Male',
                        relation: 'Self'
                    };
                } else {
                    const member = userProfile.familyMember.id(mapping.patientId);
                    if (member) {
                        patientInfo = {
                            name: member.memberName,
                            age: member.age,
                            gender: member.gender,
                            relation: member.relation
                        };
                    } else {
                        patientInfo = {
                            name: "Unknown",
                            age: 30,
                            gender: "Other",
                            relation: "Other"
                        };
                    }
                }

                const assignedItems = [];
                for (let item of mapping.items) {
                    if (item.productType === 'LabTest') {
                        const test = await LabTest.findById(item.itemId);
                        if (test) {
                            assignedItems.push({
                                itemId: item.itemId,
                                productType: 'LabTest',
                                name: test.testName,
                                price: test.discountPrice || test.amount
                            });
                            globalUniqueTests.add(JSON.stringify({ testId: item.itemId, price: test.discountPrice || test.amount, name: test.testName }));
                        }
                    } else if (item.productType === 'LabPackage') {
                        const pkg = await LabPackage.findById(item.itemId);
                        if (pkg) {
                            assignedItems.push({
                                itemId: item.itemId,
                                productType: 'LabPackage',
                                name: pkg.packageName,
                                price: pkg.offerPrice || pkg.mrp
                            });
                            globalUniquePackages.add(JSON.stringify({ packageId: item.itemId, price: pkg.offerPrice || pkg.mrp, name: pkg.packageName }));
                        }
                    }
                }

                resolvedPatients.push({
                    patientId: mapping.patientId,
                    name: patientInfo.name,
                    age: patientInfo.age,
                    gender: patientInfo.gender,
                    relation: patientInfo.relation,
                    address: mapping.address,
                    assignedItems: assignedItems
                });
            }
        } 
        // =========================================================================
        // CASE B: OLD FLOW FALLBACK
        // =========================================================================
        else {
            bill = await calculateBillHelper(
                cart.labCart.labId, 
                cart.labCart, 
                selectedPatientIds.length, 
                collectionType, 
                couponCode, 
                isRapid, 
                req.user.id,
                appointmentTime 
            );

            resolvedPatients = await mapPatients(req.user.id, selectedPatientIds);
            
            cart.labCart.items.forEach(i => {
                if (i.productType === 'LabTest') {
                    globalUniqueTests.add(JSON.stringify({ testId: i.itemId, price: i.price, name: i.name }));
                } else {
                    globalUniquePackages.add(JSON.stringify({ packageId: i.itemId, price: i.price, name: i.name }));
                }
            });
        }

        const finalTestsArray = Array.from(globalUniqueTests).map(str => JSON.parse(str));
        const finalPackagesArray = Array.from(globalUniquePackages).map(str => JSON.parse(str));

        const tempBookingId = `ORD-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        let rzpOrder = null;

        if (paymentMethod !== 'COD') {
            rzpOrder = await createRazorpayOrder(bill.totalAmount, `receipt_${tempBookingId}`);
        }

        const fallbackAddress = resolvedPatients[0]?.address || address;

        const booking = await LabBooking.create({
            bookingId: tempBookingId,
            userId: req.user.id,
            labId: cart.labCart.labId,
            patients: resolvedPatients,
            items: {
                tests: finalTestsArray,
                packages: finalPackagesArray
            },
            collectionType, 
            address: fallbackAddress, 
            appointmentDate, 
            appointmentTime,
            billSummary: bill, 
            paymentMethod,
            isRapid: isRapid || false,
            status: paymentMethod === 'COD' ? 'Confirmed' : 'Pending',
            paymentStatus: paymentMethod === 'COD' ? 'Pending' : 'Pending',
            tracking: {
                otp: Math.floor(1000 + Math.random() * 9000).toString()
            }
        });

        if (paymentMethod === 'COD') {
            await Cart.findOneAndUpdate({ userId: req.user.id }, { $set: { "labCart.items": [], "labCart.labId": null } });

            if (collectionType === 'Home Collection') {
                await deductBenefitCount(req.user.id, 'freeLabDeliveriesCount');
            }

            await notifyAdminsAndVendor(
                cart.labCart.labId,
                'lab',
                "New Lab Booking Confirmed (COD)!",
                `A COD lab booking #${tempBookingId} has been successfully placed.`,
                { bookingId: booking._id.toString(), type: 'new_lab_booking' }
            );

            return res.status(201).json({ success: true, message: "Booking confirmed successfully!", data: booking });
        }

        res.status(201).json({
            success: true,
            message: "Razorpay order created. Complete payment to confirm.",
            key_id: process.env.RAZORPAY_KEY_ID,
            amount: rzpOrder.amount, 
            razorpayOrderId: rzpOrder.id,
            bookingId: tempBookingId,
            appointmentId: booking._id,
            isCodAvailable: isCodAllowed // 👈 Dynamic indicator added
        });

    } catch (error) { 
        console.error("FATAL CHECKOUT ERROR:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 🚨 NEW API ENDPOINT: Fetch unique main categories dynamically
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

// 4. INITIATE BOOKING (Direct Booking - Replacing bookLabTest)
// --- 4. INITIATE BOOKING (Direct Booking - Supporting Patient-to-Test & Address Mapping) ---
// --- 4. INITIATE BOOKING (Direct Booking - Supporting COD checks) ---
const bookLabTest = async (req, res) => {
    try {
        console.log("Incoming Direct Lab Booking Request:", req.body);
        let body = { ...req.body };

        // Safe parsing for multipart/form-data payloads
        if (typeof body.patientMappings === 'string') {
            try { body.patientMappings = JSON.parse(body.patientMappings); } catch (e) { body.patientMappings = []; }
        }
        if (typeof body.address === 'string') {
            try { body.address = JSON.parse(body.address); } catch (e) { body.address = null; }
        }

        const { 
            labId, 
            collectionType, 
            isRapid,
            appointmentDate, 
            appointmentTime, 
            address, 
            couponCode, 
            paymentMethod,
            patientMappings, 
            patients,        
            items            
        } = body;

        // 1. Validate mandatory fields
        if (!labId || !appointmentDate || !appointmentTime || !collectionType) {
            return res.status(400).json({ 
                success: false, 
                message: "Lab, Date, Time (appointmentTime), and collectionType are mandatory." 
            });
        }

        // Validate Payment Method Enum
        const allowedPaymentMethods = ['UPI', 'COD', 'Card', 'Netbanking', 'Wallet'];
        if (paymentMethod && !allowedPaymentMethods.includes(paymentMethod)) {
            return res.status(400).json({ 
                success: false, 
                message: `Invalid paymentMethod. Allowed values are: ${allowedPaymentMethods.join(', ')}` 
            });
        }

        // 🚨 STRICTOR COD VALIDATION
        if (paymentMethod === 'COD') {
            const isCodAllowed = await isCodEnabled('Lab');
            if (!isCodAllowed) {
                return res.status(400).json({
                    success: false,
                    message: "Cash on Delivery is currently disabled for diagnostic services. Please pay online to place your booking."
                });
            }
        }

        // 2. CRITICAL RADIOLOGY HOME COLLECTION WALK-IN VALIDATIONS
        if (collectionType === 'Home Collection') {
            if (patientMappings && Array.isArray(patientMappings)) {
                for (let mapping of patientMappings) {
                    for (let itm of mapping.items) {
                        if (itm.productType === 'LabTest') {
                            const testData = await LabTest.findById(itm.itemId);
                            if (testData && testData.mainCategory && testData.mainCategory.toLowerCase() === 'radiology') {
                                return res.status(400).json({
                                    success: false,
                                    message: `Direct booking failed: '${testData.testName}' belongs to Radiology and cannot be collected at home.`
                                });
                            }
                        } else if (itm.productType === 'LabPackage') {
                            const pkgData = await LabPackage.findById(itm.itemId).populate('tests');
                            if (pkgData) {
                                const hasRadiology = pkgData.tests.some(t => t.mainCategory && t.mainCategory.toLowerCase() === 'radiology');
                                if (hasRadiology || (pkgData.mainCategory && pkgData.mainCategory.toLowerCase() === 'radiology')) {
                                    return res.status(400).json({
                                        success: false,
                                        message: `Direct booking failed: Package '${pkgData.packageName}' contains Radiology tests and cannot be collected at home.`
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        const userProfile = await User.findById(req.user.id);
        if (!userProfile) {
            return res.status(404).json({ success: false, message: "User account not found." });
        }

        let bill;
        let resolvedPatients = [];
        const globalUniqueTests = new Set();
        const globalUniquePackages = new Set();

        // =========================================================================
        // CASE A: NEW FLOW (Patient-specific addresses & test assignments)
        // =========================================================================
        if (patientMappings && Array.isArray(patientMappings) && patientMappings.length > 0) {
            bill = await calculateStructuredBill(
                labId,
                patientMappings,
                collectionType,
                couponCode,
                isRapid,
                req.user.id,
                appointmentTime
            );

            for (let mapping of patientMappings) {
                let patientInfo = {};
                
                if (mapping.patientId === 'Self') {
                    patientInfo = {
                        name: userProfile.name,
                        age: userProfile.age || 25,
                        gender: userProfile.gender || 'Male',
                        relation: 'Self'
                    };
                } else {
                    const member = userProfile.familyMember.id(mapping.patientId);
                    if (member) {
                        patientInfo = {
                            name: member.memberName,
                            age: member.age,
                            gender: member.gender,
                            relation: member.relation
                        };
                    } else {
                        patientInfo = {
                            name: "Unknown",
                            age: 30,
                            gender: "Other",
                            relation: "Other"
                        };
                    }
                }

                const assignedItems = [];
                for (let itm of mapping.items) {
                    if (itm.productType === 'LabTest') {
                        const test = await LabTest.findById(itm.itemId);
                        if (test) {
                            assignedItems.push({
                                itemId: itm.itemId,
                                productType: 'LabTest',
                                name: test.testName,
                                price: test.discountPrice || test.amount
                            });
                            globalUniqueTests.add(JSON.stringify({ testId: itm.itemId, price: test.discountPrice || test.amount, name: test.testName }));
                        }
                    } else if (itm.productType === 'LabPackage') {
                        const pkg = await LabPackage.findById(itm.itemId);
                        if (pkg) {
                            assignedItems.push({
                                itemId: itm.itemId,
                                productType: 'LabPackage',
                                name: pkg.packageName,
                                price: pkg.offerPrice || pkg.mrp
                            });
                            globalUniquePackages.add(JSON.stringify({ packageId: itm.itemId, price: pkg.offerPrice || pkg.mrp, name: pkg.packageName }));
                        }
                    }
                }

                resolvedPatients.push({
                    patientId: mapping.patientId,
                    name: patientInfo.name,
                    age: patientInfo.age,
                    gender: patientInfo.gender,
                    relation: patientInfo.relation,
                    address: mapping.address,
                    assignedItems: assignedItems
                });
            }
        } 
        // =========================================================================
        // CASE B: OLD FLOW FALLBACK
        // =========================================================================
        else {
            bill = await calculateBill(
                labId, 
                items, 
                patients.length, 
                collectionType, 
                couponCode, 
                isRapid,
                req.user.id,
                appointmentTime
            );

            resolvedPatients = await mapPatients(req.user.id, patients.map(p => p.patientId));
            
            (items.tests || []).forEach(t => {
                globalUniqueTests.add(JSON.stringify({ testId: t.testId, price: t.price, name: t.name }));
            });
            (items.packages || []).forEach(p => {
                globalUniquePackages.add(JSON.stringify({ packageId: p.packageId, price: p.price, name: p.name }));
            });
        }

        const finalTestsArray = Array.from(globalUniqueTests).map(str => JSON.parse(str));
        const finalPackagesArray = Array.from(globalUniquePackages).map(str => JSON.parse(str));

        const tempBookingId = `ORD-${Date.now().toString().slice(-6)}${crypto.randomInt(100, 999)}`;
        let rzpOrder = null;

        if (paymentMethod !== 'COD' && bill.totalAmount > 0) {
            rzpOrder = await createRazorpayOrder(bill.totalAmount, `receipt_${tempBookingId}`);
        }

        const fallbackAddress = resolvedPatients[0]?.address || address;

        const booking = await LabBooking.create({
            bookingId: tempBookingId,
            userId: req.user.id,
            labId,
            patients: resolvedPatients,
            items: {
                tests: finalTestsArray,
                packages: finalPackagesArray
            },
            collectionType,
            address: fallbackAddress,
            appointmentDate: new Date(appointmentDate),
            appointmentTime,
            billSummary: bill,
            paymentMethod: paymentMethod || 'Online',
            paymentStatus: paymentMethod === 'COD' || bill.totalAmount === 0 ? 'Pending' : 'Pending',
            status: paymentMethod === 'COD' || bill.totalAmount === 0 ? 'Confirmed' : 'Pending',
            tracking: {
                otp: Math.floor(1000 + Math.random() * 9000).toString()
            }
        });

        if (paymentMethod === 'COD' || bill.totalAmount === 0) {
            if (collectionType === 'Home Collection') {
                await deductBenefitCount(req.user.id, 'freeLabDeliveriesCount');
            }

            await notifyAdminsAndVendor(
                labId,
                'lab',
                "New Direct Lab Booking (COD)!",
                `Direct COD booking #${tempBookingId} has been successfully placed.`,
                { bookingId: booking._id.toString(), type: 'new_lab_booking' }
            );

            return res.status(201).json({ success: true, data: booking });
        }

        res.status(201).json({
            success: true,
            message: "Razorpay order created for direct booking.",
            key_id: process.env.RAZORPAY_KEY_ID,
            amount: rzpOrder.amount,
            razorpayOrderId: rzpOrder.id,
            appointmentId: booking._id,
            bookingId: tempBookingId
        });

    } catch (error) { 
        console.error("Direct booking error:", error);
        res.status(500).json({ success: false, message: error.message }); 
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

// 6. GET MY BOOKINGS
const getMyBookings = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20; // Pagination strictly set to 20
        const skip = (page - 1) * limit;

        const { status } = req.query;
        let query = { userId: req.user.id };
        if (status) query.status = status;

        const bookings = await LabBooking.find(query)
            .populate('labId', 'name city profileImage')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await LabBooking.countDocuments(query);
            
        res.json({ 
            success: true, 
            count: bookings.length, 
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: bookings 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
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


// 🚨 NEW CONTROLLER: VERIFY LAB PAYMENT SIGNATURE
// endpoint: POST /user/labs/verify-payment
const verifyLabPayment = async (req, res) => {
    try {
        const { appointmentId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

        if (!appointmentId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return res.status(400).json({ success: false, message: "Missing required payment tokens." });
        }

        const isVerified = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        if (!isVerified) {
            return res.status(400).json({ success: false, message: "Invalid transaction signature." });
        }

        const rzpDetails = await fetchAndMapRazorpayPayment(razorpayPaymentId, razorpaySignature);

        const booking = await LabBooking.findByIdAndUpdate(
            appointmentId,
            {
                $set: {
                    status: 'Confirmed',
                    paymentStatus: 'Done',
                    paymentMethod: 'UPI',
                    paymentDetails: rzpDetails 
                }
            },
            { new: true }
        );

        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found." });
        }

        await Cart.findOneAndUpdate({ userId: req.user.id }, { $set: { "labCart.items": [], "labCart.labId": null } });

        // 🚨 LOGICAL RESOLVE: Only deduct subscription deliveries count if delivery charge was waived to 0
        if (booking.collectionType === 'Home Collection' && booking.billSummary?.homeVisitCharge === 0) {
            const { deductBenefitCount } = require('../../../utils/subscriptionBenefitHelper');
            await deductBenefitCount(booking.userId, 'freeLabDeliveriesCount');
        }

        await notifyAdminsAndVendor(
            booking.labId,
            'lab',
            "New Lab Booking Confirmed!",
            `Paid Lab booking #${booking.bookingId} has been successfully verified.`,
            { bookingId: booking._id.toString(), type: 'new_lab_booking' }
        );

        res.json({
            success: true,
            message: "Lab booking successfully verified and confirmed!",
            data: booking
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
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

        const masterPkgId = new mongoose.Types.ObjectId(id);

        // 1. Master Package ki info lein
        const masterData = await MasterLabPackage.findById(masterPkgId).populate('tests', 'testName parameters').lean();
        if (!masterData) return res.status(404).json({ success: false, message: "Master Package not found" });

        // 2. KM Limit
        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Lab', isActive: true });
        const maxRadius = limitConfig ? limitConfig.kmLimit : 100;

        // 3. UPDATED QUERY: ID se dhoondo YA Name se (Fallback logic)
        // Isse agar ID miss bhi ho gayi ho par Name same hai, toh wo vendor dikhega
        const labsPackages = await LabPackage.find({
            $or: [
                { masterPackageId: masterPkgId },
                { packageName: masterData.packageName } // Agar ID link nahi hai par Name wahi hai
            ],
            isActive: true 
        })
        .populate({
            path: 'labId',
            match: { profileStatus: 'Approved', isActive: true }
        })
        .lean();

        console.log(`DEBUG: Found ${labsPackages.length} packages by ID or Name`);

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
                    labPackageId: item._id
                });
            }
        }

        // Duplicates remove karein (In case ek hi vendor ID aur Name dono se match ho jaye)
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

        // Directly store requested test names as strings (whether scanned or manually typed)
        const formattedRequestedTests = (parsedTests || []).map(testName => ({
            name: typeof testName === 'string' ? testName : (testName.name || "General Diagnostic Test")
        }));

        const tempReqId = `REQ-LAB-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        const newRequest = await LabPrescriptionRequest.create({
            requestId: tempReqId,
            userId,
            labId,
            prescriptionImage: req.file.path,
            patients: verifiedPatients,
            collectionType,
            address: typeof address === 'string' ? JSON.parse(address) : address,
            requestedTests: formattedRequestedTests,
            appointmentDate: appointmentDate ? new Date(appointmentDate) : undefined, // 👈 Saved dynamic date [cite: custom_context]
            appointmentTime: appointmentTime || null,                               // 👈 Saved dynamic time [cite: custom_context]
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
            message: "Prescription request placed successfully!",
            data: newRequest
        });
    } catch (error) {
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

        // 🚨 LOOP-HOLE FIXED: Create permanent Prescription record first for User App View [cite: custom_context]
        const presc = await Prescription.create({
            userId: request.userId,
            prescriptionImages: [request.prescriptionImage], // Save original uploaded image
            isManualUpload: true
        });

        // Convert the validated prescription request to final LabBooking
        const finalBooking = await LabBooking.create({
            bookingId: `ORD-RX-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
            userId: req.user.id,
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
            billSummary: request.verifiedBill,
            paymentMethod: 'Online',
            paymentStatus: 'Done',
            status: 'Confirmed',
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
        res.status(500).json({ success: false, message: error.message });
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
    verifyLabPrescriptionPayment
};