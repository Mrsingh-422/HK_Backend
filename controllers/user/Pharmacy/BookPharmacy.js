// controllers/user/Pharmacy/BookPharmacy.js
const Pharmacy = require('../../../models/Pharmacy');
const VendorKMLimit = require('../../../models/VendorKMLimit');
const { getDistance } = require('../../../utils/helpers');
const PharmacyBooking = require('../../../models/PharmacyBooking');
const Cart = require('../../../models/Cart');
const MedicineInventory = require('../../../models/MedicineInventory');
const Medicine = require('../../../models/Medicine');
const countries = require('../../../data/countries.json');
const states = require('../../../data/states.json');
const cities = require('../../../data/cities.json');
const DeliveryCharge = require('../../../models/DeliveryCharge');
const Availability = require('../../../models/Availability');
const Coupon = require('../../../models/Coupon');
const Prescription = require('../../../models/Prescription');
const MedicineOrder = require('../../../models/PharmacyBooking');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { generateTimeSlots } = require('../../../utils/timeSlotHelper');
const moment = require('moment');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');
const LabCategory = require('../../../models/LabCategory');
const PharmacyPrescriptionRequest = require('../../../models/PharmacyPrescriptionRequest');






// --- HELPER: Bill Calculation (Mirroring Lab logic) ---
const calculatePharmacyBillHelper = async (pharmacyId, items, patientsCount, collectionType, couponCode, isRapid, appointmentTime) => {
    let itemTotal = 0;
    items.forEach(item => { itemTotal += (item.price * item.quantity); });

    let deliveryCharge = 0;
    let rapidCharge = 0;
    let slotCharge = 0;
    
    const cleanPharmaId = pharmacyId.toString();
    const charges = await DeliveryCharge.findOne({ vendorId: cleanPharmaId });

    // 1. Standard Delivery Charge (If Home Delivery)
    if (collectionType === 'Home Delivery' || collectionType === 'Home Collection') {
        deliveryCharge = charges ? Number(charges.fixedPrice) : 40;
    }
    
    // 2. FIXED: Rapid charge sirf tab lagega jab isRapid true ho AUR koi slot selected na ho (Immediate mode)
    if (isRapid && (!appointmentTime || appointmentTime === 'Immediate')) {
        rapidCharge = charges ? Number(charges.fastDeliveryExtra) : 29;
    } else {
        rapidCharge = 0; // 3 hrs or Custom slot mein rapid charge zero
    }

    // 3. Premium Slot Charge
    if (appointmentTime && appointmentTime !== 'Immediate') {
        const availConfig = await Availability.findOne({ vendorId: cleanPharmaId });
        if (availConfig && availConfig.premiumSlots) {
            const selectedTimeClean = appointmentTime.trim();
            const premiumSlot = availConfig.premiumSlots.find(ps => ps.time.trim() === selectedTimeClean);
            if (premiumSlot) slotCharge = Number(premiumSlot.extraFee) || 0;
        }
    }

    // 4. Coupon Logic
    let couponDiscount = 0;
    let couponId = null;
    if (couponCode) {
        const coupon = await Coupon.findOne({ couponName: couponCode.toUpperCase(), isActive: true });
        if (coupon && itemTotal >= coupon.minOrderAmount) {
            couponDiscount = Math.min((itemTotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
            couponId = coupon._id;
        }
    }

    const totalAmount = (itemTotal - couponDiscount) + deliveryCharge + rapidCharge + slotCharge;
    
    return { 
        itemTotal, couponDiscount, couponId, deliveryCharge, rapidDeliveryCharge: rapidCharge, slotCharge, 
        totalAmount: Math.round(totalAmount) 
    };
};


// Helper for mapping patients (Aapke code se uthaya gaya)
async function mapPatients(userId, pids) {
    const User = require('../../../models/User');
    const user = await User.findById(userId);
    return pids.map(id => {
        if (id === 'Self') return { patientId: 'Self', name: user.name, age: user.age || 25, gender: user.gender || 'Male', relation: 'Self' };
        const m = user.familyMember.id(id);
        return { patientId: id, name: m.memberName, age: m.age, gender: m.gender, relation: m.relation };
    });
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- HELPER: AI Image Processing Logic ---
const extractDataWithGemini = async (filePath) => {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === ".png" ? "image/png" : "image/jpeg";

    const imageData = {
        inlineData: {
            data: Buffer.from(fs.readFileSync(filePath)).toString("base64"),
            mimeType: mimeType,
        },
    };

    const prompt = `Act as a professional pharmacist. Extract data in STRICT JSON format: {"doctorName": "string", "date": "string", "medicines": [{"name": "string", "dosage": "string", "duration": "string"}]}`;

    const result = await model.generateContent([prompt, imageData]);
    const response = await result.response;
    const text = response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI did not return valid JSON.");
    return JSON.parse(jsonMatch[0]);
};
const scanPrescription = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Please upload an image" });

        let aiData;
        
        // CHECK ENVIRONMENT
        if (process.env.NODE_ENV === 'production') {
            console.log("Using REAL AI Logic...");
            aiData = await extractDataWithGemini(req.file.path);
        } else {
            console.log("Using DEVELOPMENT MOCK Logic...");
            // Mock Response for Dolo 650mg
            aiData = {
                doctorName: "Dr. Rajesh Sharma (Mock)",
                date: moment().format('DD-MM-YYYY'),
                medicines: [
                    { name: "Dolo 650", dosage: "1-0-1", duration: "5 days" }
                ]
            };
        }

        const finalDetectedMeds = [];

        // DATABASE MATCHING LOGIC
        if (aiData.medicines && aiData.medicines.length > 0) {
            for (let med of aiData.medicines) {
                // Database mein Dolo 650 dhoondna
                const dbMatch = await Medicine.findOne({
                    name: { $regex: med.name.split(" ")[0], $options: 'i' }
                }).select('name mrp packaging prescription_required image_url').lean();

                if (dbMatch) {
                    finalDetectedMeds.push({
                        medicineId: dbMatch._id,
                        name: dbMatch.name,
                        mrp: dbMatch.mrp,
                        packaging: dbMatch.packaging,
                        prescriptionRequired: dbMatch.prescription_required,
                        imageUrl: dbMatch.image_url[0] || null,
                        aiInstruction: {
                            dosage: med.dosage,
                            duration: med.duration
                        }
                    });
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
                detectedMedicines: finalDetectedMeds
            }
        });

    } catch (error) {
        console.error("Scan API Error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};


// --- API 1: GET MEDICINE SUGGESTIONS (Search Bar) ---
const getMedicineSuggestions = async (req, res) => {
    try {
        const { query } = req.body;

        if (!query || query.length < 2) {
            return res.json({ success: true, data: [] });
        }

        // Search logic: Name ya Salt mein match dhoondega
        const searchRegex = new RegExp(query, 'i');

        const suggestions = await Medicine.find({
            $or: [
                { name: searchRegex },
                { salt_composition: searchRegex }
            ]
        })
        .select('name salt_composition mrp best_price image_url discont_percent') // Sirf zaroori fields
        .limit(10) // Performance ke liye sirf 10 results
        .lean();

        // Response formatting for Flutter
        const formattedData = suggestions.map(med => ({
            id: med._id,
            name: med.name,
            salt: med.salt_composition,
            price: med.best_price || med.mrp,
            image: med.image_url && med.image_url.length > 0 ? med.image_url[0] : null,
            discount: med.discont_percent,
            displayType: med.name.toLowerCase().includes(query.toLowerCase()) ? "Name Match" : "Salt Match"
        }));

        res.json({
            success: true,
            count: formattedData.length,
            data: formattedData
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- API 2: GET FULL MEDICINE DETAILS (Click karne par) ---
// GET /user/pharmacy/full-details/:id
const getMedicineFullDetails = async (req, res) => {
    try {
        const { id } = req.params;

        // Saare fields fetch karein
        const medicine = await Medicine.findById(id).lean();

        if (!medicine) {
            return res.status(404).json({ success: false, message: "Medicine details not found" });
        }

        res.json({
            success: true,
            data: medicine
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


const getMedicineCategories = async (req, res) => {
    try {
        // 1. Aggregation: Breadcrumb se Main Category nikalna aur Stock (Product Count) ginna
        const categoryStats = await Medicine.aggregate([
            {
                $project: {
                    // "Medicines > Fever" -> ["Medicines", "Fever"] -> lelo "Medicines"
                    mainCat: { $trim: { input: { $arrayElemAt: [{ $split: ["$bread_crumb", ">"] }, 0] } } }
                }
            },
            { $match: { mainCat: { $ne: null, $ne: "" } } },
            { $group: { _id: "$mainCat", productCount: { $sum: 1 } } },
            { $sort: { productCount: -1 } } // Sabse zyada products wali upar
        ]);

        // 2. Database se images fetch karein
        const dbImages = await LabCategory.find({ vendorType: 'Pharmacy' });

        // 3. Data Merge Karein
        const finalData = categoryStats.map(stat => {
            const dbMatch = dbImages.find(img => img.name === stat._id);
            return {
                name: stat._id,
                productCount: stat.productCount,
                // 'public/' hata kar bhej rahe hain
                image: dbMatch?.image ? dbMatch.image.replace(/^public[\\/]/, '') : `assets/images/med_${stat._id.toLowerCase().replace(/\s+/g, '_')}.png`
            };
        });

        res.json({ success: true, data: finalData });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
const getPharmacySubCategories = async (req, res) => {
    try {
        const { category } = req.query;

        // Aggregation logic taaki laakho records mein se unique sub-cats jaldi nikle
        const subCats = await Medicine.aggregate([
            { $match: { bread_crumb: new RegExp(`^${category}\\s*>`, 'i') } },
            {
                $project: {
                    // Split "Cardiac Care > Blood Pressure" and take index 1
                    sub: { $trim: { input: { $arrayElemAt: [{ $split: ["$bread_crumb", ">"] }, 1] } } }
                }
            },
            { $group: { _id: "$sub" } },
            { $match: { _id: { $ne: null } } },
            { $sort: { _id: 1 } }
        ]);

        res.json({
            success: true,
            data: subCats.map(s => s._id)
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
const getMedicineCategoryDetails = async (req, res) => {
    try {
        const { category, subCategory, page = 1 } = req.query;
        const limit = 20;
        const skip = (parseInt(page) - 1) * limit;

        let breadcrumbRegex = subCategory 
            ? new RegExp(`^${category}\\s*>\\s*${subCategory}`, 'i')
            : new RegExp(`^${category}\\s*>`, 'i');

        const pipeline = [
            { $match: { bread_crumb: breadcrumbRegex } },
            {
                // 1. Inventory check (Lowest Vendor Price)
                $lookup: {
                    from: "medicineinventories",
                    localField: "_id",
                    foreignField: "medicineId",
                    as: "inventory",
                    pipeline: [
                        { $match: { is_available: true, stock_quantity: { $gt: 0 } } },
                        { $sort: { vendor_price: 1 } },
                        { $limit: 1 }
                    ]
                }
            },
            {
                $addFields: {
                    // Pre-calculate numeric values for fallback and calculation
                    numMRP: { $toDouble: { $ifNull: ["$mrp", 0] } },
                    numDocBestPrice: { $toDouble: { $ifNull: ["$best_price", 0] } },
                    numInventoryPrice: { $toDouble: { $arrayElemAt: ["$inventory.vendor_price", 0] } },
                    isInventoryAvailable: { $gt: [{ $size: "$inventory" }, 0] }
                }
            },
            {
                $addFields: {
                    // --- MINIMUM PRICE FALLBACK ---
                    // Agar inventory mein sasta vendor hai toh wo, warna medicine ka 'best_price'
                    minimumPrice: {
                        $cond: [
                            "$isInventoryAvailable",
                            "$numInventoryPrice",
                            "$numDocBestPrice"
                        ]
                    },
                    isAvailable: "$isInventoryAvailable"
                }
            },
            {
                $addFields: {
                    // --- DISCOUNT PERCENTAGE FALLBACK ---
                    // Logic: ((MRP - SelectedPrice) / MRP) * 100
                    discountPercentage: {
                        $cond: {
                            if: { $gt: ["$numMRP", 0] },
                            then: {
                                $round: [
                                    {
                                        $multiply: [
                                            { $divide: [{ $subtract: ["$numMRP", "$minimumPrice"] }, "$numMRP"] },
                                            100
                                        ]
                                    },
                                    0
                                ]
                            },
                            else: 0
                        }
                    }
                }
            },
            { 
                $project: { 
                    inventory: 0, numMRP: 0, numDocBestPrice: 0, numInventoryPrice: 0, isInventoryAvailable: 0 
                } 
            },
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [{ $skip: skip }, { $limit: limit }]
                }
            }
        ];

        const result = await Medicine.aggregate(pipeline);
        const total = result[0].metadata[0]?.total || 0;

        res.json({
            success: true,
            total,
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            data: result[0].data
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};


// Default Location: Delhi (Coordinates)
const DEFAULT_LAT = 28.6139;
const DEFAULT_LNG = 77.2090;

// 1. GET SEARCH SUGGESTIONS (For City/Area Searchbar)
// endpoint: GET /user/pharmacy/suggestions?query=Del
const getPharmacySearchSuggestions = (req, res) => {
    try {
        const { query } = req.query;
        if (!query || query.length < 2) return res.json({ success: true, data: [] });

        const search = query.toLowerCase();

        // Assumption: cities, states arrays are available globally or imported
        const matchedCities = cities
            .filter(c => c.name.toLowerCase().includes(search))
            .slice(0, 10);

        const suggestions = matchedCities.map(city => {
            const state = states.find(s => s.id == city.state_id);
            const country = countries.find(c => c.id == state?.country_id);
            return {
                city: city.name,
                state: state?.name || "",
                country: country?.name || "",
                display: `${city.name}, ${state?.name || ''}`
            };
        });

        res.json({ success: true, data: suggestions });
    } catch (error) {
        res.status(500).json({ message: "Error fetching suggestions" });
    }
};

// 2. GET PHARMACY NAME SUGGESTIONS (For Searchbar)
// endpoint: GET /user/pharmacy/name-suggestions?query=Med
const getPharmacyNameSuggestions = async (req, res) => {
    try {
        const { query } = req.query;
        if (!query || query.length < 2) return res.json({ success: true, data: [] });

        const searchRegex = new RegExp(query, 'i');

        const pharmacies = await Pharmacy.find({
            name: searchRegex,
            profileStatus: 'Approved',
            isActive: true
        })
        .select('name city profileImage')
        .limit(10)
        .lean();

        const suggestions = pharmacies.map(p => ({
            id: p._id,
            name: p.name,
            city: p.city,
            image: p.profileImage,
            display: p.name
        }));

        res.json({ success: true, data: suggestions });
    } catch (error) {
        res.status(500).json({ message: "Error fetching pharmacy suggestions" });
    }
};

// 3. POST /user/pharmacy/list (Main Discovery API)
const getPharmacies = async (req, res) => {
    try {
        let { lat, lng, search, city, state, country } = req.body;

        const filterLat = lat || DEFAULT_LAT;
        const filterLng = lng || DEFAULT_LNG;

        // --- STRICT FILTER: Only Approved and Active ---
        let query = { 
            profileStatus: 'Approved', 
            isActive: true 
        };

        if (city) query.city = new RegExp(`^${city}$`, 'i');
        if (state) query.state = new RegExp(`^${state}$`, 'i');

        if (search) {
            const searchRegex = new RegExp(search, 'i');
            query.$or = [{ name: searchRegex }, { city: searchRegex }];
        }

        const pharmacies = await Pharmacy.find(query)
            .select('name profileImage city state country address location rating totalReviews isHomeDeliveryAvailable is24x7 documents.pharmacyImages')
            .lean();

        let finalPharmacies = [];
        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Pharmacy', isActive: true });
        const maxRadius = limitConfig ? limitConfig.kmLimit : 100;

        for (let pharma of pharmacies) {
            let distance = null;
            if (pharma.location?.lat) {
                distance = await getDistance(filterLat, filterLng, pharma.location.lat, pharma.location.lng);
            }

            const isBroadSearch = !!(city || search);
            if (isBroadSearch || (distance !== null && distance <= maxRadius)) {
                finalPharmacies.push({
                    ...pharma,
                    distance: distance ? distance.toFixed(1) : "N/A",
                    openStatus: pharma.is24x7 ? "Open 24/7" : "Open Now"
                });
            }
        }

        finalPharmacies.sort((a, b) => {
            if (a.distance === "N/A") return 1;
            return parseFloat(a.distance) - parseFloat(b.distance);
        });

        res.json({ success: true, count: finalPharmacies.length, data: finalPharmacies });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. GET PHARMACY DETAILS
const getPharmacyDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const pharmacy = await Pharmacy.findById(id).select('-password -token').lean();
        
        if (!pharmacy) return res.status(404).json({ message: "Pharmacy not found" });

        res.json({ 
            success: true, 
            data: {
                ...pharmacy,
                gallery: pharmacy.documents?.pharmacyImages || []
            } 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getTrendingMedicinesNearUser = async (req, res) => {
    try {
        // 1. Coordinates Logic (User GPS or Delhi Fallback)
        const lat = req.body.lat || req.query.lat || DEFAULT_LAT;
        const lng = req.body.lng || req.query.lng || DEFAULT_LNG;

        // 2. Fetch Radius Limit for Pharmacies
        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Pharmacy', isActive: true });
        const maxRadius = limitConfig ? limitConfig.kmLimit : 50;

        // 3. Pehle Approved & Active Pharmacies dhoondo jo radius ke andar hain
        const allPharmacies = await Pharmacy.find({ 
            profileStatus: 'Approved', 
            isActive: true 
        }).select('location name').lean();

        const nearbyPharmacyIds = [];
        for (let p of allPharmacies) {
            if (p.location?.lat) {
                const dist = await getDistance(parseFloat(lat), parseFloat(lng), p.location.lat, p.location.lng);
                if (dist <= maxRadius) {
                    nearbyPharmacyIds.push(p._id);
                }
            }
        }

        if (nearbyPharmacyIds.length === 0) {
            return res.json({ success: true, message: "No pharmacies found near you", data: [] });
        }

        // 4. In Pharmacies ke inventory se unique Medicines uthao
        // Aggregation use kar rahe hain taaki duplicate medicines na aayein
        const trendingMeds = await MedicineInventory.aggregate([
            { 
                $match: { 
                    pharmacyId: { $in: nearbyPharmacyIds }, 
                    is_available: true,
                    stock_quantity: { $gt: 0 }
                } 
            },
            {
                $group: {
                    _id: "$medicineId",
                    bestPrice: { $min: "$vendor_price" }, // Paas ki shops mein sabse sasta rate
                    availableAt: { $first: "$pharmacyId" } // Example shop
                }
            },
            { $limit: 20 }, // Trending list ke liye top 20
            {
                $lookup: {
                    from: "medicines", // Medicine collection name
                    localField: "_id",
                    foreignField: "_id",
                    as: "details"
                }
            },
            { $unwind: "$details" },
            {
                $project: {
                    _id: 1,
                    medicineId: "$_id",
                    name: "$details.name",
                    image: { $arrayElemAt: ["$details.image_url", 0] },
                    mrp: "$details.mrp",
                    bestPrice: 1,
                    discount: {
                        $round: [
                            {
                                $multiply: [
                                    { $divide: [{ $subtract: [{ $toDouble: "$details.mrp" }, "$bestPrice"] }, { $toDouble: "$details.mrp" }] },
                                    100
                                ]
                            },
                            0
                        ]
                    },
                    salt: "$details.salt_composition"
                }
            }
        ]);

        res.json({
            success: true,
            count: trendingMeds.length,
            radius: `${maxRadius} km`,
            locationApplied: (req.body.lat) ? "User GPS" : "Delhi (Default)",
            data: trendingMeds
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 1. GET STANDARD LIST (Dawaiyan jinke sabse zyada vendors hain wo pehle)
// endpoint: GET /user/medicine/standard-list
const getStandardMedicineCatalog = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;
        
        // Extract category and subCategory from query params
        const { category, subCategory } = req.query;

        // 1. Build Dynamic bread_crumb Filter (From getMedicineCategoryDetails logic)
        let filter = {};
        if (category) {
            const breadcrumbRegex = subCategory 
                ? new RegExp(`^${category}\\s*>\\s*${subCategory}`, 'i')
                : new RegExp(`^${category}\\s*>`, 'i');
            filter.bread_crumb = breadcrumbRegex;
        }

        // 2. Build Pipeline
        const pipeline = [];

        // Apply category filter if provided
        if (category) {
            pipeline.push({ $match: filter });
        }

        // Maintain the standard catalog logic
        pipeline.push(
            {
                $lookup: {
                    from: "medicineinventories", // Collection name
                    localField: "_id",
                    foreignField: "medicineId",
                    as: "sellers"
                }
            },
            {
                $addFields: {
                    vendorCount: { $size: "$sellers" },
                    minPrice: {
                        $cond: {
                            if: { $gt: [{ $size: "$sellers" }, 0] },
                            then: { $min: "$sellers.vendor_price" },
                            else: null 
                        }
                    }
                }
            },
            { 
                // Remove raw sellers list to keep payload clean
                $project: {
                    sellers: 0 
                }
            },
            { 
                $sort: { vendorCount: -1, name: 1 } 
            },
            { 
                $skip: skip 
            },
            { 
                $limit: limit 
            }
        );

        // Fetch paginated data and dynamic count in parallel for optimization
        const [aggregate, total] = await Promise.all([
            Medicine.aggregate(pipeline),
            Medicine.countDocuments(filter)
        ]);

        // Keep the exact same response structure
        res.json({
            success: true,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            data: aggregate
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. GET medicine with all VENDORS FOR A SPECIFIC MEDICINE
// endpoint: GET /user/medicine/vendors/:medicineId?lat=28.6&lng=77.2
const getMedicineVendors = async (req, res) => {
    try {
        const { medicineId } = req.params;
        
        // --- SAFE COORDINATE EXTRACTION ---
        // Optional chaining (?.) use kiya hai taaki agar body missing ho toh crash na ho
        const filterLat = req?.body?.lat || req?.query?.lat || DEFAULT_LAT;
        const filterLng = req?.body?.lng || req?.query?.lng || DEFAULT_LNG;

        const medObjectId = new mongoose.Types.ObjectId(medicineId);
        const masterMedicine = await Medicine.findById(medObjectId).lean();
        if (!masterMedicine) return res.status(404).json({ success: false, message: "Medicine not found" });

        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Pharmacy', isActive: true });
        const maxRadius = limitConfig ? limitConfig.kmLimit : 100;

        const inventoryRecords = await MedicineInventory.find({
            $or: [{ medicineId: medObjectId }, { name: masterMedicine.name }],
            stock_quantity: { $gt: 0 },
            is_available: true
        })
        .populate({
            path: 'pharmacyId',
            match: { profileStatus: 'Approved', isActive: true },
            select: 'name profileImage rating totalReviews location city state address isHomeDeliveryAvailable is24x7 profileStatus isActive'
        })
        .lean();

        const availableInPharmacies = [];
        let minPriceFound = null;

        for (let item of inventoryRecords) {
            if (!item.pharmacyId) continue;

            const pharmacy = item.pharmacyId;
            let distance = null;

            // --- SAFE LOCATION CHECK ---
            if (pharmacy.location && typeof pharmacy.location.lat !== 'undefined') {
                distance = await getDistance(
                    parseFloat(filterLat), 
                    parseFloat(filterLng), 
                    parseFloat(pharmacy.location.lat), 
                    parseFloat(pharmacy.location.lng)
                );
            }

            if (distance !== null && distance <= maxRadius) {
                if (minPriceFound === null || item.vendor_price < minPriceFound) {
                    minPriceFound = item.vendor_price;
                }

                availableInPharmacies.push({
                    pharmacyId: pharmacy._id,
                    name: pharmacy.name,
                    image: pharmacy.profileImage,
                    rating: pharmacy.rating,
                    totalReviews: pharmacy.totalReviews,
                    address: `${pharmacy.city}, ${pharmacy.state}`,
                    distance: distance.toFixed(1),
                    price: item.vendor_price,
                    mrp: masterMedicine.mrp,
                    discount: masterMedicine.mrp > item.vendor_price ? 
                        Math.round(((masterMedicine.mrp - item.vendor_price) / masterMedicine.mrp) * 100) : 0,
                    stock: item.stock_quantity,
                    isHomeDelivery: pharmacy.isHomeDeliveryAvailable,
                    isOpen: pharmacy.is24x7 ? "Open 24/7" : "Open Now",
                    inventoryId: item._id
                });
            }
        }

        availableInPharmacies.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));

        res.json({
            success: true,
            maxRadius: `${maxRadius} km`,
            locationApplied: (req?.body?.lat || req?.query?.lat) ? "User GPS" : "Delhi (Default)",
            count: availableInPharmacies.length,
            data: { 
                medicineDetails: { 
                    ...masterMedicine, 
                    minPrice: minPriceFound,
                    totalSellers: availableInPharmacies.length 
                }, 
                availableInPharmacies: availableInPharmacies 
            }
        });

    } catch (error) { 
        console.error("Crash Error:", error.message);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

   




// --- NEW: GET PHARMACY SLOTS (Mirroring Lab) ---
const getPharmacySlots = async (req, res) => {
    try {
        const { pharmacyId, date } = req.query; // date format: YYYY-MM-DD
        
        if (!pharmacyId || !date) {
            return res.status(400).json({ success: false, message: "Pharmacy ID and Date are required" });
        }

        // 1. Fetch Availability Configuration
        const config = await Availability.findOne({ vendorId: pharmacyId });
        if (!config) {
            return res.status(404).json({ success: false, message: "Pharmacy timings not configured" });
        }

        // 2. Check for Weekly Off-days (e.g., Sunday)
        const dayName = moment(date).format('dddd');
        if (config.offDays.includes(dayName)) {
            return res.json({ 
                success: true, 
                isClosed: true, 
                message: `Pharmacy is closed on ${dayName}s`, 
                slots: [] 
            });
        }

        // 3. Check for Specific Blocked Dates (Holidays)
        if (config.blockedDates && config.blockedDates.includes(date)) {
            return res.json({ 
                success: true, 
                isClosed: true, 
                message: "Pharmacy is closed on this specific date", 
                slots: [] 
            });
        }

        // 4. Generate base slots using helper
        const allGeneratedSlots = generateTimeSlots(config);

        // 5. Occupancy/Capacity Logic: Calculate existing bookings for this pharmacy on this date
        // PharmacyBooking (MedicineOrder) model ka use karke booked slots nikalna
        const bookedCounts = await PharmacyBooking.aggregate([
            {
                $match: {
                    pharmacyId: new mongoose.Types.ObjectId(pharmacyId),
                    appointmentDate: date, // Agar DB mein string format hai toh direct match, warna format adjust karein
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

        // 6. Merge Booking count with Generated Slots
        const finalSlots = allGeneratedSlots.map(slot => {
            const booking = bookedCounts.find(b => b._id === slot.time);
            const currentCount = booking ? booking.count : 0;

            return {
                ...slot, // Includes time, category, extraFee from helper
                currentBookings: currentCount,
                // Agar maxClientsPerSlot 0 hai toh unlimited, warna check karein
                isFull: config.maxClientsPerSlot !== 0 && currentCount >= config.maxClientsPerSlot
            };
        });

        res.json({
            success: true,
            isClosed: false,
            pharmacyId,
            slots: finalSlots
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
const getPharmacyDeliveryCharges = async (req, res) => {
    try {
        const userId = req.user.id;
        const cart = await Cart.findOne({ userId });

        if (!cart || !cart.pharmacyCart || !cart.pharmacyCart.pharmacyId) {
            return res.status(400).json({ 
                success: false, 
                message: "No pharmacy selected in cart." 
            });
        }

        const pharmacyId = cart.pharmacyCart.pharmacyId;

        // Pharmacy specific delivery charges
        let charges = await DeliveryCharge.findOne({ vendorId: pharmacyId });

        if (!charges) {
            return res.json({ 
                success: true, 
                isDefault: true,
                data: { 
                    fixedPrice: 40,           // Standard Delivery Fee
                    fastDeliveryExtra: 29,    // Rapid 1-hour delivery extra
                    minOrderForFreeDelivery: 500 
                } 
            });
        }
        
        res.json({ success: true, data: charges });

    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};
const getPharmacyAvailableCoupons = async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. User ki cart se Pharmacy ID aur Total Amount nikalein
        const cart = await Cart.findOne({ userId });
        
        if (!cart || !cart.pharmacyCart || !cart.pharmacyCart.pharmacyId || cart.pharmacyCart.items.length === 0) {
            return res.status(400).json({ success: false, message: "Cart is empty or no pharmacy selected" });
        }

        const pharmacyId = cart.pharmacyCart.pharmacyId;
        // Total calculate karein (Price * Quantity)
        const itemTotal = cart.pharmacyCart.items.reduce((acc, i) => acc + (i.price * i.quantity), 0);
        const today = new Date();

        // 2. Coupons Fetch Karein: 
        // A. Jo is specific Pharmacy ke hon.
        // B. Jo Admin ne banaye hon specifically 'Pharmacy' ya 'All' category ke liye.
        const coupons = await Coupon.find({ 
            isActive: true,
            expiryDate: { $gte: today }, 
            $or: [
                { vendorId: pharmacyId }, // Specific Pharmacy coupons
                { 
                    isAdminCreated: true, 
                    vendorType: { $in: ['Pharmacy', 'All'] } // Global Pharmacy coupons
                }
            ]
        }).sort({ createdAt: -1 });

        // 3. Validation Logic: Check karein kaunsa apply ho sakta hai
        const validatedCoupons = coupons.map(coupon => {
            let isApplicable = true;
            let reason = "Coupon is available";
            let amountShort = 0;

            // A. Check Min Order Amount
            if (itemTotal < coupon.minOrderAmount) {
                isApplicable = false;
                amountShort = coupon.minOrderAmount - itemTotal;
                reason = `Add ₹${amountShort} more to apply this coupon.`;
            }

            // B. Check User Usage Limit
            const userUsage = coupon.usedBy.find(u => u.userId.toString() === userId.toString());
            if (userUsage && userUsage.usageCount >= coupon.maxUsagePerUser) {
                isApplicable = false;
                reason = "Limit reached for this coupon.";
            }

            return {
                ...coupon._doc,
                isApplicable,
                validationMessage: reason,
                amountShort,
                potentialDiscount: Math.min((itemTotal * coupon.discountPercentage) / 100, coupon.maxDiscount)
            };
        });

        res.json({ 
            success: true, 
            cartTotal: itemTotal,
            data: validatedCoupons 
        });

    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};
const validateCoupon = async (req, res) => {
    try {
        const { couponName, pharmacyId, totalAmount } = req.body;
        const coupon = await Coupon.findOne({ 
            couponName, 
            vendorId: pharmacyId, 
            isActive: true,
            expiryDate: { $gte: new Date() }
        });

        if (!coupon) return res.status(404).json({ message: "Invalid or expired coupon" });
        if (totalAmount < coupon.minOrderAmount) return res.status(400).json({ message: "Min amount not met" });

        const discount = (totalAmount * coupon.discountPercentage) / 100;
        const finalDiscount = Math.min(discount, coupon.maxDiscount);

        res.json({ success: true, discount: finalDiscount });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// BookPharmacy.js mein checkoutMedicineOrder update karein
// POST /user/pharmacy/checkout
const checkoutMedicineOrder = async (req, res) => {
    try {
        const { couponCode, isRapid, collectionType, appointmentTime, address } = req.body;
        const userId = req.user.id;

        // A. Cart Fetch & Population
        const cart = await Cart.findOne({ userId }).populate('pharmacyCart.items.medicineId');
        if (!cart || !cart.pharmacyCart.items.length) {
            return res.status(400).json({ success: false, message: "Basket is empty. Please add medicines." });
        }

        const pharmacyId = cart.pharmacyCart.pharmacyId;

        // B. Real-time Stock Validation
        const validatedItems = [];
        for (const item of cart.pharmacyCart.items) {
            const inventory = await MedicineInventory.findOne({ 
                pharmacyId, 
                medicineId: item.medicineId._id,
                is_available: true 
            });

            if (!inventory || inventory.stock_quantity < item.quantity) {
                return res.status(400).json({ 
                    success: false, 
                    errorType: "OUT_OF_STOCK",
                    message: `Item '${item.name}' is currently unavailable or out of stock.` 
                });
            }
            validatedItems.push(item);
        }

        // C. Prescription Mandatory Check
        const rxMandatory = validatedItems.some(item => 
            item.medicineId?.prescription_required?.toUpperCase() === "YES"
        );

        // D. Address Validation (If Home Delivery)
        if (collectionType === 'Home Delivery' && (!address || !address.houseNo)) {
            return res.status(400).json({ success: false, message: "Please provide a valid delivery address." });
        }

        // E. Billing Calculation
        const bill = await calculatePharmacyBillHelper(
            pharmacyId, validatedItems, 1, collectionType, couponCode, isRapid, appointmentTime
        );

        // F. Response with all metadata for payment screen
        res.json({
            success: true,
            message: "Checkout validated successfully",
            data: {
                pharmacyId,
                billSummary: bill,
                rxMandatory,
                items: validatedItems.map(i => ({
                    id: i.medicineId._id,
                    name: i.name,
                    qty: i.quantity,
                    price: i.price,
                    total: i.price * i.quantity
                })),
                orderRestrictions: {
                    canPlaceOrder: true,
                    needsPrescription: rxMandatory
                }
            }
        });

    } catch (error) {
        console.error("CHECKOUT_ERROR:", error);
        res.status(500).json({ success: false, message: "Internal server error during checkout." });
    }
};

// 2. PLACE ORDER (Final Step)
// POST /user/pharmacy/place-order
const placeOrder = async (req, res) => {
    try {
        const { 
            appointmentDate, appointmentTime, address, 
            paymentMethod, couponCode, isRapid, collectionType,
            selectedPatientIds 
        } = req.body;

        const userId = req.user.id;
        
        // Final verification before locking the order (Populates master Medicine to read MRP)
        const cart = await Cart.findOne({ userId }).populate('pharmacyCart.items.medicineId');
        if (!cart || !cart.pharmacyCart.items.length) {
            return res.status(400).json({ message: "Transaction expired. Cart is empty." });
        }

        const pharmacyId = cart.pharmacyCart.pharmacyId;

        // 1. Atomic Stock Deduction
        for (const item of cart.pharmacyCart.items) {
            const inventory = await MedicineInventory.findOne({ pharmacyId, medicineId: item.medicineId._id });
            if (!inventory || inventory.stock_quantity < item.quantity) {
                return res.status(400).json({ message: `Stock mismatch for ${item.name}. Please refresh cart.` });
            }
            inventory.stock_quantity -= item.quantity;
            if (inventory.stock_quantity <= 0) inventory.is_available = false;
            await inventory.save();
        }

        // 2. Handle Prescription
        let rxImages = [];
        if (req.files && req.files['prescriptionImages']) {
            rxImages = req.files['prescriptionImages'].map(f => f.path);
        }

        // 3. Final Bill calculation
        const bill = await calculatePharmacyBillHelper(
            pharmacyId, cart.pharmacyCart.items, 1, collectionType, couponCode, isRapid, appointmentTime
        );

        // --- UPDATED: Map Cart items dynamically to capture database MRPs safely ---
        const mappedOrderItems = cart.pharmacyCart.items.map(item => {
            // item.medicineId contains populated master medicine details from DB
            const masterMedsMrp = item.medicineId ? Number(item.medicineId.mrp || 0) : 0;
            return {
                medicineId: item.medicineId._id,
                name: item.name,
                mrp: masterMedsMrp, // Capture standard admin MRP from master Medicine db
                price: item.price,
                quantity: item.quantity,
                duration: item.duration,
                startDate: item.startDate
            };
        });

        // 4. Create Order
        const order = await PharmacyBooking.create({
            orderId: `MED-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
            userId,
            pharmacyId,
            patients: await mapPatients(userId, selectedPatientIds || ['Self']),
            items: mappedOrderItems, // Mapped array carrying MRP values
            collectionType,
            address: typeof address === 'string' ? JSON.parse(address) : address,
            appointmentDate,
            appointmentTime,
            billSummary: bill,
            paymentMethod: paymentMethod || 'COD',
            orderType: rxImages.length > 0 ? 'Prescription' : 'General',
            prescriptionImages: rxImages,
            status: rxImages.length > 0 ? 'Under Review' : 'Placed',
            paymentStatus: paymentMethod === 'COD' ? 'Pending' : 'Paid'
        });

        // 5. Clear User Cart
        await Cart.findOneAndUpdate({ userId }, { $set: { "pharmacyCart.items": [], "pharmacyCart.pharmacyId": null } });

        res.status(201).json({ 
            success: true, 
            message: "Order has been placed successfully!", 
            orderId: order.orderId,
            data: order 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


const uploadPrescription = async (req, res) => {
    try {
        const { address, pharmacyId } = req.body;
        if (!req.files || req.files.length === 0) return res.status(400).json({ message: "Upload prescription" });

        const images = req.files.map(f => f.path);

        const order = await PharmacyBooking.create({
            orderId: `MED-RX-${crypto.randomInt(1000, 9999)}`,
            userId: req.user.id,
            pharmacyId,
            address,
            prescriptionImages: images,
            orderType: 'Prescription-Based',
            status: 'Under Review' // Figma Screen: "Order Review in Progress"
        });

        res.json({ success: true, message: "Pharmacist will verify your prescription", orderId: order.orderId });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const cancelMedicineOrder = async (req, res) => {
    try {
        const { reason } = req.body;
        const order = await PharmacyBooking.findOne({ _id: req.params.id, userId: req.user.id });

        if (['Out for Delivery', 'Delivered'].includes(order.status)) {
            return res.status(400).json({ message: "Cannot cancel order now." });
        }

        order.status = 'Cancelled';
        order.cancelReason = reason;
        await order.save();

        res.json({ success: true, message: "Order cancelled" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};



const getOrderHistory = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20; // Pagination strictly set to 20
        const skip = (page - 1) * limit;

        const userId = req.user.id;
        
        const orders = await PharmacyBooking.find({ userId })
            .populate('pharmacyId', 'name profileImage city')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await PharmacyBooking.countDocuments({ userId });

        res.json({
            success: true,
            count: orders.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: orders
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
const trackOrder = async (req, res) => {
    try {
        const order = await PharmacyBooking.findOne({ _id: req.params.orderId, userId: req.user.id })
            .populate('pharmacyId', 'name address phone');
        res.json({ success: true, data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getLatestAddedMedicines = async (req, res) => {
    try {
        const latestMeds = await MedicineInventory.aggregate([
            // 1. Sirf wahi medicines uthayein jo stock mein hain aur available hain
            {
                $match: {
                    is_available: true,
                    stock_quantity: { $gt: 0 }
                }
            },
            // 2. Latest additions ke hisab se sort karein
            {
                $sort: { createdAt: -1 }
            },
            // 3. Medicine ID ke base par group karein taaki duplicate medicines repeat na ho (no data overwrite/duplication)
            {
                $group: {
                    _id: "$medicineId",
                    latestInventoryId: { $first: "$_id" },
                    latestVendorPrice: { $first: "$vendor_price" },
                    pharmacyId: { $first: "$pharmacyId" },
                    latestCreatedAt: { $first: "$createdAt" }
                }
            },
            // 4. Grouping ke baad fir se global latest added order maintain karein
            {
                $sort: { latestCreatedAt: -1 }
            },
            // 5. Sirf top 10 records limit karein
            {
                $limit: 10
            },
            // 6. Master Medicine collection se details match karein
            {
                $lookup: {
                    from: "medicines",
                    localField: "_id",
                    foreignField: "_id",
                    as: "details"
                }
            },
            { $unwind: "$details" },
            // 7. UI ke liye data format aur output fields select karein
            {
                $project: {
                    _id: 0,
                    medicineId: "$_id",
                    inventoryId: "$latestInventoryId",
                    pharmacyId: 1,
                    name: "$details.name",
                    image: { $arrayElemAt: ["$details.image_url", 0] },
                    mrp: "$details.mrp",
                    bestPrice: "$latestVendorPrice",
                    discount: {
                        $cond: {
                            if: { 
                                $and: [
                                    { $ne: ["$details.mrp", null] },
                                    { $gt: [{ $toDouble: { $ifNull: ["$details.mrp", "0"] } }, 0] }
                                ]
                            },
                            then: {
                                $round: [
                                    {
                                        $multiply: [
                                            {
                                                $divide: [
                                                    { $subtract: [{ $toDouble: { $ifNull: ["$details.mrp", "0"] } }, "$latestVendorPrice"] },
                                                    { $toDouble: { $ifNull: ["$details.mrp", "1"] } }
                                                ]
                                            },
                                            100
                                        ]
                                    },
                                    0
                                ]
                            },
                            else: 0
                        }
                    },
                    salt: "$details.salt_composition",
                    addedAt: "$latestCreatedAt"
                }
            }
        ]);

        res.json({
            success: true,
            count: latestMeds.length,
            data: latestMeds
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET OTC / NON-PRESCRIPTION MEDICINES (PRESCRIPTION REQUIRED: NO)
// GET OTC MEDICINES WITH OPTIONAL CATEGORY FILTER
const getNonPrescriptionMedicines = async (req, res) => {
    try {
        const { category, subCategory, page = 1 } = req.query;
        const limit = 20;
        const skip = (parseInt(page) - 1) * limit;

        // Base filter: Only fetch medicines where prescription is not required
        const filter = {
            prescription_required: { $regex: /^(no|false)$/i }
        };

        // If category query parameter is provided, add bread_crumb regex filter
        if (category) {
            const breadcrumbRegex = subCategory 
                ? new RegExp(`^${category}\\s*>\\s*${subCategory}`, 'i')
                : new RegExp(`^${category}\\s*>`, 'i');
            filter.bread_crumb = breadcrumbRegex;
        }

        const pipeline = [
            { $match: filter },
            {
                // Dynamic inventory check for lowest seller price
                $lookup: {
                    from: "medicineinventories",
                    localField: "_id",
                    foreignField: "medicineId",
                    as: "inventory",
                    pipeline: [
                        { $match: { is_available: true, stock_quantity: { $gt: 0 } } },
                        { $sort: { vendor_price: 1 } },
                        { $limit: 1 }
                    ]
                }
            },
            {
                $addFields: {
                    numMRP: { $toDouble: { $ifNull: ["$mrp", 0] } },
                    numDocBestPrice: { $toDouble: { $ifNull: ["$best_price", 0] } },
                    numInventoryPrice: { $toDouble: { $arrayElemAt: ["$inventory.vendor_price", 0] } },
                    isInventoryAvailable: { $gt: [{ $size: "$inventory" }, 0] }
                }
            },
            {
                $addFields: {
                    minimumPrice: {
                        $cond: [
                            "$isInventoryAvailable",
                            "$numInventoryPrice",
                            "$numDocBestPrice"
                        ]
                    },
                    isAvailable: "$isInventoryAvailable"
                }
            },
            {
                $addFields: {
                    // Dynamic discount calculation
                    discountPercentage: {
                        $cond: {
                            if: { $gt: ["$numMRP", 0] },
                            then: {
                                $round: [
                                    {
                                        $multiply: [
                                            { $divide: [{ $subtract: ["$numMRP", "$minimumPrice"] }, "$numMRP"] },
                                            100
                                        ]
                                    },
                                    0
                                ]
                            },
                            else: 0
                        }
                    }
                }
            },
            { 
                $project: { 
                    inventory: 0, numMRP: 0, numDocBestPrice: 0, numInventoryPrice: 0, isInventoryAvailable: 0 
                } 
            },
            { $skip: skip },
            { $limit: limit }
        ];

        // Parallel operations for pagination & aggregation
        const [data, total] = await Promise.all([
            Medicine.aggregate(pipeline),
            Medicine.countDocuments(filter)
        ]);

        res.json({
            success: true,
            total,
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            data
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getHighestDiscountMedicines = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;

        const pipeline = [
            {
                // Match only those medicines that have valid MRP values
                $match: {
                    mrp: { $exists: true, $ne: null, $ne: "" }
                }
            },
            {
                // Fetch dynamic lowest vendor price from inventory
                $lookup: {
                    from: "medicineinventories",
                    localField: "_id",
                    foreignField: "medicineId",
                    as: "inventory",
                    pipeline: [
                        { $match: { is_available: true, stock_quantity: { $gt: 0 } } },
                        { $sort: { vendor_price: 1 } },
                        { $limit: 1 }
                    ]
                }
            },
            {
                $addFields: {
                    numMRP: { $toDouble: { $ifNull: ["$mrp", 0] } },
                    numDocBestPrice: { $toDouble: { $ifNull: ["$best_price", 0] } },
                    numInventoryPrice: { $toDouble: { $arrayElemAt: ["$inventory.vendor_price", 0] } },
                    isInventoryAvailable: { $gt: [{ $size: "$inventory" }, 0] }
                }
            },
            {
                $addFields: {
                    // Choose seller price if available, otherwise master price
                    minimumPrice: {
                        $cond: [
                            "$isInventoryAvailable",
                            "$numInventoryPrice",
                            "$numDocBestPrice"
                        ]
                    },
                    isAvailable: "$isInventoryAvailable"
                }
            },
            {
                $addFields: {
                    // Dynamic discount percentage calculation
                    discountPercentage: {
                        $cond: {
                            if: { $gt: ["$numMRP", 0] },
                            then: {
                                $round: [
                                    {
                                        $multiply: [
                                            { $divide: [{ $subtract: ["$numMRP", "$minimumPrice"] }, "$numMRP"] },
                                            100
                                        ]
                                    },
                                    0
                                ]
                            },
                            else: 0
                        }
                    }
                }
            },
            {
                // Filter out items with 0% discount
                $match: {
                    discountPercentage: { $gt: 0 }
                }
            },
            {
                // Sort by highest discount percentage in decreasing order
                $sort: {
                    discountPercentage: -1,
                    name: 1
                }
            },
            { 
                $project: { 
                    inventory: 0, numMRP: 0, numDocBestPrice: 0, numInventoryPrice: 0, isInventoryAvailable: 0 
                } 
            },
            {
                // Dynamic Facet stage: Calculates total count & paginated records in parallel
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [{ $skip: skip }, { $limit: limit }]
                }
            }
        ];

        const result = await Medicine.aggregate(pipeline);
        
        // Safety checks to handle empty database states gracefully
        const total = result[0].metadata[0]?.total || 0;
        const data = result[0].data || [];

        res.json({
            success: true,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            data
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


/////////////////////////////////////////
//// ai scan prescription /////////////
///////////////////////////////////////

// 1. GET USER'S PRESCRIPTION REQUESTS LIST
const getUserPrescriptionRequests = async (req, res) => {
    try {
        const userId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;

        const requests = await PharmacyPrescriptionRequest.find({ userId })
            .populate('pharmacyId', 'name profileImage city state')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await PharmacyPrescriptionRequest.countDocuments({ userId });

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
const estimateRxPrices = async (req, res) => {
    try {
        const { pharmacyId, medicines } = req.body;

        if (!pharmacyId || !medicines || !medicines.length) {
            return res.status(400).json({ success: false, message: "Pharmacy ID and medicines list are required" });
        }

        let estimatedTotal = 0;
        const pricedMedicines = [];

        for (const med of medicines) {
            let pricePerUnit = 0;
            let mrp = 0;
            let matchedInInventory = false;

            // Search in inventory
            const inventory = await MedicineInventory.findOne({
                pharmacyId,
                $or: [
                    { medicineId: mongoose.isValidObjectId(med.medicineId) ? med.medicineId : new mongoose.Types.ObjectId() },
                    { name: new RegExp(`^${med.name}$`, 'i') }
                ],
                is_available: true
            }).populate('medicineId');

            if (inventory) {
                pricePerUnit = inventory.vendor_price;
                mrp = inventory.medicineId ? Number(inventory.medicineId.mrp || 0) : 0;
                matchedInInventory = true;
            } else {
                // Safe DB Fallback
                const masterMed = await Medicine.findOne({ name: new RegExp(`^${med.name}$`, 'i') });
                if (masterMed) {
                    mrp = Number(masterMed.mrp || 0);
                    pricePerUnit = Number(masterMed.best_price || masterMed.mrp || 0);
                } else {
                    mrp = Number(med.mrp || 0); // User/AI parsed fallback
                    pricePerUnit = mrp > 0 ? mrp * 0.9 : 15; // default fallback 10% discount estimation
                }
            }

            const calculatedQty = Math.max(1, (med.durationDays || 15));
            const subtotal = pricePerUnit * calculatedQty;
            estimatedTotal += subtotal;

            pricedMedicines.push({
                name: med.name,
                durationDays: med.durationDays,
                mrp,
                pricePerUnit,
                totalPrice: subtotal,
                available: matchedInInventory
            });
        }

        res.json({
            success: true,
            estimatedTotal: Math.round(estimatedTotal),
            medicines: pricedMedicines
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. GET SINGLE REQUEST DETAILS (फिग्मा प्रोग्रेस बार और बिल देखने के लिए)
const getUserPrescriptionRequestDetails = async (req, res) => {
    try {
        const { requestId } = req.params;
        const userId = req.user.id;

        const request = await PharmacyPrescriptionRequest.findOne({ requestId, userId })
            .populate('pharmacyId', 'name phone profileImage address location city');

        if (!request) {
            return res.status(404).json({ success: false, message: "Inquiry details not found" });
        }

        // Safety fallback checks during serialization so GET APIs never crash
        const responseData = request.toObject();
        if (responseData.verifiedBill && responseData.verifiedBill.items) {
            responseData.verifiedBill.items = responseData.verifiedBill.items.map(item => ({
                ...item,
                medicineId: item.medicineId || null,
                mrp: item.mrp || 0,
                pricePerUnit: item.pricePerUnit || 0,
                totalPrice: item.totalPrice || 0
            }));
        }

        res.json({
            success: true,
            data: responseData
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// 1. CREATE PRESCRIPTION REQUEST (User submits uploaded RX, Pharmacy, Duration, and Address)
const createPrescriptionRequest = async (req, res) => {
    try {
        const { pharmacyId, doctorName, prescriptionDate, durationType, requestedMedicines, address } = req.body;
        const userId = req.user.id;

        if (!req.file) {
            return res.status(400).json({ success: false, message: "Please upload prescription image file" });
        }

        const parsedMedicines = typeof requestedMedicines === 'string' ? JSON.parse(requestedMedicines) : requestedMedicines;

        // Populate baseline MRPs inside user request data safely
        const verifiedRequestedMeds = [];
        for (const med of parsedMedicines) {
            const dbMed = await Medicine.findOne({ name: new RegExp(`^${med.name}$`, 'i') }).select('mrp').lean();
            verifiedRequestedMeds.push({
                name: med.name,
                dosage: med.dosage || '1-0-1',
                durationDays: Number(med.durationDays || 15),
                isSelected: med.isSelected !== false,
                mrp: dbMed ? Number(dbMed.mrp || 0) : Number(med.mrp || 0)
            });
        }

        const newRequest = await PharmacyPrescriptionRequest.create({
            requestId: `REQ-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
            userId,
            pharmacyId,
            doctorName: doctorName || 'Prescription Request',
            prescriptionDate: prescriptionDate ? new Date(prescriptionDate) : new Date(),
            prescriptionImage: req.file.path,
            durationType,
            requestedMedicines: verifiedRequestedMeds,
            address: typeof address === 'string' ? JSON.parse(address) : address,
            status: 'Pending Review'
        });

        res.status(201).json({
            success: true,
            message: "Prescription request placed",
            data: newRequest
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. PAY AND CONVERT REQUEST TO FINAL ORDER (Promotes Request to PharmacyBooking model)
// POST /user/pharmacy/prescription-request/pay-confirm
const payAndConfirmOrder = async (req, res) => {
    try {
        const { requestId, paymentMethod } = req.body;
        const userId = req.user.id;

        // 1. Fetch the target prescription request and ensure it belongs to the logged-in user
        const request = await PharmacyPrescriptionRequest.findOne({ requestId, userId });
        if (!request) {
            return res.status(404).json({ success: false, message: "Prescription request not found" });
        }

        // 2. Business validation: Enforce sequential state flow limits
        if (request.status !== 'Bill Generated') {
            return res.status(400).json({ 
                success: false, 
                message: `Request status is currently '${request.status}'. Payment can only be completed for 'Bill Generated' status.` 
            });
        }

        // 3. Atomic stock deduction for mapped medicines
        if (request.verifiedBill && request.verifiedBill.items && request.verifiedBill.items.length > 0) {
            for (const billItem of request.verifiedBill.items) {
                // Safeguard: Skip stock deduction if pharmacist couldn't map the manual drug to a DB ObjectId
                if (!billItem.medicineId || !mongoose.isValidObjectId(billItem.medicineId)) {
                    continue;
                }

                const inventory = await MedicineInventory.findOne({ 
                    pharmacyId: request.pharmacyId, 
                    medicineId: billItem.medicineId 
                });
                
                if (inventory) {
                    // Decrement and ensure stock never drops below 0
                    inventory.stock_quantity = Math.max(0, inventory.stock_quantity - (billItem.quantity || 1));
                    if (inventory.stock_quantity === 0) {
                        inventory.is_available = false;
                    }
                    await inventory.save();
                }
            }
        }

        // 4. Map verified bill items to the permanent Order scheme, carrying over the administrative MRPs
        const orderItems = (request.verifiedBill.items || []).map(item => {
            // Find corresponding custom duration matching on the medicine name string
            const matchingRequestedMed = request.requestedMedicines.find(rm => 
                rm.name.trim().toLowerCase() === item.name.trim().toLowerCase()
            );
            const durationDays = matchingRequestedMed ? Number(matchingRequestedMed.durationDays || 15) : 15;

            return {
                medicineId: item.medicineId || null, // Stores unmapped manual items safely as null
                name: item.name,
                mrp: Number(item.mrp || 0),         // Captures administrative MRP verified by pharmacist
                price: Number(item.pricePerUnit || 0), // Final customer selling price
                quantity: Number(item.quantity || 1),
                duration: `${durationDays} Days`
            };
        });

        // 5. Convert request data to a permanent order (PharmacyBooking) with Placed/Paid status metadata
        const finalOrder = await PharmacyBooking.create({
            orderId: `MED-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
            userId,
            pharmacyId: request.pharmacyId,
            patients: [{ 
                name: request.address ? request.address.name : "Patient", 
                relation: 'Self' 
            }],
            items: orderItems,
            collectionType: 'Home Delivery',
            address: request.address || {},
            appointmentDate: new Date(),
            appointmentTime: 'Immediate',
            billSummary: {
                itemTotal: request.verifiedBill.itemTotal || 0,
                deliveryCharge: request.verifiedBill.deliveryCharge || 0,
                totalAmount: request.verifiedBill.totalAmount || 0
            },
            paymentMethod: paymentMethod || 'Online',
            paymentStatus: 'Paid',
            orderType: 'Prescription',
            prescriptionImages: request.prescriptionImage ? [request.prescriptionImage] : [],
            status: 'Placed'
        });

        // 6. Transition prescription request status to 'Paid' to lock state
        request.status = 'Paid';
        await request.save();

        res.status(201).json({
            success: true,
            message: "Payment successful! Request converted to order.",
            orderId: finalOrder.orderId,
            data: finalOrder
        });
    } catch (error) {
        console.error("Payment Confirmation API Error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = {scanPrescription,getMedicineSuggestions,getMedicineFullDetails,getMedicineCategories,getPharmacySubCategories,getMedicineCategoryDetails,getPharmacySearchSuggestions,getPharmacyNameSuggestions, getPharmacies, getPharmacyDetails,getTrendingMedicinesNearUser, getStandardMedicineCatalog,getMedicineVendors,
   getPharmacySlots,getPharmacyDeliveryCharges, checkoutMedicineOrder,getPharmacyAvailableCoupons,validateCoupon,uploadPrescription,cancelMedicineOrder, placeOrder,getOrderHistory, trackOrder,
getLatestAddedMedicines ,getNonPrescriptionMedicines,getHighestDiscountMedicines,

createPrescriptionRequest, payAndConfirmOrder,getUserPrescriptionRequests,getUserPrescriptionRequestDetails,estimateRxPrices
};