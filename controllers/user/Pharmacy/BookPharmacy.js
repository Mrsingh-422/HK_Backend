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
const PharmacyComboOffer = require('../../../models/PharmacyComboOffer'); // Import model
const Review = require('../../../models/Review'); // Import Review model for rating functionality
const ComboOffer = require('../../../models/PharmacyComboOffer'); // Import ComboOffer model

const { createRazorpayOrder, verifyRazorpaySignature, fetchAndMapRazorpayPayment } = require('../../../utils/razorpay'); // 👈 Razorpay Helpers Imported
const { sendPushNotification, notifyAdminsAndVendor } = require('../../../utils/notification'); // For Notifications
const { checkAndApplyBenefit, deductBenefitCount, refundBenefitCount } = require('../../../utils/subscriptionBenefitHelper');
const { processCancellationRefund } = require('../../../utils/policyHelper');
const { isCodEnabled } = require('../../../utils/policyHelper');


// --- HELPER: Bill Calculation (Mirroring Lab logic) ---
const calculatePharmacyBillHelper = async (pharmacyId, items, patientsCount, collectionType, couponCode, isRapid, appointmentTime, userId) => {
    let rawItemTotalWithoutPromo = 0; 
    let promoDeductedTotal = 0;       
    let taxableTotal = 0;
    let cgstTotal = 0;
    let sgstTotal = 0;
    const today = new Date();

    for (const item of items) {
        const pricePerUnit = Number(item.price || item.pricePerUnit || 0);
        const orderedQty = Number(item.quantity || 1);
        const medicineId = item.medicineId._id || item.medicineId;

        const activeBatch = await MedicineInventory.findOne({
            pharmacyId,
            medicineId,
            is_available: true,
            stock_quantity: { $gt: 0 }
        }).sort({ expiry_date: 1 });

        const batchMrp = activeBatch ? activeBatch.mrp : (item.medicineId?.mrp ? Number(item.medicineId.mrp) : 0);
        const batchHsn = activeBatch ? activeBatch.hsn_number : null; // Fetch HSN

        rawItemTotalWithoutPromo += (batchMrp * orderedQty);

        let finalItemPrice = 0;
        if (item.isComboApplied === true && item.comboOfferId) {
            const activePromo = await PharmacyComboOffer.findOne({
                _id: item.comboOfferId,
                pharmacyId,
                isActive: true,
                startDate: { $lte: today },
                expiryDate: { $gte: today }
            });

            if (activePromo) {
                const X = activePromo.buyQty;
                const Y = activePromo.getFreeQty;
                const bundleSize = X + Y;
                const fullBundles = Math.floor(orderedQty / bundleSize);
                const remainingUnits = orderedQty % bundleSize;

                const chargeableQty = (fullBundles * X) + Math.min(remainingUnits, X);
                finalItemPrice = pricePerUnit * chargeableQty;
            } else {
                finalItemPrice = pricePerUnit * orderedQty;
            }
        } else {
            finalItemPrice = pricePerUnit * orderedQty;
        }

        promoDeductedTotal += finalItemPrice;

        // 🚨 DYNAMIC GST EVALUATION (Checks if HSN exists)
        let cgstPercent = 0;
        let sgstPercent = 0;

        // Agar product ka HSN code daala gaya hai tabhi GST lagega, nahi toh 0%
        if (batchHsn && batchHsn.trim() !== "" && batchHsn.toUpperCase() !== "N/A") {
            const isSupplement = batchHsn.trim().startsWith('21');
            cgstPercent = isSupplement ? 9 : 6;
            sgstPercent = isSupplement ? 9 : 6;
        }

        const totalGstPercent = cgstPercent + sgstPercent;

        // Agar totalGstPercent 0 hai, toh taxableAmount directly finalItemPrice ke barabar ho jayega
        const itemTaxableAmount = finalItemPrice / (1 + (totalGstPercent / 100));
        const itemCgstAmount = itemTaxableAmount * (cgstPercent / 100);
        const itemSgstAmount = itemTaxableAmount * (sgstPercent / 100);

        taxableTotal += itemTaxableAmount;
        cgstTotal += itemCgstAmount;
        sgstTotal += itemSgstAmount;
    }

    const comboSavings = rawItemTotalWithoutPromo - promoDeductedTotal;

    let deliveryCharge = 0;
    let rapidCharge = 0;
    let slotCharge = 0;
    
    const cleanPharmaId = pharmacyId.toString();
    const charges = await DeliveryCharge.findOne({ vendorId: cleanPharmaId });

    if (collectionType === 'Home Delivery' || collectionType === 'Home Collection') {
        let standardFee = charges ? Number(charges.fixedPrice) : 40;
        const pharmDeliveryBenefit = await checkAndApplyBenefit(userId, 'freePharmacyDeliveriesCount', standardFee);
        deliveryCharge = pharmDeliveryBenefit.amount; 
    }
    
    if (isRapid && (!appointmentTime || appointmentTime === 'Immediate')) {
        rapidCharge = charges ? Number(charges.fastDeliveryExtra) : 29;
    } else {
        rapidCharge = 0;
    }

    if (appointmentTime && appointmentTime !== 'Immediate') {
        const availConfig = await Availability.findOne({ vendorId: cleanPharmaId });
        if (availConfig && availConfig.premiumSlots) {
            const selectedTimeClean = appointmentTime.trim();
            const premiumSlot = availConfig.premiumSlots.find(ps => ps.time.trim() === selectedTimeClean);
            if (premiumSlot) slotCharge = Number(premiumSlot.extraFee) || 0;
        }
    }

    let couponDiscount = 0;
    let couponId = null;
    if (couponCode) {
        const coupon = await Coupon.findOne({ couponName: couponCode.toUpperCase(), isActive: true });
        if (coupon && promoDeductedTotal >= coupon.minOrderAmount) {
            couponDiscount = Math.min((promoDeductedTotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
            couponId = coupon._id;
        }
    }

    const totalAmount = (promoDeductedTotal - couponDiscount) + deliveryCharge + rapidCharge + slotCharge;
    
    return { 
        itemTotal: Math.round(promoDeductedTotal), 
        originalItemTotal: Math.round(rawItemTotalWithoutPromo),
        comboSavings: Math.round(comboSavings), 
        taxableTotal: Number(taxableTotal.toFixed(2)),
        cgstTotal: Number(cgstTotal.toFixed(2)),       
        sgstTotal: Number(sgstTotal.toFixed(2)),       
        couponDiscount: Math.round(couponDiscount), 
        couponId, 
        deliveryCharge, 
        rapidDeliveryCharge: rapidCharge, 
        slotCharge, 
        totalAmount: Math.round(totalAmount) 
    };
};

const deductPharmacyStockFEFO = async (pharmacyId, medicineId, quantityToDeduct) => {
    let remainingToDeduct = Number(quantityToDeduct);

    // Fetch all active batches sorted by earliest expiry date first [cite: 1.1.2]
    const activeBatches = await MedicineInventory.find({
        pharmacyId,
        medicineId,
        is_available: true,
        stock_quantity: { $gt: 0 }
    }).sort({ expiry_date: 1 }); // FEFO Sort

    for (const batch of activeBatches) {
        if (remainingToDeduct <= 0) break;

        const currentStock = batch.stock_quantity;

        if (currentStock >= remainingToDeduct) {
            // This batch has sufficient stock to cover the remaining deduction [1]
            batch.stock_quantity -= remainingToDeduct;
            remainingToDeduct = 0;
        } else {
            // Consume entire batch stock, then transition to next batch
            remainingToDeduct -= currentStock;
            batch.stock_quantity = 0;
        }

        if (batch.stock_quantity === 0) {
            batch.is_available = false;
        }
        await batch.save();
    }

    // Returns true if stock was successfully deducted, false if there was a cumulative shortage
    return remainingToDeduct === 0;
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

        const searchRegex = new RegExp(query, 'i');

        const suggestions = await Medicine.find({
            $or: [
                { name: searchRegex },
                { salt_composition: searchRegex }
            ]
        })
        .select('name salt_composition mrp best_price image_url discont_percent')
        .limit(10)
        .lean();

        // 🚨 Parallel dynamic lookup inside the loop to fetch lowest live vendor prices [cite: 1.1.2]
        const formattedData = await Promise.all(suggestions.map(async (med) => {
            const bestOffer = await MedicineInventory.findOne({ 
                medicineId: med._id, 
                is_available: true,
                stock_quantity: { $gt: 0 }
            }).sort({ vendor_price: 1 }).select('vendor_price').lean();

            const lowestPrice = bestOffer ? bestOffer.vendor_price : null;
            const mrpNum = Number(med.mrp || 0);

            // Overwrite price: use lowest live vendor price if in stock, otherwise fallback safely [cite: 1.1.2]
            const finalPrice = lowestPrice !== null ? lowestPrice : Number(med.best_price || med.mrp || 0);

            // Overwrite discount percent dynamically [cite: 1.1.2]
            let finalDiscount = med.discont_percent;
            if (lowestPrice !== null && mrpNum > 0) {
                finalDiscount = `${Math.round(((mrpNum - lowestPrice) / mrpNum) * 100)}%`;
            }

            return {
                id: med._id,
                name: med.name,
                salt: med.salt_composition,
                price: finalPrice.toString(), // converted to string for strict backward compatibility
                image: med.image_url && med.image_url.length > 0 ? med.image_url[0] : null,
                discount: finalDiscount,
                displayType: med.name.toLowerCase().includes(query.toLowerCase()) ? "Name Match" : "Salt Match",
                isAvailable: lowestPrice !== null // Added extra safety indicator key
            };
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
        const medicine = await Medicine.findById(id).lean();
        if (!medicine) return res.status(404).json({ message: "Not found" });

        // 🚨 DYNAMIC ALTERNATE BRANDS ENRICHMENT FOR DETAIL PAGE
        if (medicine.salt_composition) {
            const similarMeds = await Medicine.find({
                salt_composition: medicine.salt_composition,
                _id: { $ne: medicine._id }
            }).select('name manufacturers mrp best_price discont_percent').limit(6).lean();

            if (similarMeds.length > 0) {
                const formattedAlts = similarMeds.map(med => {
                    const price = med.best_price || med.mrp || "0";
                    const discount = med.discont_percent && med.discont_percent !== "0%" 
                        ? `save ${med.discont_percent}` 
                        : "same price";
                    return `${med.name} :: ${med.manufacturers || 'N/A'} :: ${price}/Tablet :: ${discount}`;
                }).join(' | ');

                medicine.alternate_brand = formattedAlts;
            }
        }

        const bestOffer = await MedicineInventory.findOne({ medicineId: medicine._id, is_available: true, stock_quantity: { $gt: 0 } })
            .sort({ vendor_price: 1 });

        const lowestPrice = bestOffer ? bestOffer.vendor_price : null;
        const batchMrp = bestOffer ? Number(bestOffer.mrp || 0) : Number(medicine.mrp || 0);

        if (lowestPrice !== null) {
            medicine.mrp = batchMrp.toString();
            medicine.best_price = lowestPrice.toString();
            medicine.discont_percent = `${Math.round(((batchMrp - lowestPrice) / batchMrp) * 100)}%`;
        }

        const substitutes = await Medicine.find({ 
            salt_composition: medicine.salt_composition, 
            _id: { $ne: id } 
        }).limit(3).lean();

        const frequentlyBought = await Medicine.find({ 
            category: medicine.category, 
            _id: { $ne: id } 
        }).limit(4).lean();

        const [enrichedSubs, enrichedFreq] = await Promise.all([
            Promise.all(substitutes.map(async (item) => {
                const subOffer = await MedicineInventory.findOne({ medicineId: item._id, is_available: true, stock_quantity: { $gt: 0 } }).sort({ vendor_price: 1 });
                const subLowest = subOffer ? subOffer.vendor_price : null;
                const itemMrp = subOffer ? Number(subOffer.mrp || 0) : Number(item.mrp || 0);
                if (subLowest !== null) {
                    item.mrp = itemMrp.toString();
                    item.best_price = subLowest.toString();
                    if (itemMrp > 0) item.discont_percent = `${Math.round(((itemMrp - subLowest) / itemMrp) * 100)}%`;
                }
                return item;
            })),
            Promise.all(frequentlyBought.map(async (item) => {
                const freqOffer = await MedicineInventory.findOne({ medicineId: item._id, is_available: true, stock_quantity: { $gt: 0 } }).sort({ vendor_price: 1 });
                const freqLowest = freqOffer ? freqOffer.vendor_price : null;
                const itemMrp = freqOffer ? Number(freqOffer.mrp || 0) : Number(item.mrp || 0);
                if (freqLowest !== null) {
                    item.mrp = itemMrp.toString();
                    item.best_price = freqLowest.toString();
                    if (itemMrp > 0) item.discont_percent = `${Math.round(((itemMrp - freqLowest) / itemMrp) * 100)}%`;
                }
                return item;
            }))
        ]);

        res.json({
            success: true,
            data: {
                details: medicine, 
                frequentlyBought: enrichedFreq,
                substitutes: enrichedSubs,
                isAvailable: lowestPrice !== null
            }
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
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
                // 1. Inventory check (Lowest Vendor Price) [cite: 1.1.2]
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
                    numInventoryMRP: { $toDouble: { $arrayElemAt: ["$inventory.mrp", 0] } }, // 👈 Added: Fetch batch MRP [cite: 1.1.2]
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
                    minimumMRP: { // 👈 Added: Dynamic MRP based on batch [cite: 1.1.2]
                        $cond: [
                            "$isInventoryAvailable",
                            "$numInventoryMRP",
                            "$numMRP"
                        ]
                    },
                    isAvailable: "$isInventoryAvailable"
                }
            },
            {
                $addFields: {
                    discountPercentage: {
                        $cond: {
                            if: { $gt: ["$minimumMRP", 0] },
                            then: {
                                $round: [
                                    {
                                        $multiply: [
                                            { $divide: [{ $subtract: ["$minimumMRP", "$minimumPrice"] }, "$minimumMRP"] },
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
                // 🚨 OVERWRITE best_price, mrp, and discont_percent to remove static master data leaks [cite: 1.1.2]
                $addFields: {
                    mrp: { $toString: "$minimumMRP" }, // Overwrite MRP with batch MRP! [cite: 1.1.2]
                    best_price: {
                        $cond: {
                            if: "$isInventoryAvailable",
                            then: { $toString: "$minimumPrice" },
                            else: "$best_price"
                        }
                    },
                    discont_percent: {
                        $cond: {
                            if: { $gt: ["$discountPercentage", 0] },
                            then: { $concat: [{ $toString: "$discountPercentage" }, "%"] },
                            else: "$discont_percent"
                        }
                    }
                }
            },
            { 
                $project: { 
                    inventory: 0, 
                    numMRP: 0, 
                    numDocBestPrice: 0, 
                    numInventoryPrice: 0, 
                    numInventoryMRP: 0,
                    isInventoryAvailable: 0,
                    minimumPrice: 0,
                    minimumMRP: 0,
                    discountPercentage: 0
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

        // Strictly filters: Only APPROVED and ACTIVE pharmacies (Offline ones included)
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

        // Projecting 'isOnline' along with other fields
        const pharmacies = await Pharmacy.find(query)
            .select('name profileImage city state country address location rating totalReviews isHomeDeliveryAvailable is24x7 documents.pharmacyImages isOnline')
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
        
        // 🚨 CRITICAL CHECK: Block access if pharmacy is inactive by Admin
        if (!pharmacy || pharmacy.isActive === false) {
            return res.status(404).json({ success: false, message: "Pharmacy profile is inactive or not found." });
        }

        const reviews = await Review.find({ 
            targetId: id, 
            targetType: 'Pharmacy' 
        }).select('rating').lean();

        let averageRating = 4.8; 
        if (reviews.length > 0) {
            const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
            averageRating = Number((totalRating / reviews.length).toFixed(1)); 
        }

        const recentReviews = await Review.find({ targetId: id, targetType: 'Pharmacy' })
            .select('userName rating comment createdAt')
            .sort({ createdAt: -1 })
            .limit(3)
            .lean();

        res.json({ 
            success: true, 
            data: {
                ...pharmacy,
                rating: averageRating,           
                totalReviews: reviews.length,    
                gallery: pharmacy.documents?.pharmacyImages || [],
                recentReviews,
                isOnline: pharmacy.isOnline ?? true // Sends online status to UI
            } 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};


const getTrendingMedicinesNearUser = async (req, res) => {
    try {
        const lat = req.body.lat || req.query.lat || DEFAULT_LAT;
        const lng = req.body.lng || req.query.lng || DEFAULT_LNG;

        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Pharmacy', isActive: true });
        const maxRadius = limitConfig ? limitConfig.kmLimit : 50;

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
                    bestPrice: { $min: "$vendor_price" }, 
                    availableAt: { $first: "$pharmacyId" } 
                }
            },
            { $limit: 20 }, 
            {
                $lookup: {
                    from: "medicines", 
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
                    salt: "$details.salt_composition",
                    isAvailable: { $literal: true } // 👈 Since matched strictly from active inventory stock [1]
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
// endpoint: GET /user/pharmacy/standard-list
const getStandardMedicineCatalog = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;
        
        const { category, subCategory } = req.query;

        let filter = {};
        if (category) {
            const breadcrumbRegex = subCategory 
                ? new RegExp(`^${category}\\s*>\\s*${subCategory}`, 'i')
                : new RegExp(`^${category}\\s*>`, 'i');
            filter.bread_crumb = breadcrumbRegex;
        }

        const pipeline = [];

        if (category) {
            pipeline.push({ $match: filter });
        }

        pipeline.push(
            {
                // Step 1: Standard sellers lookup (For count matching)
                $lookup: {
                    from: "medicineinventories",
                    localField: "_id",
                    foreignField: "medicineId",
                    as: "sellers"
                }
            },
            {
                // 🚨 Step 2: Specialized lookup to fetch the single cheapest in-stock batch [cite: 1.1.2]
                $lookup: {
                    from: "medicineinventories",
                    let: { medId: "$_id" },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$medicineId", "$$medId"] },
                                        { $eq: ["$is_available", true] },
                                        { $gt: ["$stock_quantity", 0] }
                                    ]
                                }
                            }
                        },
                        { $sort: { vendor_price: 1 } }, // Cheapest vendor first [cite: 1.1.2]
                        { $limit: 1 }
                    ],
                    as: "cheapestSeller"
                }
            },
            {
                $addFields: {
                    cheapestActiveSeller: { $arrayElemAt: ["$cheapestSeller", 0] }
                }
            },
            {
                $addFields: {
                    vendorCount: { $size: "$sellers" },
                    // Extract lowest active price dynamically [cite: 1.1.2]
                    lowestVendorPrice: "$cheapestActiveSeller.vendor_price",
                    // Extract matching batch MRP [cite: 1.1.2]
                    cheapestMedsMrp: "$cheapestActiveSeller.mrp",
                    isAvailable: { $gt: [{ $size: "$cheapestSeller" }, 0] }
                }
            },
            {
                $addFields: {
                    // 🚨 OVERWRITE best_price with lowest active vendor price [cite: 1.1.2]
                    best_price: {
                        $cond: {
                            if: "$isAvailable",
                            then: { $toString: "$lowestVendorPrice" }, 
                            else: "$best_price" 
                        }
                    },
                    // 🚨 OVERWRITE mrp with dynamic batch-specific mrp [cite: 1.1.2]
                    mrp: {
                        $cond: {
                            if: "$isAvailable",
                            then: { $toString: "$cheapestMedsMrp" },
                            else: "$mrp"
                        }
                    }
                }
            },
            {
                $addFields: {
                    // 🚨 OVERWRITE discont_percent dynamically using the live batch-mrp [cite: 1.1.2]
                    discont_percent: {
                        $cond: {
                            if: {
                                $and: [
                                    "$isAvailable",
                                    { $gt: [{ $toDouble: { $ifNull: ["$mrp", "0"] } }, 0] }
                                ]
                            },
                            then: {
                                $concat: [
                                    {
                                        $toString: {
                                            $round: [
                                                {
                                                    $multiply: [
                                                        {
                                                            $divide: [
                                                                { $subtract: [{ $toDouble: "$mrp" }, { $toDouble: "$best_price" }] },
                                                                { $toDouble: "$mrp" }
                                                            ]
                                                        },
                                                        100
                                                    ]
                                                },
                                                0
                                            ]
                                        }
                                    },
                                    "%"
                                ]
                            },
                            else: "$discont_percent" 
                        }
                    }
                }
            },
            { 
                $project: {
                    sellers: 0,
                    cheapestSeller: 0,
                    cheapestActiveSeller: 0,
                    lowestVendorPrice: 0,
                    cheapestMedsMrp: 0
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

        const [aggregate, total] = await Promise.all([
            Medicine.aggregate(pipeline),
            Medicine.countDocuments(filter)
        ]);

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
// endpoint: GET /user/pharmacy/medicine-details/:medicineId?lat=28.6&lng=77.2
const getMedicineVendors = async (req, res) => {
    try {
        const { medicineId } = req.params;
        const today = new Date();
        
        const filterLat = req?.body?.lat || req?.query?.lat || DEFAULT_LAT;
        const filterLng = req?.body?.lng || req?.query?.lng || DEFAULT_LNG;

        const medObjectId = new mongoose.Types.ObjectId(medicineId);
        const masterMedicine = await Medicine.findById(medObjectId).lean();
        if (!masterMedicine) return res.status(404).json({ success: false, message: "Medicine not found" });

        // 🚨 COD STATUS CHECK: Policy helper se check karein ki Pharmacy me COD enabled hai ya nahi
        const isPharmacyCodAvailable = await isCodEnabled('Pharmacy');

        // DYNAMIC ALTERNATE BRANDS ENRICHMENT
        if (masterMedicine.salt_composition) {
            const similarMeds = await Medicine.find({
                salt_composition: masterMedicine.salt_composition,
                _id: { $ne: medObjectId }
            }).select('name manufacturers mrp best_price discont_percent').limit(6).lean();

            if (similarMeds.length > 0) {
                const formattedAlts = similarMeds.map(med => {
                    const price = med.best_price || med.mrp || "0";
                    const discount = med.discont_percent && med.discont_percent !== "0%" 
                        ? `save ${med.discont_percent}` 
                        : "same price";
                    return `${med.name} :: ${med.manufacturers || 'N/A'} :: ${price}/Tablet :: ${discount}`;
                }).join(' | ');

                masterMedicine.alternate_brand = formattedAlts;
            }
        }

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
        const pharmacyMap = new Map();
        let minPriceFound = null;

        for (let item of inventoryRecords) {
            if (!item.pharmacyId) continue;

            const pharmacy = item.pharmacyId;
            const pharmacyIdStr = pharmacy._id.toString();
            let distance = null;

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

                if (pharmacyMap.has(pharmacyIdStr)) {
                    const existingIndex = pharmacyMap.get(pharmacyIdStr);
                    const existingItem = availableInPharmacies[existingIndex];
                    
                    if (item.vendor_price < existingItem.price) {
                        existingItem.price = item.vendor_price;
                        existingItem.mrp = item.mrp || existingItem.mrp;
                        existingItem.inventoryId = item._id;
                        existingItem.stock = item.stock_quantity;
                        existingItem.discount = existingItem.mrp > item.vendor_price ? 
                            Math.round(((existingItem.mrp - item.vendor_price) / existingItem.mrp) * 100) : 0;
                        
                        // Dates updates
                        existingItem.manufacturingDate = (item.manufacturing_date || item.mfg_date)
                            ? moment(item.manufacturing_date || item.mfg_date).format('MM/YYYY') 
                            : "N/A";
                        existingItem.expiryDate = item.expiry_date 
                            ? moment(item.expiry_date).format('MM/YYYY') 
                            : "N/A";
                    }
                } else {
                    pharmacyMap.set(pharmacyIdStr, availableInPharmacies.length);

                    const activePromo = await PharmacyComboOffer.findOne({
                        pharmacyId: pharmacy._id,
                        medicineId: medObjectId,
                        isActive: true,
                        startDate: { $lte: today },
                        expiryDate: { $gte: today }
                    }).lean();

                    const batchMrp = item.mrp || Number(masterMedicine.mrp || 0);

                    availableInPharmacies.push({
                        pharmacyId: pharmacy._id,
                        name: pharmacy.name,
                        image: pharmacy.profileImage,
                        rating: pharmacy.rating,
                        totalReviews: pharmacy.totalReviews,
                        address: `${pharmacy.city}, ${pharmacy.state}`,
                        distance: distance.toFixed(1),
                        price: item.vendor_price,
                        mrp: batchMrp,
                        discount: batchMrp > item.vendor_price ? 
                            Math.round(((batchMrp - item.vendor_price) / batchMrp) * 100) : 0,
                        stock: item.stock_quantity,
                        isHomeDelivery: pharmacy.isHomeDeliveryAvailable,
                        isOpen: pharmacy.is24x7 ? "Open 24/7" : "Open Now",
                        inventoryId: item._id,
                        
                        // Manufacturing & Expiry Dates
                        manufacturingDate: (item.manufacturing_date || item.mfg_date)
                            ? moment(item.manufacturing_date || item.mfg_date).format('MM/YYYY') 
                            : "N/A",
                        expiryDate: item.expiry_date 
                            ? moment(item.expiry_date).format('MM/YYYY') 
                            : "N/A",

                        comboOffer: activePromo ? {
                            offerId: activePromo._id,
                            campaignDisplayName: activePromo.campaignDisplayName,
                            buyQty: activePromo.buyQty,
                            getFreeQty: activePromo.getFreeQty,
                            images: activePromo.images || []
                        } : null
                    });
                }
            }
        }

        if (minPriceFound !== null) {
            masterMedicine.best_price = minPriceFound.toString();
            const mrpNum = Number(masterMedicine.mrp || 0);
            if (mrpNum > 0) {
                masterMedicine.discont_percent = `${Math.round(((mrpNum - minPriceFound) / mrpNum) * 100)}%`;
            }
        }

        availableInPharmacies.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));

        res.json({
            success: true,
            maxRadius: `${maxRadius} km`,
            locationApplied: (req?.body?.lat || req?.query?.lat) ? "User GPS" : "Delhi (Default)",
            count: availableInPharmacies.length,
            isCodAvailable: isPharmacyCodAvailable, // 👈 Root Level par COD Status added
            data: { 
                medicineDetails: { 
                    ...masterMedicine, 
                    minPrice: minPriceFound,
                    totalSellers: availableInPharmacies.length,
                    isCodAvailable: isPharmacyCodAvailable // 👈 Medicine details ke andar bhi safety ke liye added
                }, 
                availableInPharmacies: availableInPharmacies 
            }
        });

    } catch (error) { 
        console.error("Crash Error:", error.message);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- NEW API: Search Medicine by Clicked Alternate Brand ---
const searchAlternateBrand = async (req, res) => {
    try {
        const { name } = req.query;

        if (!name) {
            return res.status(400).json({ 
                success: false, 
                message: "Medicine name query parameter is required." 
            });
        }

        const searchName = name.trim();

        // Database me exact aur case-insensitive match dhoondein
        const medicine = await Medicine.findOne({
            name: { $regex: new RegExp(`^${searchName}$`, 'i') }
        }).lean();

        if (!medicine) {
            // Fallback suggestions agar exact name nahi milta
            const suggestions = await Medicine.find({
                name: { $regex: searchName, $options: 'i' }
            }).limit(5).lean();

            return res.status(404).json({
                success: false,
                message: "Exact medicine details not found.",
                suggestions
            });
        }

        // Live Inventory lookup sabse kam price aur valid stock fetch karne ke liye
        const bestOffer = await MedicineInventory.findOne({ 
            medicineId: medicine._id, 
            is_available: true, 
            stock_quantity: { $gt: 0 } 
        }).sort({ vendor_price: 1 });

        const lowestPrice = bestOffer ? bestOffer.vendor_price : null;
        const batchMrp = bestOffer ? Number(bestOffer.mrp || 0) : Number(medicine.mrp || 0);

        // Agar live pricing milti hai toh master data ko update karein
        if (lowestPrice !== null) {
            medicine.mrp = batchMrp.toString();
            medicine.best_price = lowestPrice.toString();
            medicine.discont_percent = `${Math.round(((batchMrp - lowestPrice) / batchMrp) * 100)}%`;
        }

        return res.json({
            success: true,
            data: {
                details: medicine,
                isAvailable: lowestPrice !== null
            }
        });

    } catch (error) {
        console.error("searchAlternateBrand Error:", error.message);
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
// POST /user/pharmacy/checkout
// --- CHECKOUT MEDICINE ORDER (Updated with COD Check) ---
const checkoutMedicineOrder = async (req, res) => {
    try {
        const { couponCode, isRapid, collectionType, appointmentTime, address } = req.body;
        const userId = req.user.id;

        const cart = await Cart.findOne({ userId }).populate('pharmacyCart.items.medicineId');
        if (!cart || !cart.pharmacyCart.items.length) {
            return res.status(400).json({ success: false, message: "Basket is empty. Please add medicines." });
        }

        const pharmacyId = cart.pharmacyCart.pharmacyId;
        const isCodAllowed = await isCodEnabled('Pharmacy');

        // B. Cumulative Stock Validation across all batches [cite: 1.1.2]
        const validatedItems = [];
        for (const item of cart.pharmacyCart.items) {
            const activeInventories = await MedicineInventory.find({ 
                pharmacyId, 
                medicineId: item.medicineId._id,
                is_available: true 
            });

            // Calculate total in-stock units across all batches of this medicine
            const totalAvailableStock = activeInventories.reduce((sum, inv) => sum + (inv.stock_quantity || 0), 0);

            if (totalAvailableStock < item.quantity) {
                return res.status(400).json({ 
                    success: false, 
                    errorType: "OUT_OF_STOCK",
                    message: `Item '${item.name}' has insufficient stock. Total available: ${totalAvailableStock} units.` 
                });
            }
            validatedItems.push(item);
        }

        const rxMandatory = validatedItems.some(item => 
            item.medicineId?.prescription_required?.toUpperCase() === "YES"
        );

        if (collectionType === 'Home Delivery' && (!address || !address.houseNo)) {
            return res.status(400).json({ success: false, message: "Please provide a valid delivery address." });
        }

        const bill = await calculatePharmacyBillHelper(
            pharmacyId, validatedItems, 1, collectionType, couponCode, isRapid, appointmentTime, req.user.id
        );

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
                    needsPrescription: rxMandatory,
                    isCodAvailable: isCodAllowed
                }
            }
        });

    } catch (error) {
        console.error("CHECKOUT_ERROR:", error);
        res.status(500).json({ success: false, message: "Internal server error during checkout." });
    }
};

// ==========================================
// 1. PLACE ORDER (With COD and Prescription Checks)
// ==========================================
const placeOrder = async (req, res) => {
    try {
        const { 
            appointmentDate, appointmentTime, address, 
            paymentMethod, couponCode, isRapid, collectionType,
            selectedPatientIds 
        } = req.body;

        const userId = req.user.id;
        const activePaymentMethod = paymentMethod || 'COD';

        if (activePaymentMethod === 'COD') {
            const isCodAllowed = await isCodEnabled('Pharmacy');
            if (!isCodAllowed) {
                return res.status(400).json({
                    success: false,
                    message: "Cash on Delivery is currently disabled for medicine orders. Please pay online to complete your checkout."
                });
            }
        }
        
        const cart = await Cart.findOne({ userId })
            .populate('pharmacyCart.items.medicineId')
            .populate('pharmacyCart.items.comboOfferId'); 

        if (!cart || !cart.pharmacyCart.items.length) {
            return res.status(400).json({ success: false, message: "Transaction expired. Cart is empty." });
        }

        const pharmacyId = cart.pharmacyCart.pharmacyId;

        const targetPharmacy = await Pharmacy.findById(pharmacyId);
        if (!targetPharmacy || targetPharmacy.isOnline === false) {
            return res.status(400).json({
                success: false,
                message: "Booking Blocked: Pharmacy is currently offline and not accepting orders."
            });
        }

        const rxMandatory = cart.pharmacyCart.items.some(item => 
            item.medicineId?.prescription_required?.toUpperCase() === "YES"
        );

        let rxImages = [];
        if (req.files && req.files['prescriptionImages']) {
            rxImages = req.files['prescriptionImages'].map(f => f.path);
        }

        if (rxMandatory && rxImages.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: "At least one medicine in your cart requires a prescription. Please upload a valid prescription to place this order." 
            });
        }

        const isPrescriptionOrder = rxMandatory || rxImages.length > 0;

        const bill = await calculatePharmacyBillHelper(
            pharmacyId, cart.pharmacyCart.items, 1, collectionType, couponCode, isRapid, appointmentTime, req.user.id
        );

        // --- DYNAMIC GST INVOICING ITEM MAPPER [1] ---
        const mappedOrderItems = [];
for (const item of cart.pharmacyCart.items) {
    const orderedQty = Number(item.quantity || 1);

    const activeBatch = await MedicineInventory.findOne({
        pharmacyId,
        medicineId: item.medicineId._id,
        is_available: true,
        stock_quantity: { $gt: 0 }
    }).sort({ expiry_date: 1 });

    const batchMrp = activeBatch ? activeBatch.mrp : (item.medicineId ? Number(item.medicineId.mrp || 0) : 0);
    const batchHsn = activeBatch ? activeBatch.hsn_number : null;

    // Dynamic GST Check
    let cgstPercent = 0;
    let sgstPercent = 0;
    if (batchHsn && batchHsn.trim() !== "" && batchHsn.toUpperCase() !== "N/A") {
        const isSupplement = batchHsn.trim().startsWith('21');
        cgstPercent = isSupplement ? 9 : 6;
        sgstPercent = isSupplement ? 9 : 6;
    }

    const totalGstPercent = cgstPercent + sgstPercent;
    const finalPrice = Number(item.price || 0) * orderedQty;
    const itemTaxableAmount = finalPrice / (1 + (totalGstPercent / 100));
    const itemCgstAmount = itemTaxableAmount * (cgstPercent / 100);
    const itemSgstAmount = itemTaxableAmount * (sgstPercent / 100);

    let isComboApplied = false;
    let comboOfferId = null;
    let freeQuantity = 0;

    if (item.isComboApplied === true && item.comboOfferId) {
        isComboApplied = true;
        comboOfferId = item.comboOfferId._id;

        const X = item.comboOfferId.buyQty || 2;
        const Y = item.comboOfferId.getFreeQty || 1;
        const bundleSize = X + Y;

        const fullBundles = Math.floor(orderedQty / bundleSize);
        freeQuantity = fullBundles * Y;
    }

    mappedOrderItems.push({
        medicineId: item.medicineId._id,
        name: item.name,
        mrp: batchMrp, 
        price: item.price,
        quantity: orderedQty,
        duration: item.duration,
        startDate: item.startDate,
        isComboApplied,
        comboOfferId,
        freeQuantity,
        
        hsn_number: batchHsn || "", // Empty string fallback
        taxableAmount: Number(itemTaxableAmount.toFixed(2)),
        cgstPercent,
        sgstPercent,
        cgstAmount: Number(itemCgstAmount.toFixed(2)),
        sgstAmount: Number(itemSgstAmount.toFixed(2))
    });
}

        const tempOrderId = `MED-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        let rzpOrder = null;

        if (activePaymentMethod !== 'COD') {
            rzpOrder = await createRazorpayOrder(bill.totalAmount, `receipt_${tempOrderId}`);
        } else {
            for (const item of cart.pharmacyCart.items) {
                const isDeducted = await deductPharmacyStockFEFO(pharmacyId, item.medicineId._id, item.quantity);
                if (!isDeducted) {
                    return res.status(400).json({ success: false, message: `Stock mismatch for ${item.name}. Please refresh cart.` });
                }
            }
        }

        const booking = await PharmacyBooking.create({
            orderId: tempOrderId,               
            userId,
            pharmacyId,                         
            patients: await mapPatients(userId, selectedPatientIds || ['Self']),
            items: mappedOrderItems, 
            collectionType,
            address: typeof address === 'string' ? JSON.parse(address) : address,
            appointmentDate,
            appointmentTime,
            billSummary: bill,
            paymentMethod: activePaymentMethod,
            orderType: isPrescriptionOrder ? 'Prescription' : 'General',
            prescriptionImages: rxImages,
            status: activePaymentMethod === 'COD' 
                ? (isPrescriptionOrder ? 'Under Review' : 'Placed') 
                : 'Pending',
            paymentStatus: 'Pending',
            deliveryOTP: Math.floor(1000 + Math.random() * 9000).toString()
        });

        if (activePaymentMethod === 'COD') {
            await Cart.findOneAndUpdate({ userId }, { $set: { "pharmacyCart.items": [], "pharmacyCart.pharmacyId": null } });

            if (collectionType === 'Home Delivery' || collectionType === 'Home Collection') {
                await deductBenefitCount(req.user.id, 'freePharmacyDeliveriesCount');
            }

            await notifyAdminsAndVendor(
                pharmacyId,
                'pharmacy',
                "New Pharmacy Order Placed (COD)!",
                `A COD medicine order #${tempOrderId} has been successfully placed.`,
                { bookingId: booking._id.toString(), type: 'new_pharmacy_booking' }
            );

            return res.status(201).json({ success: true, data: booking });
        }

        res.status(201).json({
            success: true,
            message: "Razorpay order created for pharmacy checkout.",
            key_id: process.env.RAZORPAY_KEY_ID,
            amount: rzpOrder.amount, 
            razorpayOrderId: rzpOrder.id,
            appointmentId: booking._id 
        });

    } catch (error) {
        console.error("placeOrder Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// ==========================================
// 2. VERIFY PHARMACY PAYMENT & REDUCE STOCK
// ==========================================
const verifyPharmacyPayment = async (req, res) => {
    try {
        const { appointmentId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
        const today = new Date();

        if (!appointmentId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return res.status(400).json({ success: false, message: "Missing payment tokens." });
        }

        const isVerified = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        if (!isVerified) {
            return res.status(400).json({ success: false, message: "Signature verification failed." });
        }

        const order = await PharmacyBooking.findById(appointmentId);
        if (!order) return res.status(404).json({ success: false, message: "Order not found." });

        const rzpDetails = await fetchAndMapRazorpayPayment(razorpayPaymentId, razorpaySignature);

        for (const item of order.items) {
            const activePromo = await PharmacyComboOffer.findOne({
                pharmacyId: order.pharmacyId,
                medicineId: item.medicineId,
                isActive: true,
                startDate: { $lte: today },
                expiryDate: { $gte: today }
            });

            if (activePromo) {
                const X = activePromo.buyQty;
                const Y = activePromo.getFreeQty;
                const bundleSize = X + Y;

                const fullBundles = Math.floor(item.quantity / bundleSize);
                const freeQty = fullBundles * Y;
                
                if (freeQty > 0) {
                    item.isComboApplied = true;
                    item.comboOfferId = activePromo._id;
                    item.freeQuantity = freeQty;
                }
            }

            // Stock Deduction across batches based on FEFO [cite: 1.1.2]
            await deductPharmacyStockFEFO(order.pharmacyId, item.medicineId, item.quantity);
        }

        order.status = order.orderType === 'Prescription' ? 'Under Review' : 'Placed';
        order.paymentStatus = 'Paid';
        order.paymentMethod = 'Online';
        order.paymentDetails = rzpDetails; 
        await order.save();

        await Cart.findOneAndUpdate({ userId: req.user.id }, { $set: { "pharmacyCart.items": [], "pharmacyCart.pharmacyId": null } });

        // Only deduct subscription deliveries count if delivery charge was waived to 0
        if ((order.collectionType === 'Home Delivery' || order.collectionType === 'Home Collection') && order.billSummary?.deliveryCharge === 0) {
            const { deductBenefitCount } = require('../../../utils/subscriptionBenefitHelper');
            await deductBenefitCount(order.userId, 'freePharmacyDeliveriesCount');
        }

        await notifyAdminsAndVendor(
            order.pharmacyId,
            'pharmacy',
            "New Pharmacy Order Confirmed!",
            `Paid Pharmacy order #${order.orderId} has been successfully verified.`,
            { bookingId: order._id.toString(), type: 'new_pharmacy_booking' }
        );

        res.json({
            success: true,
            message: "Pharmacy payment successfully verified & order placed!",
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
            status: 'Under Review' 
        });

        // 🚨 Trigger Notification for Pharmacy Prescription inquiries
        await notifyAdminsAndVendor(
            pharmacyId,
            'pharmacy',
            "New Prescription Inquiry Placed!",
            `Prescription inquiry #${order.orderId} is pending manual review.`,
            { bookingId: order._id.toString(), type: 'pharmacy_prescription_review' }
        );

        res.json({ success: true, message: "Pharmacist will verify your prescription", orderId: order.orderId });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const cancelMedicineOrder = async (req, res) => {
    try {
        const { orderId, reason } = req.body; 
        const userId = req.user.id;

        const order = await PharmacyBooking.findOne({ 
            $or: [{ _id: mongoose.isValidObjectId(orderId) ? orderId : new mongoose.Types.ObjectId() }, { orderId }],
            userId 
        });

        if (!order) return res.status(404).json({ success: false, message: "Order not found." });

        const terminalStates = ['OutForDelivery', 'ReachedLocation', 'Delivered', 'Cancelled', 'No-Show'];
        if (terminalStates.includes(order.status) || terminalStates.includes(order.deliveryStatus)) {
            return res.status(400).json({ success: false, message: "Cannot cancel order in its current state." });
        }

        // DYNAMIC POLICY EVALUATION
        const policyResult = await processCancellationRefund(order, 'Pharmacy');

        // STOCK RESTORATION: Return canceled items back to Pharmacy Inventory [cite: 1.1.2]
        for (const item of order.items) {
            if (!item.medicineId) continue;

            let inventory = await MedicineInventory.findOne({ 
                pharmacyId: order.pharmacyId, 
                medicineId: item.medicineId,
                is_available: true
            });

            if (!inventory) {
                inventory = await MedicineInventory.findOne({ 
                    pharmacyId: order.pharmacyId, 
                    medicineId: item.medicineId
                });
            }

            if (inventory) {
                inventory.stock_quantity += item.quantity; // Put stocks back [cite: 1.1.2]
                inventory.is_available = true; // Ensure marked active [cite: 1.1.2]
                await inventory.save();
            }
        }

        order.status = 'Cancelled';
        order.deliveryStatus = 'CancelledByDriver';
        order.cancelReason = reason || "Cancelled by User";
        
        order.billSummary.cancellationFeeApplied = policyResult.cancellationFee;
        order.paymentStatus = policyResult.cancellationFee > 0 ? 'Refund-Initiated' : 'Refunded';

        await order.save();

        if (order.billSummary?.deliveryCharge === 0 && (order.collectionType === 'Home Delivery' || order.collectionType === 'Home Collection')) {
            await refundBenefitCount(order.userId, 'freePharmacyDeliveriesCount');
        }

        res.json({ 
            success: true, 
            message: policyResult.cancellationFee > 0
                ? `Order cancelled. A cancellation fee of ₹${policyResult.cancellationFee} was applied and stock restored.`
                : "Order cancelled successfully and stock restored.",
            data: {
                cancellationFee: policyResult.cancellationFee,
                refundAmount: policyResult.refundAmount,
                order
            }
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
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
            // 3. Medicine ID ke base par group karein taaki duplicate medicines repeat na ho
            {
                $group: {
                    _id: "$medicineId",
                    latestInventoryId: { $first: "$_id" },
                    // 🚨 OVERWRITE: Fetch the absolute lowest vendor price across active pharmacies [cite: 1.1.2]
                    latestVendorPrice: { $min: "$vendor_price" }, 
                    // 🚨 OVERWRITE: Extract the dynamic batch MRP safely [cite: 1.1.2]
                    latestMedsMrp: { $first: "$mrp" }, 
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
                    mrp: { $toString: "$latestMedsMrp" }, // 👈 Overwritten: Dynamic Batch MRP [cite: 1.1.2]
                    bestPrice: "$latestVendorPrice",      // 👈 Overwritten: Live minimum vendor price [cite: 1.1.2]
                    // 🚨 DYNAMIC DISCOUNT: Calculated strictly using the lowest live price [cite: 1.1.2]
                    discount: {
                        $cond: {
                            if: { 
                                $and: [
                                    { $ne: ["$latestMedsMrp", null] },
                                    { $gt: [{ $toDouble: { $ifNull: ["$latestMedsMrp", "0"] } }, 0] }
                                ]
                            },
                            then: {
                                $round: [
                                    {
                                        $multiply: [
                                            {
                                                $divide: [
                                                    { $subtract: [{ $toDouble: { $ifNull: ["$latestMedsMrp", "0"] } }, "$latestVendorPrice"] },
                                                    { $toDouble: { $ifNull: ["$latestMedsMrp", "1"] } }
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
                    addedAt: "$latestCreatedAt",
                    isAvailable: { $literal: true }
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

        const filter = {
            prescription_required: { $regex: /^(no|false)$/i }
        };

        if (category) {
            const breadcrumbRegex = subCategory 
                ? new RegExp(`^${category}\\s*>\\s*${subCategory}`, 'i')
                : new RegExp(`^${category}\\s*>`, 'i');
            filter.bread_crumb = breadcrumbRegex;
        }

        const pipeline = [
            { $match: filter },
            {
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
                    numInventoryMRP: { $toDouble: { $arrayElemAt: ["$inventory.mrp", 0] } }, // 👈 Added: Fetch batch MRP [cite: 1.1.2]
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
                    minimumMRP: { // 👈 Added: Dynamic MRP based on batch [cite: 1.1.2]
                        $cond: [
                            "$isInventoryAvailable",
                            "$numInventoryMRP",
                            "$numMRP"
                        ]
                    },
                    isAvailable: "$isInventoryAvailable"
                }
            },
            {
                $addFields: {
                    discountPercentage: {
                        $cond: {
                            if: { $gt: ["$minimumMRP", 0] },
                            then: {
                                $round: [
                                    {
                                        $multiply: [
                                            { $divide: [{ $subtract: ["$minimumMRP", "$minimumPrice"] }, "$minimumMRP"] },
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
                // 🚨 OVERWRITE best_price, mrp, and discont_percent with live values [cite: 1.1.2]
                $addFields: {
                    mrp: { $toString: "$minimumMRP" }, // Overwrite MRP with batch MRP! [cite: 1.1.2]
                    best_price: {
                        $cond: {
                            if: "$isInventoryAvailable",
                            then: { $toString: "$minimumPrice" },
                            else: "$best_price"
                        }
                    },
                    discont_percent: {
                        $cond: {
                            if: { $gt: ["$discountPercentage", 0] },
                            then: { $concat: [{ $toString: "$discountPercentage" }, "%"] },
                            else: "$discont_percent"
                        }
                    }
                }
            },
            { 
                $project: { 
                    inventory: 0, 
                    numMRP: 0, 
                    numDocBestPrice: 0, 
                    numInventoryPrice: 0, 
                    numInventoryMRP: 0,
                    isInventoryAvailable: 0,
                    minimumPrice: 0,
                    minimumMRP: 0,
                    discountPercentage: 0
                } 
            },
            { $skip: skip },
            { $limit: limit }
        ];

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
        const limitVal = parseInt(req.query.limit) || 20; // 👈 Dynamic limit from Flutter query params [1]
        const skip = (page - 1) * limitVal;

        const pipeline = [
            {
                // Match only those medicines that have valid MRP values
                $match: {
                    mrp: { $exists: true, $ne: null, $ne: "" }
                }
            },
            {
                // Fetch dynamic lowest vendor price from inventory [cite: 1.1.2]
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
                    numInventoryPrice: { $toDouble: { $arrayElemAt: ["$inventory.vendor_price", 0] } },
                    numInventoryMRP: { $toDouble: { $arrayElemAt: ["$inventory.mrp", 0] } }, // 👈 Dynamic batch MRP extracted [cite: 1.1.2]
                    isInventoryAvailable: { $gt: [{ $size: "$inventory" }, 0] }
                }
            },
            {
                $addFields: {
                    // Mapped helper: 1 if vendor has priced stock, 0 if not listed [cite: 1.1.2]
                    hasVendorPrice: {
                        $cond: ["$isInventoryAvailable", 1, 0]
                    },
                    minimumPrice: {
                        $cond: [
                            "$isInventoryAvailable",
                            "$numInventoryPrice",
                            null
                        ]
                    },
                    minimumMRP: {
                        $cond: [
                            "$isInventoryAvailable",
                            "$numInventoryMRP",
                            null // 👈 Strictly hides master MRP if unstocked by vendors [cite: 1.1.2]
                        ]
                    },
                    isAvailable: "$isInventoryAvailable"
                }
            },
            {
                $addFields: {
                    // Dynamic discount percentage based strictly on live batch MRP and vendor price [cite: 1.1.2]
                    discountPercentage: {
                        $cond: {
                            if: {
                                $and: [
                                    "$isInventoryAvailable",
                                    { $gt: ["$minimumMRP", 0] }
                                ]
                            },
                            then: {
                                $round: [
                                    {
                                        $multiply: [
                                            { $divide: [{ $subtract: ["$minimumMRP", "$minimumPrice"] }, "$minimumMRP"] },
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
                // 🚨 OVERWRITE best_price, mrp, and discont_percent with live values [cite: 1.1.2]
                $addFields: {
                    best_price: {
                        $cond: {
                            if: "$isAvailable",
                            then: { $toString: "$minimumPrice" },
                            else: null 
                        }
                    },
                    mrp: {
                        $cond: {
                            if: "$isAvailable",
                            then: { $toString: "$minimumMRP" },
                            else: null 
                        }
                    },
                    discont_percent: {
                        $cond: {
                            if: {
                                $and: [
                                    "$isAvailable",
                                    { $gt: ["$discountPercentage", 0] }
                                ]
                            },
                            then: { $concat: [{ $toString: "$discountPercentage" }, "%"] },
                            else: "0%" 
                        }
                    }
                }
            },
            {
                // 🚨 SORT LOGIC: Deploys hasVendorPrice DESC, then discountPercentage DESC, then alphabetical [cite: 1.1.2]
                // This forces unstocked items (no vendor price) to the very bottom of the page [cite: 1.1.2]
                $sort: {
                    hasVendorPrice: -1,
                    discountPercentage: -1,
                    name: 1
                }
            },
            { 
                // Keep clean project payload returning all original keys
                $project: { 
                    inventory: 0, 
                    numMRP: 0, 
                    numInventoryPrice: 0, 
                    numInventoryMRP: 0,
                    isInventoryAvailable: 0,
                    hasVendorPrice: 0 
                } 
            },
            {
                // Dynamic Facet stage: Calculates total count & paginated records in parallel
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [{ $skip: skip }, { $limit: limitVal }]
                }
            }
        ];

        const result = await Medicine.aggregate(pipeline);
        
        const total = result[0].metadata[0]?.total || 0;
        const data = result[0].data || [];

        res.json({
            success: true,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limitVal),
            data: data
        });
    } catch (error) {
        console.error("getHighestDiscountMedicines Error:", error);
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

        // Fetch requests and populate deep pharmacy profile metrics safely
        const requests = await PharmacyPrescriptionRequest.find({ userId })
            .populate(
                'pharmacyId', 
                'name phone address profileImage city state country rating totalReviews isHomeDeliveryAvailable is24x7 location'
            )
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await PharmacyPrescriptionRequest.countDocuments({ userId });

        // Formatting response to normalize paths & apply secure validation fallbacks
        const formattedRequests = requests.map(reqDoc => {
            const requestObj = reqDoc.toObject();
            
            // Normalize path slashes for image loading safety
            if (requestObj.prescriptionImage) {
                requestObj.prescriptionImage = requestObj.prescriptionImage.replace(/\\/g, "/");
            }

            // Safe fallback mappings for items array to prevent GET lists from crashing
            if (requestObj.verifiedBill && requestObj.verifiedBill.items) {
                requestObj.verifiedBill.items = requestObj.verifiedBill.items.map(item => ({
                    ...item,
                    medicineId: item.medicineId || null,
                    mrp: Number(item.mrp || 0),
                    pricePerUnit: Number(item.pricePerUnit || 0),
                    totalPrice: Number(item.totalPrice || 0)
                }));
            }
            
            return requestObj;
        });

        res.json({
            success: true,
            count: formattedRequests.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: formattedRequests
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

// 2. GET SINGLE REQUEST DETAILS
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

// ==========================================
// 3. PAY AND CONVERT REQUEST TO FINAL ORDER (Prescription Review Flow)
// ==========================================
const payAndConfirmOrder = async (req, res) => {
    try {
        const { requestId, paymentMethod } = req.body;
        const userId = req.user.id;
        const today = new Date();

        console.log(`\x1b[36m[DEBUG] payAndConfirmOrder: Received Request -> requestId: "${requestId}", userId: "${userId}", paymentMethod: "${paymentMethod}"\x1b[0m`);

        if (!requestId || requestId === "undefined" || requestId === "null" || requestId.trim() === "") {
            return res.status(400).json({ 
                success: false, 
                message: "Validation Error: 'requestId' parameter is missing, null, or undefined in the request body." 
            });
        }

        const cleanId = requestId.trim();
        const isObjectId = mongoose.Types.ObjectId.isValid(cleanId);
        
        const dbQuery = { userId };
        if (isObjectId) {
            dbQuery._id = cleanId;
        } else {
            dbQuery.requestId = cleanId;
        }

        const request = await PharmacyPrescriptionRequest.findOne(dbQuery);
        
        if (!request) {
            return res.status(400).json({ 
                success: false, 
                message: `Business Error: No active prescription request found matching identifier: '${requestId}' for this user account.` 
            });
        }

        if (request.status !== 'Bill Generated') {
            return res.status(400).json({ 
                success: false, 
                message: `Business Error: Request status is currently '${request.status}'. Payment can only be processed when status is 'Bill Generated'.` 
            });
        }

        const bill = request.verifiedBill;
        const tempOrderId = `MED-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        if (paymentMethod !== 'COD') {
            const rzpOrder = await createRazorpayOrder(bill.totalAmount, `receipt_${tempOrderId}`);
            
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

        // COD Stock Deduction
        if (request.verifiedBill?.items) {
            for (const billItem of request.verifiedBill.items) {
                if (!billItem.medicineId) continue;
                await deductPharmacyStockFEFO(request.pharmacyId, billItem.medicineId, billItem.quantity || 1);
            }
        }

        // --- UPDATED: Map verified items with HSN and dynamic tax calculations safely ---
        const orderItems = (request.verifiedBill.items || []).map(item => {
            const orderedQty = Number(item.quantity || 1);

            return {
                medicineId: item.medicineId || null,
                name: item.name,
                mrp: Number(item.mrp || 0),
                price: Number(item.pricePerUnit || 0),
                quantity: orderedQty,
                duration: "15 Days",
                isComboApplied: false,
                comboOfferId: null,
                freeQuantity: 0,
                
                // 🚨 Dynamic GST variables successfully transferred to order items [1]
                hsn_number: item.hsn_number || "30049011",
                taxableAmount: item.taxableAmount || 0,
                cgstPercent: item.cgstPercent || 6,
                sgstPercent: item.sgstPercent || 6,
                cgstAmount: item.cgstAmount || 0,
                sgstAmount: item.sgstAmount || 0
            };
        });

        const finalOrder = await PharmacyBooking.create({
            orderId: tempOrderId,
            userId,
            pharmacyId: request.pharmacyId,
            patients: [{ name: request.address ? request.address.name : "Patient", relation: 'Self' }],
            items: orderItems,
            collectionType: 'Home Delivery',
            address: request.address || {},
            appointmentDate: new Date(),
            appointmentTime: 'Immediate',
            billSummary: {
                itemTotal: bill.itemTotal || 0,
                taxableTotal: bill.taxableTotal || 0, // 👈 Saved GST Taxable Sum [1]
                cgstTotal: bill.cgstTotal || 0,       // 👈 Saved CGST Sum [1]
                sgstTotal: bill.sgstTotal || 0,       // 👈 Saved SGST Sum [1]
                deliveryCharge: bill.deliveryCharge || 0,
                totalAmount: bill.totalAmount || 0
            },
            paymentMethod: 'COD',
            paymentStatus: 'Pending',
            orderType: 'Prescription',
            prescriptionImages: request.prescriptionImage ? [request.prescriptionImage] : [],
            status: 'Placed'
        });

        request.status = 'Paid';
        await request.save();

        await notifyAdminsAndVendor(
            request.pharmacyId,
            'pharmacy',
            "Prescription Order Placed (COD)!",
            `Prescription order #${tempOrderId} has been confirmed (COD).`,
            { bookingId: finalOrder._id.toString(), type: 'new_pharmacy_booking' }
        );

        res.status(201).json({
            success: true,
            message: "Prescription order confirmed with COD successfully!",
            data: finalOrder
        });

    } catch (error) {
        console.error("payAndConfirmOrder Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. VERIFY PRESCRIPTION REQUEST PAYMENT SIGNATURE
// ==========================================
const verifyPrescriptionRequestPayment = async (req, res) => {
    try {
        const { appointmentId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
        const today = new Date();

        const isVerified = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
        if (!isVerified) {
            return res.status(400).json({ success: false, message: "Signature verification failed." });
        }

        const request = await PharmacyPrescriptionRequest.findById(appointmentId);
        if (!request) return res.status(404).json({ success: false, message: "Prescription request not found." });

        const rzpDetails = await fetchAndMapRazorpayPayment(razorpayPaymentId, razorpaySignature);

        if (request.verifiedBill?.items) {
            for (const billItem of request.verifiedBill.items) {
                if (!billItem.medicineId) continue;
                await deductPharmacyStockFEFO(request.pharmacyId, billItem.medicineId, billItem.quantity || 1);
            }
        }

        // --- UPDATED: Map verified items with HSN and dynamic tax calculations safely ---
        const orderItems = (request.verifiedBill.items || []).map(item => ({
            medicineId: item.medicineId || null,
            name: item.name,
            mrp: Number(item.mrp || 0),
            price: Number(item.pricePerUnit || 0),
            quantity: Number(item.quantity || 1),
            duration: "15 Days",
            isComboApplied: false,
            comboOfferId: null,
            freeQuantity: 0,
            
            // 🚨 Dynamic GST variables successfully transferred to order items [1]
            hsn_number: item.hsn_number || "30049011",
            taxableAmount: item.taxableAmount || 0,
            cgstPercent: item.cgstPercent || 6,
            sgstPercent: item.sgstPercent || 6,
            cgstAmount: item.cgstAmount || 0,
            sgstAmount: item.sgstAmount || 0
        }));

        const finalOrder = await PharmacyBooking.create({
            orderId: `MED-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
            userId: req.user.id,
            pharmacyId: request.pharmacyId,
            patients: [{ name: request.address ? request.address.name : "Patient", relation: 'Self' }],
            items: orderItems,
            collectionType: 'Home Delivery',
            address: request.address || {},
            appointmentDate: new Date(),
            appointmentTime: 'Immediate',
            billSummary: {
                itemTotal: request.verifiedBill.itemTotal || 0,
                taxableTotal: request.verifiedBill.taxableTotal || 0, // 👈 Saved GST Taxable Sum [1]
                cgstTotal: request.verifiedBill.cgstTotal || 0,       // 👈 Saved CGST Sum [1]
                sgstTotal: request.verifiedBill.sgstTotal || 0,       // 👈 Saved SGST Sum [1]
                deliveryCharge: request.verifiedBill.deliveryCharge || 0,
                totalAmount: request.verifiedBill.totalAmount || 0
            },
            paymentMethod: 'Online',
            paymentStatus: 'Paid',
            orderType: 'Prescription',
            prescriptionImages: request.prescriptionImage ? [request.prescriptionImage] : [],
            status: 'Placed',
            paymentDetails: rzpDetails 
        });

        request.status = 'Paid';
        await request.save();

        // Trigger Notification
        await notifyAdminsAndVendor(
            request.pharmacyId,
            'pharmacy',
            "Prescription Order Placed!",
            `A paid prescription order #${finalOrder.orderId} has been confirmed.`,
            { bookingId: finalOrder._id.toString(), type: 'new_pharmacy_booking' }
        );

        res.status(201).json({
            success: true,
            message: "Prescription payment verified and order placed successfully!",
            data: finalOrder
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};



const getActiveStoreComboOffers = async (req, res) => {
    try {
        const { pharmacyId } = req.query;
        const today = new Date();

        const activeCombos = await PharmacyComboOffer.find({
            pharmacyId,
            isActive: true,
            startDate: { $lte: today },
            expiryDate: { $gte: today }
        }).populate('medicineId', 'name image_url mrp best_price').lean();

        // 🚨 OVERWRITE populated master mrp with live batch-specific mrp safely [cite: 1.1.2]
        const formattedCombos = await Promise.all(activeCombos.map(async (combo) => {
            if (!combo.medicineId) return combo;

            const bestOffer = await MedicineInventory.findOne({
                pharmacyId,
                medicineId: combo.medicineId._id,
                is_available: true,
                stock_quantity: { $gt: 0 }
            }).sort({ expiry_date: 1 }).lean();

            if (bestOffer) {
                combo.medicineId.mrp = (bestOffer.mrp || combo.medicineId.mrp).toString();
                combo.medicineId.best_price = bestOffer.vendor_price.toString();
            }
            return combo;
        }));

        res.json({
            success: true,
            count: formattedCombos.length,
            data: formattedCombos
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const ratePharmacyOrder = async (req, res) => {
    try {
        const { bookingId, rating, comment } = req.body;

        const booking = await PharmacyBooking.findOne({ _id: bookingId, userId: req.user.id });
        if (!booking || booking.status !== 'Delivered') {
            return res.status(400).json({ success: false, message: "You can only rate successfully delivered medicine orders." });
        }

        const existingReview = await Review.findOne({ userId: req.user.id, orderId: bookingId });
        if (existingReview) {
            return res.status(400).json({ success: false, message: "You have already submitted a review for this medicine order." });
        }

        // Create Polymorphic Review
        await Review.create({
            userId: req.user.id,
            userName: req.user.name || "Verified User",
            targetId: booking.pharmacyId,
            targetType: 'Pharmacy',
            orderId: bookingId,
            rating,
            comment: comment || ""
        });

        // Recalculate average rating & sync to Pharmacy profile
        const stats = await Review.aggregate([
            { $match: { targetId: booking.pharmacyId, targetType: 'Pharmacy' } },
            { $group: { _id: null, averageRating: { $avg: "$rating" }, totalReviews: { $sum: 1 } } }
        ]);

        if (stats.length > 0) {
            await Pharmacy.findByIdAndUpdate(booking.pharmacyId, {
                rating: Number(stats[0].averageRating.toFixed(1)),
                totalReviews: stats[0].totalReviews
            });
        }

        res.json({ success: true, message: "Thank you for rating our pharmacy service!" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET ALL ACTIVE COMBO OFFERS FROM ALL APPROVED PHARMACIES (WITH PAGINATION OF 25)
const getGlobalActiveComboOffers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25; 
        const skip = (page - 1) * limit;
        const today = new Date();

        const pipeline = [
            {
                // Step 1: Match active campaigns within current dates
                $match: {
                    isActive: true,
                    startDate: { $lte: today },
                    expiryDate: { $gte: today }
                }
            },
            {
                // Step 2: Lookup pharmacy details
                $lookup: {
                    from: "pharmacies", 
                    localField: "pharmacyId",
                    foreignField: "_id",
                    as: "pharmacyDetails"
                }
            },
            { $unwind: "$pharmacyDetails" },
            {
                // Step 3: Strict Filter (Only show offers from approved and active pharmacies)
                $match: {
                    "pharmacyDetails.profileStatus": "Approved",
                    "pharmacyDetails.isActive": true
                }
            },
            {
                // Step 4: Lookup Medicine details
                $lookup: {
                    from: "medicines", 
                    localField: "medicineId",
                    foreignField: "_id",
                    as: "medicineDetails"
                }
            },
            { $unwind: "$medicineDetails" },
            {
                // 🚨 Step 5: DEEP MULTI-KEY LOOKUP (Matches both pharmacyId & medicineId to get live batch MRP) [cite: 1.1.2]
                $lookup: {
                    from: "medicineinventories",
                    let: { pharmId: "$pharmacyId", medId: "$medicineId" },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$pharmacyId", "$$pharmId"] },
                                        { $eq: ["$medicineId", "$$medId"] },
                                        { $eq: ["$is_available", true] },
                                        { $gt: ["$stock_quantity", 0] }
                                    ]
                                }
                            }
                        },
                        { $sort: { expiry_date: 1 } }, // FEFO Batch Sort [cite: 1.1.2]
                        { $limit: 1 }
                    ],
                    as: "matchedInventory"
                }
            },
            { $unwind: "$matchedInventory" },
            {
                // Step 6: Format response overwriting static admin prices with live batch data [cite: 1.1.2]
                $project: {
                    _id: 1,
                    campaignDisplayName: 1,
                    buyQty: 1,
                    getFreeQty: 1,
                    startDate: 1,
                    expiryDate: 1,
                    projectedPromoMargin: 1,
                    images: 1,
                    pharmacy: {
                        _id: "$pharmacyDetails._id",
                        name: "$pharmacyDetails.name",
                        profileImage: "$pharmacyDetails.profileImage",
                        city: "$pharmacyDetails.city",
                        state: "$pharmacyDetails.state",
                        rating: "$pharmacyDetails.rating",
                        totalReviews: "$pharmacyDetails.totalReviews"
                    },
                    medicine: {
                        _id: "$medicineDetails._id",
                        name: "$medicineDetails.name",
                        image: { $arrayElemAt: ["$medicineDetails.image_url", 0] },
                        mrp: { $toString: "$matchedInventory.mrp" }, // 👈 Overwritten: Dynamic batch MRP [cite: 1.1.2]
                        bestPrice: "$matchedInventory.vendor_price"  // 👈 Overwritten: Live vendor price [cite: 1.1.2]
                    }
                }
            },
            { $sort: { createdAt: -1 } },
            {
                // Step 7: Multi-stage Facet for pagination metadata
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [{ $skip: skip }, { $limit: limit }]
                }
            }
        ];

        const result = await PharmacyComboOffer.aggregate(pipeline);
        
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

// --- API: GET COMBO OFFER DETAILS (With Bundled Services & Applicable Coupons) ---
const getComboOfferDetails = async (req, res) => {
    try {
        const { offerId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(offerId)) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid Combo Offer ID format." 
            });
        }

        const offer = await PharmacyComboOffer.findById(offerId)
            .populate({
                path: 'pharmacyId',
                select: 'name profileImage city state address rating totalReviews isHomeDeliveryAvailable is24x7 location'
            })
            .populate({
                path: 'medicineId',
                select: 'name salt_composition mrp best_price image_url description packaging prescription_required safety_advise side_effect benefits'
            })
            .lean();

        if (!offer) {
            return res.status(404).json({ 
                success: false, 
                message: "Combo Offer not found, it might have been deleted or expired." 
            });
        }

        // 🚨 OVERWRITE populated master mrp with live batch-specific mrp safely [cite: 1.1.2]
        if (offer.medicineId && offer.pharmacyId) {
            const bestOffer = await MedicineInventory.findOne({
                pharmacyId: offer.pharmacyId._id,
                medicineId: offer.medicineId._id,
                is_available: true,
                stock_quantity: { $gt: 0 }
            }).sort({ expiry_date: 1 }).lean();

            if (bestOffer) {
                offer.medicineId.mrp = (bestOffer.mrp || offer.medicineId.mrp).toString();
                offer.medicineId.best_price = bestOffer.vendor_price.toString();
            }
        }

        res.json({
            success: true,
            data: offer
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getSimilarInStockMedicines = async (req, res) => {
    try {
        const { medicineId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(medicineId)) {
            return res.status(400).json({ success: false, message: "Invalid medicine ID format." });
        }

        // 1. Fetch currently opened master medicine details
        const currentMed = await Medicine.findById(medicineId).lean();
        if (!currentMed) {
            return res.status(404).json({ success: false, message: "Medicine not found." });
        }

        const salt = currentMed.salt_composition;
        // If medicine has no salt composition, return empty array immediately
        if (!salt || salt.trim() === "" || salt.toUpperCase() === "N/A") {
            return res.json({ success: true, count: 0, data: [] });
        }

        // 🚀 SMART SALT EXTRACTION: "Paracetamol (650mg)" -> "Paracetamol"
        // Taaki different dosage wale same salt aapas me match ho sakein
        const primarySalt = salt.split('(')[0].split(' ')[0].trim(); 
        const saltRegex = new RegExp(primarySalt, 'i');

        // 2. High-performance aggregate query over MedicineInventory
        const similarMeds = await MedicineInventory.aggregate([
            {
                // strictly filter only live in-stock items, excluding the currently opened medicine
                $match: {
                    is_available: true,
                    stock_quantity: { $gt: 0 },
                    medicineId: { $ne: currentMed._id } 
                }
            },
            {
                // Lookup master Medicine details
                $lookup: {
                    from: "medicines",
                    localField: "medicineId",
                    foreignField: "_id",
                    as: "medDetails"
                }
            },
            { $unwind: "$medDetails" },
            {
                // Match items carrying the same chemical active salt composition (using regex)
                $match: {
                    "medDetails.salt_composition": saltRegex
                }
            },
            {
                // Group by medicineId to deduplicate and pick only the cheapest available batch
                $group: {
                    _id: "$medicineId",
                    cheapestInventoryId: { $first: "$_id" },
                    lowestVendorPrice: { $min: "$vendor_price" }, 
                    batchMrp: { $first: "$mrp" }, 
                    batchPackaging: { $first: "$packaging" },
                    medicineDetails: { $first: "$medDetails" }
                }
            },
            {
                // Format output exactly matching frontend specs
                $project: {
                    _id: 0,
                    medicineId: "$_id",
                    inventoryId: "$cheapestInventoryId",
                    name: "$medicineDetails.name",
                    salt: "$medicineDetails.salt_composition",
                    image: { $arrayElemAt: ["$medicineDetails.image_url", 0] },
                    mrp: { $toString: "$batchMrp" }, 
                    bestPrice: "$lowestVendorPrice", 
                    discount: {
                        $cond: {
                            if: { 
                                $and: [
                                    { $ne: ["$batchMrp", null] },
                                    { $gt: [{ $toDouble: { $ifNull: ["$batchMrp", "0"] } }, 0] }
                                ]
                            },
                            then: {
                                $round: [
                                    {
                                        $multiply: [
                                            { $divide: [ { $subtract: ["$batchMrp", "$lowestVendorPrice"] }, "$batchMrp" ] },
                                            100
                                        ]
                                    },
                                    0
                                ]
                            },
                            else: 0
                        }
                    },
                    packaging: { $ifNull: ["$batchPackaging", "$medicineDetails.packaging"] },
                    prescriptionRequired: "$medicineDetails.prescription_required",
                    isAvailable: { $literal: true }
                }
            },
            { $sort: { bestPrice: 1 } }, // Cheapest substitutes sorted first
            { $limit: 10 } // Return up to 10 matching substitutes
        ]);

        res.json({
            success: true,
            count: similarMeds.length,
            data: similarMeds
        });

    } catch (error) {
        console.error("getSimilarInStockMedicines Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};



module.exports = {scanPrescription,getMedicineSuggestions,getMedicineFullDetails,getMedicineCategories,getPharmacySubCategories,getMedicineCategoryDetails,getPharmacySearchSuggestions,getPharmacyNameSuggestions, getPharmacies, getPharmacyDetails,searchAlternateBrand,getTrendingMedicinesNearUser, getStandardMedicineCatalog,getMedicineVendors,
   getPharmacySlots,getPharmacyDeliveryCharges, checkoutMedicineOrder,getPharmacyAvailableCoupons,validateCoupon,uploadPrescription,cancelMedicineOrder, placeOrder,verifyPharmacyPayment,getOrderHistory, trackOrder,
getLatestAddedMedicines ,getNonPrescriptionMedicines,getHighestDiscountMedicines, getActiveStoreComboOffers,

createPrescriptionRequest, payAndConfirmOrder,verifyPrescriptionRequestPayment,getUserPrescriptionRequests,getUserPrescriptionRequestDetails,estimateRxPrices,
ratePharmacyOrder,getGlobalActiveComboOffers,getComboOfferDetails,
getSimilarInStockMedicines
};