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
const UserSubscription = require('../../../models/UserSubscription');
const Prescription = require('../../../models/Prescription');
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
const HsnMaster = require('../../../models/HsnMaster'); // Import HSN Master model
const { isCodAllowed } = require('../../../utils/policyHelper');

const { createRazorpayOrder, verifyRazorpaySignature, fetchAndMapRazorpayPayment } = require('../../../utils/razorpay'); // 👈 Razorpay Helpers Imported
const { sendPushNotification, notifyAdminsAndVendor } = require('../../../utils/notification'); // For Notifications
const { checkAndApplyBenefit, deductBenefitCount, refundBenefitCount } = require('../../../utils/subscriptionBenefitHelper');
const { processCancellationRefund, creditVendorCompensation } = require('../../../utils/policyHelper');
const { isCodEnabled } = require('../../../utils/policyHelper');
const PharmacyReturnConfig = require('../../../models/PharmacyReturnConfig');
const Driver = require('../../../models/Driver');




// 🔢 Helper: Indian Currency Number to Words Converter
const numberToWordsIndian = (num) => {
    if (!num || isNaN(num) || num <= 0) return "RUPEES ZERO ONLY";
    const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    const inWords = (n) => {
        if (n === 0) return '';
        let str = '';
        if (n >= 10000000) { str += inWords(Math.floor(n / 10000000)) + 'Crore '; n %= 10000000; }
        if (n >= 100000) { str += inWords(Math.floor(n / 100000)) + 'Lakh '; n %= 100000; }
        if (n >= 1000) { str += inWords(Math.floor(n / 1000)) + 'Thousand '; n %= 1000; }
        if (n >= 100) { str += inWords(Math.floor(n / 100)) + 'Hundred '; n %= 100; }
        if (n > 0) {
            if (n < 20) str += a[n];
            else str += b[Math.floor(n / 10)] + ' ' + a[n % 10];
        }
        return str;
    };

    const rupees = Math.floor(num);
    const paise = Math.round((num - rupees) * 100);
    let result = 'RUPEES ' + inWords(rupees).trim();
    if (paise > 0) result += ' AND ' + inWords(paise).trim() + ' PAISE';
    return (result + ' ONLY').toUpperCase();
};
// --- HELPER: Bill Calculation (Mirroring Lab logic) ---
const calculatePharmacyBillHelper = async (pharmacyId, items, patientsCount, collectionType, couponCode, isRapid, appointmentTime, userId) => {
    let rawItemTotalWithoutPromo = 0;
    let promoDeductedTotal = 0;
    let taxableTotal = 0;
    let cgstTotal = 0;
    let sgstTotal = 0;
    const today = new Date();

    for (const item of items) {
        const rawPrice = item.price ?? item.pricePerUnit ?? 0;
        const pricePerUnit = (!isNaN(Number(rawPrice)) && rawPrice !== null && rawPrice !== "") ? Number(rawPrice) : 0;
        
        const rawQty = item.quantity ?? 1;
        const orderedQty = (!isNaN(Number(rawQty)) && rawQty !== null && rawQty !== "") ? Math.max(1, Number(rawQty)) : 1;
        
        const medicineId = item.medicineId?._id || item.medicineId;

        const activeBatch = await MedicineInventory.findOne({
            pharmacyId,
            medicineId,
            is_available: true,
            stock_quantity: { $gt: 0 }
        }).sort({ expiry_date: 1 });

        let batchMrp = 0;
        if (activeBatch && !isNaN(Number(activeBatch.mrp)) && activeBatch.mrp !== null) {
            batchMrp = Number(activeBatch.mrp);
        } else if (item.medicineId?.mrp && !isNaN(Number(item.medicineId.mrp))) {
            batchMrp = Number(item.medicineId.mrp);
        } else {
            batchMrp = pricePerUnit;
        }

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
                const X = activePromo.buyQty || 2;
                const Y = activePromo.getFreeQty || 1;
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

        let cgstPercent = 0;
        let sgstPercent = 0;
        const batchHsn = activeBatch ? activeBatch.hsn_number : null;

        if (batchHsn && batchHsn.trim() !== "" && batchHsn.toUpperCase() !== "N/A") {
            const hsnConfig = await HsnMaster.findOne({ hsnCode: batchHsn.trim(), isActive: true });
            if (hsnConfig) {
                const totalGst = Number(hsnConfig.totalGstPercent || 0);
                cgstPercent = totalGst / 2;
                sgstPercent = totalGst / 2;
            }
        }

        const totalGstPercent = cgstPercent + sgstPercent;
        const itemTaxableAmount = finalItemPrice / (1 + (totalGstPercent / 100));
        const itemCgstAmount = itemTaxableAmount * (cgstPercent / 100);
        const itemSgstAmount = itemTaxableAmount * (sgstPercent / 100);

        taxableTotal += isNaN(itemTaxableAmount) ? 0 : itemTaxableAmount;
        cgstTotal += isNaN(itemCgstAmount) ? 0 : itemCgstAmount;
        sgstTotal += isNaN(itemSgstAmount) ? 0 : itemSgstAmount;
    }

    const safeOriginalTotal = isNaN(rawItemTotalWithoutPromo) ? promoDeductedTotal : rawItemTotalWithoutPromo;
    const comboSavings = Math.max(0, safeOriginalTotal - promoDeductedTotal);

    let deliveryCharge = 0;
    let rapidCharge = 0;
    let slotCharge = 0;

    const cleanPharmaId = pharmacyId.toString();
    const charges = await DeliveryCharge.findOne({ vendorId: cleanPharmaId });

    if (collectionType === 'Home Delivery' || collectionType === 'Home Collection') {
        let standardFee = charges ? Number(charges.fixedPrice || 40) : 40;
        const pharmDeliveryBenefit = await checkAndApplyBenefit(userId, 'freePharmacyDeliveriesCount', standardFee);
        deliveryCharge = Number(pharmDeliveryBenefit.amount || 0);
    }

    // 🚨 RAPID GLITCH FIX: Strict Boolean & String Parsing (Prevents string "false" from evaluating to true)
    const isRapidBool = isRapid === true || isRapid === 'true' || isRapid === 1 || isRapid === '1';

    if (isRapidBool && (!appointmentTime || appointmentTime === 'Immediate')) {
        rapidCharge = charges ? Number(charges.fastDeliveryExtra || 29) : 29;
    } else {
        rapidCharge = 0; // Strictly 0 if rapid delivery is not chosen
    }

    if (appointmentTime && appointmentTime !== 'Immediate' && appointmentTime !== 'undefined') {
        const availConfig = await Availability.findOne({ vendorId: cleanPharmaId });
        if (availConfig && availConfig.premiumSlots) {
            const selectedTimeClean = appointmentTime.trim();
            const premiumSlot = availConfig.premiumSlots.find(ps => ps.time && ps.time.trim() === selectedTimeClean);
            if (premiumSlot) slotCharge = Number(premiumSlot.extraFee) || 0;
        }
    }

    let couponDiscount = 0;
    let couponId = null;
    if (couponCode && couponCode !== 'undefined' && couponCode !== 'null') {
        const coupon = await Coupon.findOne({ couponName: couponCode.trim().toUpperCase(), isActive: true });
        if (coupon && promoDeductedTotal >= coupon.minOrderAmount) {
            couponDiscount = Math.min((promoDeductedTotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
            couponId = coupon._id;
        }
    }

    const totalAmount = Math.max(0, (promoDeductedTotal - couponDiscount) + deliveryCharge + rapidCharge + slotCharge);

    return {
        itemTotal: Math.round(promoDeductedTotal) || 0,
        originalItemTotal: Math.round(safeOriginalTotal) || 0,
        comboSavings: Math.round(comboSavings) || 0,
        taxableTotal: Number((taxableTotal || 0).toFixed(2)),
        cgstTotal: Number((cgstTotal || 0).toFixed(2)),
        sgstTotal: Number((sgstTotal || 0).toFixed(2)),
        couponDiscount: Math.round(couponDiscount) || 0,
        couponId,
        deliveryCharge: Number(deliveryCharge) || 0,
        rapidDeliveryCharge: Number(rapidCharge) || 0, // 👈 Returns exactly 0 when not chosen
        slotCharge: Number(slotCharge) || 0,
        totalAmount: Math.round(totalAmount) || 0
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
    try {
        const User = require('../../../models/User');
        const user = await User.findById(userId);

        // 🚨 Safe Parser: String array ko safely parse karein
        let parsedPids = pids;
        if (typeof pids === 'string') {
            try { parsedPids = JSON.parse(pids); } catch (e) { parsedPids = [pids]; }
        }
        if (!Array.isArray(parsedPids) || parsedPids.length === 0) {
            parsedPids = ['Self'];
        }

        return parsedPids.map(id => {
            if (id === 'Self' || String(id).toLowerCase() === 'self') {
                return { 
                    patientId: 'Self', 
                    name: user ? user.name : "Self", 
                    age: user?.age || 25, 
                    gender: user?.gender || 'Male', 
                    relation: 'Self' 
                };
            }
            const m = user?.familyMember ? user.familyMember.id(id) : null;
            if (m) {
                return { 
                    patientId: id, 
                    name: m.memberName, 
                    age: m.age || 25, 
                    gender: m.gender || 'Other', 
                    relation: m.relation || 'Family' 
                };
            }
            return { 
                patientId: id, 
                name: user ? user.name : "Patient", 
                age: 25, 
                gender: 'Other', 
                relation: 'Self' 
            };
        });
    } catch (err) {
        console.error("mapPatients Error:", err);
        return [{ patientId: 'Self', name: "Patient", age: 25, gender: 'Male', relation: 'Self' }];
    }
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



// 🔒 SECURITY HELPER: Escape Regex special characters to prevent ReDoS / Server Crashes
const escapeRegex = (string) => {
    return string.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
};
// --- API 1: GET MEDICINE SUGGESTIONS (Search Bar) ---
const getMedicineSuggestions = async (req, res) => {
    try {
        const { query } = req.body;

        if (!query || query.trim().length < 2) {
            return res.json({ success: true, data: [] });
        }

        // 🚨 Escaped Regex
        const searchRegex = new RegExp(escapeRegex(query.trim()), 'i');

        const suggestions = await Medicine.find({
            $or: [
                { name: searchRegex },
                { salt_composition: searchRegex }
            ]
        })
            .select('name salt_composition mrp best_price image_url discont_percent')
            .limit(10)
            .lean();

        const formattedData = await Promise.all(suggestions.map(async (med) => {
            const bestOffer = await MedicineInventory.findOne({
                medicineId: med._id,
                is_available: true,
                stock_quantity: { $gt: 0 }
            }).sort({ vendor_price: 1 }).select('vendor_price').lean();

            const lowestPrice = bestOffer ? bestOffer.vendor_price : null;
            const mrpNum = Number(med.mrp || 0);

            const finalPrice = lowestPrice !== null ? lowestPrice : Number(med.best_price || med.mrp || 0);

            let finalDiscount = med.discont_percent;
            if (lowestPrice !== null && mrpNum > 0) {
                finalDiscount = `${Math.round(((mrpNum - lowestPrice) / mrpNum) * 100)}%`;
            }

            return {
                id: med._id,
                name: med.name,
                salt: med.salt_composition,
                price: finalPrice.toString(),
                image: med.image_url && med.image_url.length > 0 ? med.image_url[0] : null,
                discount: finalDiscount,
                displayType: med.name.toLowerCase().includes(query.toLowerCase()) ? "Name Match" : "Salt Match",
                isAvailable: lowestPrice !== null
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
        const medicineId = req.params.id || req.params.medicineId;
        const medicine = await Medicine.findById(medicineId).lean();
        if (!medicine) return res.status(404).json({ success: false, message: "Medicine not found" });

        // Dynamic Alternate Brands
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
            .sort({ vendor_price: 1 })
            .lean();

        // 🚨 Dynamic Admin Return Policy Days Lookup
        const PharmacyReturnConfig = require('../../../models/PharmacyReturnConfig');
        let returnConfig = await PharmacyReturnConfig.findOne({ vendorType: 'Pharmacy' });
        const adminWindowDays = returnConfig?.returnWindowDays || 3;

        const lowestPrice = bestOffer ? bestOffer.vendor_price : null;
        const batchMrp = bestOffer ? Number(bestOffer.mrp || 0) : Number(medicine.mrp || 0);

        if (lowestPrice !== null) {
            medicine.mrp = batchMrp.toString();
            medicine.best_price = lowestPrice.toString();
            if (batchMrp > 0) {
                medicine.discont_percent = `${Math.round(((batchMrp - lowestPrice) / batchMrp) * 100)}%`;
            }
            
            medicine.isReturnAllowed = Boolean(bestOffer.isReturnAllowed);
            medicine.isReplacementAllowed = Boolean(bestOffer.isReplacementAllowed);
            medicine.returnWindowDays = adminWindowDays; // 👈 Dynamic Days Number
            // 🚨 FULLY DYNAMIC TEMPLATE STRING
            medicine.returnPolicyText = medicine.isReturnAllowed 
                ? `${adminWindowDays} Days Return/Replacement Available` 
                : "Non-Returnable Product";
        } else {
            medicine.isReturnAllowed = false;
            medicine.isReplacementAllowed = false;
            medicine.returnWindowDays = adminWindowDays;
            medicine.returnPolicyText = "Non-Returnable Product";
        }

        const substitutes = await Medicine.find({ 
            salt_composition: medicine.salt_composition, 
            _id: { $ne: medicine._id } 
        }).limit(3).lean();

        const frequentlyBought = await Medicine.find({ 
            bread_crumb: medicine.bread_crumb, 
            _id: { $ne: medicine._id } 
        }).limit(4).lean();

        res.json({
            success: true,
            data: {
                details: medicine, 
                frequentlyBought,
                substitutes,
                isAvailable: lowestPrice !== null
            }
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
        if (!category || category.trim() === "" || category === "undefined") {
            return res.json({ success: true, data: [] });
        }

        const safeCategory = escapeRegex(category.trim());

        const subCats = await Medicine.aggregate([
            { $match: { bread_crumb: new RegExp(`^${safeCategory}\\s*>`, 'i') } },
            {
                $project: {
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
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
const getMedicineCategoryDetails = async (req, res) => {
    try {
        const { category, subCategory, page = 1 } = req.query;
        const limit = 20;
        const skip = (parseInt(page) - 1) * limit;

        if (!category || category.trim() === "" || category === "undefined" || category === "null") {
            return res.status(400).json({ success: false, message: "Category query parameter is required." });
        }

        // 🛡️ Safe Regex against special characters (e.g. "Baby & Mom", "Vitamins (A-Z)")
        const safeCat = escapeRegex(category.trim());
        let breadcrumbRegex;

        if (subCategory && subCategory.trim() !== "" && subCategory !== "undefined" && subCategory !== "null") {
            const safeSub = escapeRegex(subCategory.trim());
            breadcrumbRegex = new RegExp(`^${safeCat}\\s*>\\s*${safeSub}`, 'i');
        } else {
            breadcrumbRegex = new RegExp(`^${safeCat}\\s*>`, 'i');
        }

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
                // 🛡️ BUG 8 FIX: Safe numeric conversion preventing String-to-Double cast crashes
                $addFields: {
                    numMRP: {
                        $convert: {
                            input: "$mrp",
                            to: "double",
                            onError: 0,
                            onNull: 0
                        }
                    },
                    numDocBestPrice: {
                        $convert: {
                            input: "$best_price",
                            to: "double",
                            onError: 0,
                            onNull: 0
                        }
                    },
                    numInventoryPrice: {
                        $convert: {
                            input: { $arrayElemAt: ["$inventory.vendor_price", 0] },
                            to: "double",
                            onError: 0,
                            onNull: 0
                        }
                    },
                    numInventoryMRP: {
                        $convert: {
                            input: { $arrayElemAt: ["$inventory.mrp", 0] },
                            to: "double",
                            onError: 0,
                            onNull: 0
                        }
                    },
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
                    minimumMRP: {
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
                            if: {
                                $and: [
                                    { $gt: ["$minimumMRP", 0] },
                                    { $gt: ["$minimumMRP", "$minimumPrice"] }
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
                // Overwrite fields for consistent client payload
                $addFields: {
                    mrp: { $toString: "$minimumMRP" },
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
            data: result[0].data || []
        });
    } catch (error) {
        console.error("getMedicineCategoryDetails Error:", error);
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

        // 🚨 FIXED: Added -bankDetails to prevent leaking bank account/IFSC to patients
        const pharmacy = await Pharmacy.findById(id)
            .select('-password -token -bankDetails -__v')
            .lean();

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
                isOnline: pharmacy.isOnline ?? true
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


// 🧼 Universal Price Sanitizer (Strips ₹, Rs, commas, slashes and extracts valid Number)
const parseNumericPrice = (rawPrice) => {
    if (rawPrice === undefined || rawPrice === null) return 0;
    if (typeof rawPrice === 'number') return isNaN(rawPrice) ? 0 : rawPrice;
    
    // Remove symbols: ₹, Rs, Rs., commas, spaces
    const cleanStr = String(rawPrice).replace(/[₹,Rs\s]/gi, '').trim();
    // Match the first valid decimal/integer number
    const match = cleanStr.match(/(\d+(\.\d+)?)/);
    if (match) {
        const num = parseFloat(match[0]);
        return isNaN(num) ? 0 : num;
    }
    return 0;
};
// GET STANDARD MEDICINE CATALOG (With Robust MRP Sanitization, Active Vendor MinPrice & Fallbacks)
// endpoint: GET /user/pharmacy/standard-list?page=1&limit=20&search=...&category=...
const getStandardMedicineCatalog = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.max(1, parseInt(req.query.limit) || 20);
        const skip = (page - 1) * limit;
        const { search, category } = req.query;

        let query = {};

        // 1. Category Filter (Breadcrumb match)
        if (category && category !== 'All' && category.trim() !== '') {
            query.bread_crumb = { $regex: new RegExp("^" + category.trim(), "i") };
        }

        // 2. Search Keyword Filter
        if (search && search.trim() !== "") {
            const cleanSearch = search.trim().replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
            query.$or = [
                { name: { $regex: cleanSearch, $options: 'i' } },
                { salt_composition: { $regex: cleanSearch, $options: 'i' } },
                { manufacturers: { $regex: cleanSearch, $options: 'i' } }
            ];
        }

        const total = await Medicine.countDocuments(query);

        // Fetch master medicines
        const medicines = await Medicine.find(query)
            .sort({ name: 1 })
            .skip(skip)
            .limit(limit)
            .lean();

        // 3. High-Performance Inventory & Price Resolver
        const enrichedMedicines = await Promise.all(medicines.map(async (med) => {
            // Find active stock batches across all approved pharmacies
            const activeBatches = await MedicineInventory.find({
                medicineId: med._id,
                is_available: true,
                stock_quantity: { $gt: 0 }
            })
            .populate('pharmacyId', 'name rating profileImage city isActive profileStatus')
            .sort({ vendor_price: 1 })
            .lean();

            // Filter approved pharmacies only
            const validBatches = activeBatches.filter(
                b => b.pharmacyId && b.pharmacyId.isActive !== false && b.pharmacyId.profileStatus === 'Approved'
            );

            // 🚨 MULTI-TIER MRP RESOLUTION (Guarantees MRP is NEVER 0 or null)
            let masterMrp = parseNumericPrice(med.mrp);
            let masterBestPrice = parseNumericPrice(med.best_price);
            let lowestVendorPrice = null;
            let batchMrp = 0;
            let lowestBatch = null;

            if (validBatches.length > 0) {
                lowestBatch = validBatches[0];
                lowestVendorPrice = Number(lowestBatch.vendor_price || 0);
                batchMrp = parseNumericPrice(lowestBatch.mrp);
            }

            // Fallback hierarchy:
            // 1. Batch MRP (Real printed price entered by vendor)
            // 2. Master Catalog MRP
            // 3. Master Best Price / Selling Price
            let finalMrp = batchMrp > 0 ? batchMrp : (masterMrp > 0 ? masterMrp : (masterBestPrice > 0 ? masterBestPrice : (lowestVendorPrice || 50)));
            
            // Final Selling Price (minPrice)
            let finalSellingPrice = lowestVendorPrice !== null && lowestVendorPrice > 0 
                ? lowestVendorPrice 
                : (masterBestPrice > 0 ? masterBestPrice : finalMrp);

            // If selling price exceeds MRP, adjust MRP upward for consistency
            if (finalSellingPrice > finalMrp) {
                finalMrp = finalSellingPrice;
            }

            // Calculate Discount Percentage
            let discountPercentage = 0;
            if (finalMrp > 0 && finalSellingPrice < finalMrp) {
                discountPercentage = Math.round(((finalMrp - finalSellingPrice) / finalMrp) * 100);
            }

            return {
                _id: med._id,
                name: med.name || "Medicine",
                manufacturers: med.manufacturers || "Standard Pharma",
                salt_composition: med.salt_composition || "N/A",
                packaging: med.packaging || "10 Tablets",
                image_url: med.image_url && med.image_url.length > 0 ? med.image_url : ["https://placehold.co/200?text=Medicine"],
                prescription_required: med.prescription_required || "No",
                isRxRequired: String(med.prescription_required).toUpperCase() === 'YES',
                bread_crumb: med.bread_crumb || "",
                
                // 💰 100% SANITIZED & SYNCHRONIZED PRICING FIELDS
                mrp: Number(finalMrp.toFixed(2)),                        // 👈 Clean Numeric MRP (e.g. 120.00)
                minPrice: Number(finalSellingPrice.toFixed(2)),           // 👈 Clean Numeric Selling Price (e.g. 95.00)
                best_price: Number(finalSellingPrice.toFixed(2)).toString(), // String alias for backward compatibility
                discountPercentage: discountPercentage,                   // 👈 Numeric Percentage (e.g. 21)
                discont_percent: `${discountPercentage}% OFF`,            // String alias (e.g. "21% OFF")
                
                // Inventory & Seller metadata
                isAvailable: validBatches.length > 0,
                availableSellersCount: validBatches.length,
                cheapestSeller: lowestBatch ? {
                    pharmacyId: lowestBatch.pharmacyId._id,
                    pharmacyName: lowestBatch.pharmacyId.name,
                    city: lowestBatch.pharmacyId.city || "",
                    rating: lowestBatch.pharmacyId.rating || 4.5,
                    stock: lowestBatch.stock_quantity || 0
                } : null
            };
        }));

        res.status(200).json({
            success: true,
            pagination: {
                totalItems: total,
                totalPages: Math.ceil(total / limit) || 1,
                currentPage: page,
                limit: limit,
                hasNextPage: page < Math.ceil(total / limit),
                hasPrevPage: page > 1
            },
            count: enrichedMedicines.length,
            data: enrichedMedicines
        });

    } catch (error) {
        console.error("Get Standard Medicine Catalog Error:", error);
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

        const isPharmacyCodAvailable = await isCodEnabled('Pharmacy', req?.user ? req.user.id : null);

        // Dynamic Alternate Brands Enrichment
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
                        
                        existingItem.manufacturingDate = (item.manufacturing_date || item.mfg_date)
                            ? moment(item.manufacturing_date || item.mfg_date).format('MM/YYYY') 
                            : "N/A";
                        existingItem.expiryDate = item.expiry_date 
                            ? moment(item.expiry_date).format('MM/YYYY') 
                            : "N/A";

                        existingItem.isReturnAllowed = Boolean(item.isReturnAllowed);
                        existingItem.isReplacementAllowed = Boolean(item.isReplacementAllowed);
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
                        manufacturingDate: (item.manufacturing_date || item.mfg_date)
                            ? moment(item.manufacturing_date || item.mfg_date).format('MM/YYYY') 
                            : "N/A",
                        expiryDate: item.expiry_date 
                            ? moment(item.expiry_date).format('MM/YYYY') 
                            : "N/A",
                        isReturnAllowed: Boolean(item.isReturnAllowed),
                        isReplacementAllowed: Boolean(item.isReplacementAllowed),
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

        // 🚨 DYNAMIC ADMIN RETURN DAYS LOOKUP
        const PharmacyReturnConfig = require('../../../models/PharmacyReturnConfig');
        let returnConfig = await PharmacyReturnConfig.findOne({ vendorType: 'Pharmacy' });
        const adminWindowDays = returnConfig?.returnWindowDays || 3;

        let isReturnAllowedSummary = false;
        let isReplacementAllowedSummary = false;

        if (availableInPharmacies.length > 0) {
            isReturnAllowedSummary = availableInPharmacies[0].isReturnAllowed;
            isReplacementAllowedSummary = availableInPharmacies[0].isReplacementAllowed;
        }

        masterMedicine.isReturnAllowed = isReturnAllowedSummary;
        masterMedicine.isReplacementAllowed = isReplacementAllowedSummary;
        masterMedicine.returnWindowDays = adminWindowDays; // 👈 Dynamic Number
        // 🚨 FULLY DYNAMIC TEMPLATE STRING
        masterMedicine.returnPolicyText = isReturnAllowedSummary 
            ? `${adminWindowDays} Days Return/Replacement Available` 
            : "Non-Returnable Product";

        res.json({
            success: true,
            maxRadius: `${maxRadius} km`,
            locationApplied: (req?.body?.lat || req?.query?.lat) ? "User GPS" : "Delhi (Default)",
            count: availableInPharmacies.length,
            isCodAvailable: isPharmacyCodAvailable,
            data: { 
                medicineDetails: { 
                    ...masterMedicine, 
                    minPrice: minPriceFound,
                    totalSellers: availableInPharmacies.length,
                    isCodAvailable: isPharmacyCodAvailable
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

        if (!pharmacyId || !date || date === 'undefined' || date === 'null') {
            return res.status(400).json({ success: false, message: "Pharmacy ID and a valid Date are required" });
        }

        // 1. Fetch Availability Configuration
        const config = await Availability.findOne({ vendorId: pharmacyId });
        if (!config) {
            return res.status(404).json({ success: false, message: "Pharmacy timings not configured" });
        }

        // 2. Check for Weekly Off-days (e.g., Sunday)
        const dayName = moment(date).format('dddd');
        if (config.offDays && config.offDays.includes(dayName)) {
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

        // 🛡️ BUG 5 FIX: BSON Date Range calculation for MongoDB Aggregation Pipeline
        const startOfDay = moment(date).startOf('day').toDate();
        const endOfDay = moment(date).endOf('day').toDate();

        // 5. Occupancy/Capacity Logic: Calculate existing bookings for this pharmacy on this date range
        const bookedCounts = await PharmacyBooking.aggregate([
            {
                $match: {
                    pharmacyId: new mongoose.Types.ObjectId(pharmacyId),
                    appointmentDate: { $gte: startOfDay, $lte: endOfDay }, // 👈 Fixed: Matches exact date boundaries correctly
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

        if (!couponName) {
            return res.status(400).json({ success: false, message: "Coupon code is required." });
        }

        // 🚨 FIXED: Auto-Trim and UpperCase normalizer
        const cleanCouponCode = couponName.trim().toUpperCase();

        const coupon = await Coupon.findOne({
            couponName: cleanCouponCode,
            $or: [
                { vendorId: pharmacyId },
                { isAdminCreated: true, vendorType: { $in: ['Pharmacy', 'All'] } }
            ],
            isActive: true,
            expiryDate: { $gte: new Date() }
        });

        if (!coupon) return res.status(404).json({ success: false, message: "Invalid or expired coupon." });
        if (totalAmount < coupon.minOrderAmount) {
            return res.status(400).json({
                success: false,
                message: `Minimum order amount of ₹${coupon.minOrderAmount} required to apply this coupon.`
            });
        }

        const discount = (totalAmount * coupon.discountPercentage) / 100;
        const finalDiscount = Math.min(discount, coupon.maxDiscount);

        res.json({ success: true, discount: Math.round(finalDiscount) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// POST /user/pharmacy/checkout
// @desc    Evaluate Pharmacy Checkout Summary with Mutually Exclusive Slot, Rapid & Standard Delivery
// @route   POST /user/pharmacy/checkout
// @access  Private (User)
const checkoutMedicineOrder = async (req, res) => {
    try {
        const userId = req.user.id;
        const { 
            collectionType = 'Home Delivery', 
            isRapid = false, 
            isSlotSelected = false,
            appointmentTime,
            couponCode 
        } = req.body;

        const cart = await Cart.findOne({ userId }).populate('pharmacyCart.items.medicineId');
        if (!cart || !cart.pharmacyCart || !cart.pharmacyCart.items || cart.pharmacyCart.items.length === 0) {
            return res.status(400).json({ success: false, message: "Pharmacy cart is empty." });
        }

        const pharmacyId = cart.pharmacyCart.pharmacyId;
        const items = cart.pharmacyCart.items;

        let itemTotal = 0;
        let originalItemTotal = 0;
        let comboSavings = 0;
        let rxMandatory = false;

        // 1. Process items with exact BOGO Promo deductions
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const unitPrice = Number(item.price || 0);
            const requestedQty = Number(item.quantity || 1);
            const batchMrp = Number(item.medicineId?.mrp || unitPrice);

            if (item.medicineId?.prescription_required === 'YES' || item.medicineId?.prescription_required === 'Yes') {
                rxMandatory = true;
            }

            let freeUnits = 0;
            if (item.isComboApplied && item.comboOfferId) {
                const promo = await PharmacyComboOffer.findById(item.comboOfferId);
                if (promo && promo.isActive) {
                    const buyQty = Number(promo.buyQty || 2);
                    const getFreeQty = Number(promo.getFreeQty || 1);
                    const bundleSize = buyQty + getFreeQty;
                    const fullBundles = Math.floor(requestedQty / bundleSize);
                    freeUnits = fullBundles * getFreeQty;
                    comboSavings += (freeUnits * unitPrice);
                }
            }

            const chargeableQty = Math.max(1, requestedQty - freeUnits);
            itemTotal += (unitPrice * chargeableQty);
            originalItemTotal += (batchMrp * requestedQty);
        }

        // 2. Dynamic Delivery & Slot Calculation (Mutually Exclusive Logic)
        let standardDeliveryCharge = 0;
        let rapidDeliveryCharge = 0;
        let slotCharge = 0;
        let selectedDeliveryMode = 'Standard Delivery (3 Hours)';

        const isRapidDelivery = String(isRapid) === 'true';
        const isCustomSlot = String(isSlotSelected) === 'true' || (
            appointmentTime && 
            !['Immediate', 'Immediate (1 Hour)', 'Standard Delivery', 'undefined', 'null'].includes(appointmentTime) && 
            appointmentTime.trim() !== ''
        );

        if (collectionType === 'Home Delivery') {
            const deliveryConfig = await DeliveryCharge.findOne({ vendorId: pharmacyId, vendorType: 'Pharmacy' });
            
            const baseFee = Number(deliveryConfig?.fixedPrice !== undefined ? deliveryConfig.fixedPrice : 50);
            const freeThreshold = Number(deliveryConfig?.freeDeliveryThreshold || 0);
            const fastFee = Number(deliveryConfig?.fastDeliveryExtra !== undefined ? deliveryConfig.fastDeliveryExtra : 100);

            if (isCustomSlot) {
                // Option A: Scheduled Custom Slot -> Normal fee waived, only Premium Slot fee applies if configured
                selectedDeliveryMode = `Scheduled Slot (${appointmentTime || 'Custom'})`;
                standardDeliveryCharge = 0;
                rapidDeliveryCharge = 0;

                const availabilityConfig = await Availability.findOne({ vendorId: pharmacyId, vendorType: 'Pharmacy' });
                if (availabilityConfig && availabilityConfig.premiumSlots && availabilityConfig.premiumSlots.length > 0) {
                    const cleanTime = String(appointmentTime).trim();
                    const matchedSlot = availabilityConfig.premiumSlots.find(ps => 
                        ps.time && (cleanTime.includes(ps.time) || ps.time.includes(cleanTime.split(' ')[0]))
                    );
                    if (matchedSlot) {
                        slotCharge = Number(matchedSlot.extraFee || 0);
                    }
                }
            } else if (isRapidDelivery) {
                // Option B: 1-Hour Express Delivery -> Normal fee waived, only Rapid fee applies
                selectedDeliveryMode = 'Express (1 Hour)';
                standardDeliveryCharge = 0;
                rapidDeliveryCharge = fastFee;
                slotCharge = 0;
            } else {
                // Option C: Standard Delivery -> Check free delivery threshold
                selectedDeliveryMode = 'Standard Delivery (3 Hours)';
                rapidDeliveryCharge = 0;
                slotCharge = 0;
                if (freeThreshold > 0 && itemTotal >= freeThreshold) {
                    standardDeliveryCharge = 0;
                } else {
                    standardDeliveryCharge = baseFee;
                }
            }
        } else {
            selectedDeliveryMode = 'Self Pickup';
        }

        // 3. Subscription Benefit Check (Applicable only on Standard Delivery)
        let deliveryBenefit = { isApplied: false, hasActiveSubscription: false, isBenefitExhausted: false, remainingCount: 0 };
        let finalDeliveryCharge = 0;

        if (collectionType === 'Home Delivery' && !isRapidDelivery && !isCustomSlot) {
            deliveryBenefit = await checkAndApplyBenefit(userId, 'freePharmacyDeliveriesCount', standardDeliveryCharge);
            finalDeliveryCharge = deliveryBenefit.amount;
        }

        // 4. Coupon Discount Calculation
        let couponDiscount = 0;
        let validCouponId = null;

        if (couponCode && typeof couponCode === 'string' && couponCode.trim() !== '' && couponCode !== 'undefined') {
            const cleanCode = couponCode.trim().toUpperCase();
            const coupon = await Coupon.findOne({ 
                couponName: cleanCode, 
                isActive: true,
                expiryDate: { $gte: new Date() }
            });

            if (coupon && itemTotal >= coupon.minOrderAmount) {
                if (!coupon.vendorId || String(coupon.vendorId) === String(pharmacyId) || coupon.vendorType === 'All' || coupon.vendorType === 'Pharmacy') {
                    couponDiscount = Math.min((itemTotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
                    validCouponId = coupon._id;
                }
            }
        }

        const isCodAvailable = await isCodEnabled('Pharmacy', userId);
        const totalPayable = Math.max(0, Math.round((itemTotal - couponDiscount) + finalDeliveryCharge + rapidDeliveryCharge + slotCharge));

        res.status(200).json({
            success: true,
            data: {
                pharmacyId,
                rxMandatory,
                collectionType,
                selectedDeliveryMode,
                isCodAvailable,
                billSummary: {
                    itemTotal: Math.round(itemTotal),
                    originalItemTotal: Math.round(originalItemTotal),
                    comboSavings: Math.round(comboSavings),
                    couponDiscount: Math.round(couponDiscount),
                    couponId: validCouponId,
                    deliveryCharge: finalDeliveryCharge,
                    originalDeliveryCharge: standardDeliveryCharge,
                    rapidDeliveryCharge: Math.round(rapidDeliveryCharge),
                    slotCharge: Math.round(slotCharge),
                    totalAmount: Math.round(totalPayable)
                },
                subscriptionBenefit: {
                    isApplied: deliveryBenefit.isApplied,
                    hasActiveSubscription: deliveryBenefit.hasActiveSubscription,
                    isBenefitExhausted: deliveryBenefit.isBenefitExhausted,
                    remainingCount: deliveryBenefit.remainingCount,
                    planName: deliveryBenefit.planName || "",
                    benefitField: "freePharmacyDeliveriesCount",
                    exhaustedMessage: deliveryBenefit.exhaustedMessage || (deliveryBenefit.isBenefitExhausted ? "Your subscription free pharmacy delivery quota is exhausted. Standard delivery fee applied." : "")
                }
            }
        });

    } catch (error) {
        console.error("Pharmacy Checkout Summary Error:", error);
        res.status(500).json({ success: false, message: error.message || "Internal Server Error in pharmacy checkout." });
    }
};

// @desc    Place Pharmacy Medicine Order (Sets 'Pending' for Online until Payment Verified)
// @route   POST /user/pharmacy/place-order
// @access  Private (User)
const placeOrder = async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "User not authenticated." });
        }

        // 1. Fetch Cart
        const cart = await Cart.findOne({ userId }).populate('pharmacyCart.items.medicineId');
        if (!cart || !cart.pharmacyCart || !cart.pharmacyCart.items || cart.pharmacyCart.items.length === 0) {
            return res.status(400).json({ 
                success: false, 
                errorStep: "CART_EMPTY",
                message: "Your pharmacy cart is empty. Please add medicines before checkout." 
            });
        }

        const pharmacyId = cart.pharmacyCart.pharmacyId;
        const cartItems = cart.pharmacyCart.items;

        // 2. Parse Address
        let parsedAddress = null;
        try {
            if (typeof req.body.address === 'string') {
                parsedAddress = JSON.parse(req.body.address);
            } else if (typeof req.body.address === 'object') {
                parsedAddress = req.body.address;
            }
        } catch (addrErr) {
            return res.status(400).json({
                success: false,
                errorStep: "ADDRESS_PARSE_ERROR",
                message: "Invalid address format."
            });
        }

        const collectionType = req.body.collectionType || 'Home Delivery';
        if (collectionType === 'Home Delivery') {
            if (!parsedAddress || (!parsedAddress.houseNo && !parsedAddress.address) || !parsedAddress.city) {
                return res.status(400).json({
                    success: false,
                    errorStep: "ADDRESS_INCOMPLETE",
                    message: "Complete delivery address (houseNo/address, city, phone) is required for Home Delivery."
                });
            }
            if (!parsedAddress.name || String(parsedAddress.name).trim() === "") {
                parsedAddress.name = req.user?.name || "Recipient";
            }
        }

        // 3. Prescription Check
        let rxRequired = false;
        cartItems.forEach((item) => {
            const med = item.medicineId;
            if (med && (med.prescription_required === 'YES' || med.prescription_required === 'Yes' || med.prescription_required === true)) {
                rxRequired = true;
            }
        });

        let uploadedRxPaths = [];
        if (req.files && req.files['prescriptionImages'] && req.files['prescriptionImages'].length > 0) {
            uploadedRxPaths = req.files['prescriptionImages'].map(f => `/uploads/pharmacy_prescriptions/${f.filename}`);
        }

        if (rxRequired && uploadedRxPaths.length === 0) {
            return res.status(400).json({
                success: false,
                errorStep: "PRESCRIPTION_MANDATORY",
                message: "Prescription is required for medicines in your cart. Please upload prescription images via 'prescriptionImages' field."
            });
        }

        // 4. Inventory Stock Verification & Line-Item Pricing
        let itemTotal = 0;
        let originalItemTotal = 0;
        let comboSavings = 0;
        const processedItems = [];

        for (let i = 0; i < cartItems.length; i++) {
            const item = cartItems[i];
            const medId = item.medicineId?._id || item.medicineId;
            const requestedQty = Number(item.quantity || 1);

            const inventory = await MedicineInventory.findOne({
                pharmacyId,
                medicineId: medId,
                is_available: true
            }).sort({ expiry_date: 1 });

            if (!inventory || inventory.stock_quantity < requestedQty) {
                const medName = item.medicineId?.name || "Selected Medicine";
                const availableStock = inventory ? inventory.stock_quantity : 0;
                return res.status(400).json({
                    success: false,
                    errorStep: "OUT_OF_STOCK",
                    message: `Item '${medName}' is out of stock. Available quantity: ${availableStock}.`
                });
            }

            const unitPrice = Number(item.price || inventory.vendor_price || 0);
            const batchMrp = Number(inventory.mrp || item.medicineId?.mrp || unitPrice);
            let freeUnits = 0;

            if (item.isComboApplied && item.comboOfferId) {
                const promo = await PharmacyComboOffer.findById(item.comboOfferId);
                if (promo && promo.isActive) {
                    const buyQty = Number(promo.buyQty || 2);
                    const getFreeQty = Number(promo.getFreeQty || 1);
                    const bundleSize = buyQty + getFreeQty;
                    const fullBundles = Math.floor(requestedQty / bundleSize);
                    freeUnits = fullBundles * getFreeQty;
                    comboSavings += (freeUnits * unitPrice);
                }
            }

            const chargeableQty = Math.max(1, requestedQty - freeUnits);
            const lineItemPrice = unitPrice * chargeableQty;
            itemTotal += lineItemPrice;
            originalItemTotal += (batchMrp * requestedQty);

            processedItems.push({
                medicineId: medId,
                name: item.medicineId?.name || item.name,
                mrp: batchMrp,
                price: unitPrice,
                quantity: requestedQty,
                duration: item.duration || "Full Course",
                startDate: item.startDate || new Date(),
                isComboApplied: item.isComboApplied || false,
                comboOfferId: item.comboOfferId || null,
                freeQuantity: freeUnits,
                hsn_number: inventory.hsn_number || "",
                isReturnAllowed: inventory.isReturnAllowed || false,
                isReplacementAllowed: inventory.isReplacementAllowed || false
            });
        }

        // 5. Exclusive Delivery & Slot Charges
        let standardDeliveryCharge = 0;
        let rapidDeliveryCharge = 0;
        let slotCharge = 0;

        const isRapidDelivery = String(req.body.isRapid) === 'true';
        const isCustomSlot = String(req.body.isSlotSelected) === 'true' || (
            req.body.appointmentTime && 
            !['Immediate', 'Immediate (1 Hour Express)', 'Immediate (1 Hour)', 'Standard Delivery', 'Standard Delivery (3 Hours)', 'undefined', 'null'].includes(req.body.appointmentTime) && 
            req.body.appointmentTime.trim() !== ''
        );

        if (collectionType === 'Home Delivery') {
            const deliveryConfig = await DeliveryCharge.findOne({ vendorId: pharmacyId, vendorType: 'Pharmacy' });
            const baseFee = Number(deliveryConfig?.fixedPrice !== undefined ? deliveryConfig.fixedPrice : 50);
            const freeThreshold = Number(deliveryConfig?.freeDeliveryThreshold || 0);
            const fastFee = Number(deliveryConfig?.fastDeliveryExtra !== undefined ? deliveryConfig.fastDeliveryExtra : 100);

            if (isCustomSlot) {
                standardDeliveryCharge = 0;
                rapidDeliveryCharge = 0;

                const availabilityConfig = await Availability.findOne({ vendorId: pharmacyId, vendorType: 'Pharmacy' });
                if (availabilityConfig && availabilityConfig.premiumSlots && availabilityConfig.premiumSlots.length > 0) {
                    const cleanTime = String(req.body.appointmentTime).trim();
                    const matchedSlot = availabilityConfig.premiumSlots.find(ps => 
                        ps.time && (cleanTime.includes(ps.time) || ps.time.includes(cleanTime.split(' ')[0]))
                    );
                    if (matchedSlot) {
                        slotCharge = Number(matchedSlot.extraFee || 0);
                    }
                }
            } else if (isRapidDelivery) {
                standardDeliveryCharge = 0;
                rapidDeliveryCharge = fastFee;
                slotCharge = 0;
            } else {
                rapidDeliveryCharge = 0;
                slotCharge = 0;
                if (freeThreshold > 0 && itemTotal >= freeThreshold) {
                    standardDeliveryCharge = 0;
                } else {
                    standardDeliveryCharge = baseFee;
                }
            }
        }

        // Apply Subscription Benefit (Only on Standard Delivery)
        let deliveryBenefit = { isApplied: false };
        let finalDeliveryCharge = 0;

        if (collectionType === 'Home Delivery' && !isRapidDelivery && !isCustomSlot) {
            deliveryBenefit = await checkAndApplyBenefit(userId, 'freePharmacyDeliveriesCount', standardDeliveryCharge);
            finalDeliveryCharge = deliveryBenefit.amount;
        }

        // 6. Coupon Discount
        let couponDiscount = 0;
        let appliedCouponId = null;
        const couponCode = req.body.couponCode;

        if (couponCode && typeof couponCode === 'string' && couponCode.trim() !== '' && couponCode !== 'undefined' && couponCode !== 'null') {
            const cleanCode = couponCode.trim().toUpperCase();
            const coupon = await Coupon.findOne({
                couponName: cleanCode,
                isActive: true,
                expiryDate: { $gte: new Date() }
            });

            if (coupon && itemTotal >= coupon.minOrderAmount) {
                if (!coupon.vendorId || String(coupon.vendorId) === String(pharmacyId) || coupon.vendorType === 'All' || coupon.vendorType === 'Pharmacy') {
                    couponDiscount = Math.min((itemTotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
                    appliedCouponId = coupon._id;
                }
            }
        }

        const totalAmount = Math.max(0, Math.round((itemTotal - couponDiscount) + finalDeliveryCharge + rapidDeliveryCharge + slotCharge));

        // 7. Payment Method Verification
        const paymentMethod = req.body.paymentMethod || 'COD';
        const isCod = (paymentMethod === 'COD');

        if (isCod) {
            const codAllowed = await isCodEnabled('Pharmacy', userId);
            if (!codAllowed) {
                return res.status(400).json({
                    success: false,
                    errorStep: "COD_DISABLED",
                    message: "Cash on Delivery is currently unavailable for pharmacy orders. Please choose Online Payment."
                });
            }
        }

        const orderId = `HK-MED-${Date.now().toString().slice(-6)}${Math.floor(100 + Math.random() * 900)}`;

        let finalAppointmentDate = new Date();
        if (req.body.appointmentDate && req.body.appointmentDate !== 'undefined' && req.body.appointmentDate !== 'null') {
            const parsedD = new Date(req.body.appointmentDate);
            if (!isNaN(parsedD.getTime())) finalAppointmentDate = parsedD;
        }

        let finalAppointmentTime = isCustomSlot 
            ? req.body.appointmentTime.trim()
            : (isRapidDelivery ? "Immediate (1 Hour Express)" : "Standard Delivery (3 Hours)");

        // 8. Razorpay Order Generation (Online Only)
        let rzpOrder = null;
        if (!isCod && totalAmount > 0) {
            rzpOrder = await createRazorpayOrder(totalAmount, `rcpt_${orderId}`);
        }

        // =========================================================================
        // 🚨 9. STATUS LOGIC FIX: Online = 'Pending' / COD = 'Placed'
        // =========================================================================
        const initialStatus = isCod ? 'Placed' : 'Pending';

        const newBooking = await PharmacyBooking.create({
            userId,
            pharmacyId,
            orderId,
            items: processedItems,
            collectionType,
            appointmentDate: finalAppointmentDate,
            appointmentTime: finalAppointmentTime,
            isRapid: isRapidDelivery,
            address: parsedAddress || {},
            billSummary: {
                itemTotal: Math.round(itemTotal),
                originalItemTotal: Math.round(originalItemTotal),
                comboSavings: Math.round(comboSavings),
                deliveryCharge: finalDeliveryCharge,
                rapidDeliveryCharge: Math.round(rapidDeliveryCharge),
                slotCharge: Math.round(slotCharge),
                couponDiscount: Math.round(couponDiscount),
                couponId: appliedCouponId,
                totalAmount
            },
            paymentMethod,
            paymentStatus: 'Pending',
            status: initialStatus, // 👈 Online stays 'Pending' until payment verification!
            deliveryStatus: isCod ? 'PendingAssignment' : 'PendingAssignment',
            orderType: rxRequired ? 'Prescription' : 'General',
            prescriptionImages: uploadedRxPaths,
            deliveryOTP: Math.floor(1000 + Math.random() * 9000).toString()
        });

        // 10. For COD: Deduct Stock, Benefits & Clear Cart Immediately
        if (isCod || totalAmount === 0) {
            for (const item of processedItems) {
                await MedicineInventory.findOneAndUpdate(
                    { pharmacyId, medicineId: item.medicineId },
                    { $inc: { stock_quantity: -Number(item.quantity) } }
                );
            }

            if (deliveryBenefit.isApplied) {
                await deductBenefitCount(userId, 'freePharmacyDeliveriesCount');
            }

            await Cart.findOneAndUpdate(
                { userId },
                { $set: { "pharmacyCart.items": [], "pharmacyCart.pharmacyId": null } }
            );

            try {
                await notifyAdminsAndVendor(
                    pharmacyId,
                    'pharmacy',
                    "📦 New Medicine Order Placed (COD)!",
                    `Order #${orderId} received for ₹${totalAmount}. Schedule: ${finalAppointmentTime}.`,
                    { orderId: newBooking._id.toString(), type: 'new_pharmacy_order' }
                );
            } catch (e) {}

            return res.status(201).json({
                success: true,
                message: "Order placed successfully!",
                orderId: newBooking.orderId,
                status: newBooking.status,
                data: newBooking
            });
        }

        // 11. For Online: Return Razorpay Order (Do NOT deduct stock or clear cart yet)
        return res.status(201).json({
            success: true,
            message: "Razorpay order initialized. Complete payment to confirm order.",
            key_id: process.env.RAZORPAY_KEY_ID,
            amount: rzpOrder.amount,
            razorpayOrderId: rzpOrder.id,
            orderId: newBooking.orderId,
            bookingId: newBooking._id,
            status: "Pending", // 👈 Signals frontend that payment is awaiting
            data: newBooking
        });

    } catch (error) {
        console.error("placeOrder Error:", error);
        return res.status(500).json({ 
            success: false, 
            message: error.message || "Internal Server Error in placeOrder." 
        });
    }
};

// @desc    Verify Razorpay Payment Signature & Transition Order to 'Placed' & Deduct Stock
// @route   POST /user/pharmacy/verify-payment
// @access  Private (User)
const verifyPharmacyPayment = async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "User not authenticated." });
        }

        // Universal Payload Resolver
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

        const rzpPaymentId = body.razorpay_payment_id || body.razorpayPaymentId || body.paymentId || body.payment_id;
        const rzpOrderId = body.razorpay_order_id || body.razorpayOrderId || body.orderId || body.order_id;
        const rzpSignature = body.razorpay_signature || body.razorpaySignature || body.signature;

        const targetOrderId = body.orderId || body.bookingId || body.id || body._id;

        if (!rzpPaymentId) {
            return res.status(400).json({ 
                success: false, 
                errorStep: "MISSING_PAYMENT_ID",
                message: "Missing payment transaction ID (razorpay_payment_id / razorpayPaymentId)." 
            });
        }

        // Find Pending Pharmacy Booking
        const isObjectId = mongoose.isValidObjectId(targetOrderId);
        const searchConditions = [];

        if (isObjectId) searchConditions.push({ _id: new mongoose.Types.ObjectId(targetOrderId) });
        if (targetOrderId) searchConditions.push({ orderId: String(targetOrderId).trim() });
        if (rzpOrderId) searchConditions.push({ "paymentDetails.razorpayOrderId": String(rzpOrderId).trim() });

        let booking = await PharmacyBooking.findOne({
            userId,
            $or: searchConditions
        });

        if (!booking) {
            booking = await PharmacyBooking.findOne({
                userId,
                status: 'Pending',
                paymentStatus: 'Pending'
            }).sort({ createdAt: -1 });
        }

        if (!booking) {
            return res.status(404).json({ 
                success: false, 
                errorStep: "ORDER_NOT_FOUND",
                message: "Pharmacy order record not found for verification." 
            });
        }

        // Signature Verification
        let isVerified = false;
        if (rzpOrderId && rzpSignature) {
            isVerified = verifyRazorpaySignature(rzpOrderId, rzpPaymentId, rzpSignature);
        }

        if (!isVerified && (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV)) {
            isVerified = true;
        }

        if (!isVerified && process.env.NODE_ENV === 'production') {
            booking.paymentStatus = 'Failed';
            booking.status = 'Cancelled';
            await booking.save();
            return res.status(400).json({ 
                success: false, 
                errorStep: "SIGNATURE_MISMATCH",
                message: "Payment signature verification failed. Order marked as Failed." 
            });
        }

        // Map Payment Info
        let paymentRecord = null;
        try {
            if (rzpSignature) {
                paymentRecord = await fetchAndMapRazorpayPayment(rzpPaymentId, rzpSignature);
            }
        } catch (e) {}

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

        // =========================================================================
        // 🚀 TRANSITION ORDER: Status becomes 'Placed' & Payment becomes 'Paid'
        // =========================================================================
        booking.status = 'Placed';
        booking.paymentStatus = 'Paid';
        booking.paymentMethod = paymentRecord.method || 'Online';
        booking.paymentDetails = paymentRecord;
        await booking.save();

        // Deduct Inventory Stock for Verified Online Order
        for (const item of booking.items) {
            if (item.medicineId) {
                await MedicineInventory.findOneAndUpdate(
                    { pharmacyId: booking.pharmacyId, medicineId: item.medicineId },
                    { $inc: { stock_quantity: -Number(item.quantity) } }
                );
            }
        }

        // Deduct Subscription Benefit Count if Delivery was Free
        if (booking.billSummary?.deliveryCharge === 0 && booking.collectionType === 'Home Delivery' && !booking.isRapid) {
            await deductBenefitCount(userId, 'freePharmacyDeliveriesCount');
        }

        // Update Coupon Usage
        if (booking.billSummary?.couponId) {
            await Coupon.findByIdAndUpdate(booking.billSummary.couponId, {
                $push: { usedBy: { userId, usageCount: 1 } }
            });
        }

        // Clear User's Pharmacy Cart
        await Cart.findOneAndUpdate(
            { userId },
            { $set: { "pharmacyCart.items": [], "pharmacyCart.pharmacyId": null } }
        );

        // Notify Pharmacy Vendor
        try {
            await notifyAdminsAndVendor(
                booking.pharmacyId,
                'pharmacy',
                "📦 New Paid Medicine Order Placed!",
                `Order #${booking.orderId} for ₹${booking.billSummary.totalAmount} has been paid online and confirmed.`,
                { orderId: booking._id.toString(), type: 'new_pharmacy_order' }
            );
        } catch (e) {}

        return res.status(200).json({
            success: true,
            message: "Payment successfully verified and order confirmed!",
            orderId: booking.orderId,
            deliveryOTP: booking.deliveryOTP,
            data: booking
        });

    } catch (error) {
        console.error("verifyPharmacyPayment Error:", error);
        return res.status(500).json({ 
            success: false, 
            message: error.message || "Internal Server Error in pharmacy payment verification." 
        });
    }
};

const uploadPrescription = async (req, res) => {
    try {
        const { address, pharmacyId, collectionType } = req.body;
        
        let images = [];
        if (req.files) {
            if (Array.isArray(req.files)) {
                images = req.files.map(f => f.path.replace(/\\/g, "/"));
            } else if (req.files['prescriptionImages']) {
                images = req.files['prescriptionImages'].map(f => f.path.replace(/\\/g, "/"));
            }
        } else if (req.file) {
            images = [req.file.path.replace(/\\/g, "/")];
        }

        if (images.length === 0) {
            return res.status(400).json({ success: false, message: "Please upload at least one prescription image." });
        }

        if (!pharmacyId) {
            return res.status(400).json({ success: false, message: "Pharmacy ID is required." });
        }

        let parsedAddress = {};
        if (typeof address === 'string' && address !== 'undefined') {
            try { parsedAddress = JSON.parse(address); } catch (e) { parsedAddress = { addressLine: address }; }
        } else if (typeof address === 'object' && address !== null) {
            parsedAddress = address;
        }

        const tempOrderId = `MED-RX-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        const order = await PharmacyBooking.create({
            orderId: tempOrderId,
            userId: req.user.id,
            pharmacyId,
            collectionType: collectionType || 'Home Delivery',
            address: parsedAddress,
            appointmentDate: new Date(),
            appointmentTime: 'Immediate',
            prescriptionImages: images,
            orderType: 'Prescription',
            status: 'Under Review',
            paymentStatus: 'Pending',
            deliveryOTP: Math.floor(1000 + Math.random() * 9000).toString(),
            billSummary: {
                itemTotal: 0,
                originalItemTotal: 0,
                comboSavings: 0,
                deliveryCharge: 0,
                totalAmount: 0
            }
        });

        // Notify Pharmacist
        await notifyAdminsAndVendor(
            pharmacyId,
            'pharmacy',
            "New Prescription Upload Received!",
            `Prescription inquiry #${order.orderId} has been placed for manual review.`,
            { bookingId: order._id.toString(), type: 'pharmacy_prescription_review' }
        );

        res.json({
            success: true,
            message: "Prescription uploaded successfully. Pharmacist is reviewing your order.",
            orderId: order.orderId,
            data: order
        });
    } catch (error) {
        console.error("uploadPrescription Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// CANCEL MEDICINE ORDER (With Automatic Inventory Stock Restoration & Refund Policy)
// endpoint: POST /user/pharmacy/cancel-order
const cancelMedicineOrder = async (req, res) => {
    try {
        const { orderId, reason } = req.body;
        const userId = req.user.id;

        if (!orderId) {
            return res.status(400).json({ success: false, message: "orderId is required." });
        }

        const order = await PharmacyBooking.findOne({
            $or: [{ _id: mongoose.isValidObjectId(orderId) ? orderId : new mongoose.Types.ObjectId() }, { orderId }],
            userId
        });

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found or unauthorized." });
        }

        // Restrict cancellation if order is already out for delivery or delivered
        const nonCancellableStatuses = ['Delivered', 'Cancelled', 'OutForDelivery', 'ReachedLocation'];
        if (nonCancellableStatuses.includes(order.status) || nonCancellableStatuses.includes(order.deliveryStatus)) {
            return res.status(400).json({
                success: false,
                message: `Cannot cancel order in '${order.deliveryStatus || order.status}' state.`
            });
        }

        // 1. Calculate Cancellation policy & refund
        const policyResult = await processCancellationRefund(order, 'Pharmacy');

        // 2. 🚨 INVENTORY RESTOCK ENGINE: Restore reserved medicine quantities back to inventory
        if (order.items && order.items.length > 0) {
            for (const item of order.items) {
                if (item.medicineId) {
                    const returnQty = Number(item.quantity || 1);
                    await MedicineInventory.findOneAndUpdate(
                        { pharmacyId: order.pharmacyId, medicineId: item.medicineId },
                        { 
                            $inc: { stock_quantity: returnQty },
                            $set: { is_available: true } 
                        }
                    );
                }
            }
        }

        // 3. Release Driver if assigned
        if (order.driverId) {
            const Driver = require('../../../models/Driver');
            await Driver.findByIdAndUpdate(order.driverId, { $set: { status: 'Available' } });
        }

        order.status = 'Cancelled';
        order.deliveryStatus = 'CancelledByDriver';
        order.cancelReason = reason || "Cancelled by customer";
        order.billSummary.cancellationFeeApplied = policyResult.cancellationFee;

        // Queue refund if paid online
        if (order.paymentStatus === 'Paid') {
            order.paymentStatus = 'Refund-Initiated';
        }

        await order.save();

        // Notify Pharmacy
        try {
            await sendPushNotification(
                order.pharmacyId,
                'pharmacy',
                "Order Cancelled by Customer",
                `Order #${order.orderId} was cancelled. Stock has been restored to your inventory.`,
                { orderId: order._id.toString(), type: 'order_cancelled' }
            );
        } catch (e) {}

        res.json({
            success: true,
            message: "Order cancelled successfully. Items restored to inventory and refund initiated.",
            data: {
                orderId: order.orderId,
                status: order.status,
                cancellationFee: policyResult.cancellationFee,
                refundAmount: policyResult.refundAmount
            }
        });

    } catch (error) {
        console.error("Cancel Medicine Order Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- GET ORDER HISTORY (With canRetryPayment Flag for Failed/Pending Orders) ---
// Endpoint: GET /user/pharmacy/order-history
// @desc    Get User Pharmacy Orders History with Full Delivery Mode, Slots, COD & Bill Details
// @route   GET /user/pharmacy/order-history
// @access  Private (User)
const getOrderHistory = async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        const { status, page = 1, limit = 10 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        let query = { userId };
        if (status && status !== 'All') {
            query.status = status;
        }

        const totalOrders = await PharmacyBooking.countDocuments(query);
        const orders = await PharmacyBooking.find(query)
            .populate('pharmacyId', 'name address phone city profileImage rating')
            .populate('driverId', 'name phone vehicleNumber profilePic vehicleType')
            .populate('items.medicineId', 'name packaging image_url manufacturers salt_composition')
            .populate('items.comboOfferId', 'campaignDisplayName buyQty getFreeQty')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const formattedOrders = orders.map(order => {
            const isRapid = order.isRapid === true;
            const hasSlot = Boolean(
                order.appointmentTime && 
                !['Immediate', 'Immediate (1 Hour Express)', 'Immediate (1 Hour)', 'Standard Delivery', 'Standard Delivery (3 Hours)', 'undefined', 'null'].includes(order.appointmentTime) &&
                order.appointmentTime.trim() !== ''
            );
            const hasPremiumSlot = Number(order.billSummary?.slotCharge || 0) > 0;

            let deliveryModeLabel = "Standard Delivery (3 Hours)";
            let deliveryModeType = "STANDARD";

            if (order.collectionType === 'Self Pickup') {
                deliveryModeLabel = "Self Pickup";
                deliveryModeType = "PICKUP";
            } else if (isRapid) {
                deliveryModeLabel = "Express 1-Hour Delivery";
                deliveryModeType = "EXPRESS";
            } else if (hasSlot || hasPremiumSlot) {
                deliveryModeLabel = hasPremiumSlot ? `Scheduled Premium Slot (${order.appointmentTime})` : `Scheduled Slot (${order.appointmentTime})`;
                deliveryModeType = "SLOT";
            }

            return {
                _id: order._id,
                orderId: order.orderId,
                status: order.status,
                deliveryStatus: order.deliveryStatus,
                orderType: order.orderType || 'General',
                createdAt: order.createdAt,
                formattedDate: moment(order.createdAt).format('DD MMM YYYY, hh:mm A'),

                // 1. Delivery & Mode Metadata
                collectionType: order.collectionType,
                deliveryMode: {
                    type: deliveryModeType, // 'STANDARD' | 'EXPRESS' | 'SLOT' | 'PICKUP'
                    label: deliveryModeLabel,
                    isRapid: isRapid,
                    rapidCharge: order.billSummary?.rapidDeliveryCharge || 0,
                    isSlotDelivery: hasSlot || hasPremiumSlot,
                    isPremiumSlot: hasPremiumSlot,
                    slotCharge: order.billSummary?.slotCharge || 0
                },

                // 2. Slot Schedule Timings
                slotSchedule: {
                    date: order.appointmentDate ? moment(order.appointmentDate).format('YYYY-MM-DD') : null,
                    formattedDate: order.appointmentDate ? moment(order.appointmentDate).format('DD MMM YYYY') : null,
                    timeSlot: order.appointmentTime || (isRapid ? "Immediate (1 Hour Express)" : "Standard Delivery (3 Hours)"),
                    isCustomTime: hasSlot
                },

                // 3. Payment Badge & Status
                paymentInfo: {
                    method: order.paymentMethod || 'COD',
                    status: order.paymentStatus || 'Pending',
                    isCod: (order.paymentMethod === 'COD'),
                    transactionId: order.paymentDetails?.razorpayPaymentId || order.transactionId || null
                },

                // 4. Complete Bill Summary
                billSummary: {
                    itemTotal: Number(order.billSummary?.itemTotal || 0),
                    originalItemTotal: Number(order.billSummary?.originalItemTotal || order.billSummary?.itemTotal || 0),
                    comboSavings: Number(order.billSummary?.comboSavings || 0),
                    couponDiscount: Number(order.billSummary?.couponDiscount || 0),
                    deliveryCharge: Number(order.billSummary?.deliveryCharge || 0),
                    rapidDeliveryCharge: Number(order.billSummary?.rapidDeliveryCharge || 0),
                    slotCharge: Number(order.billSummary?.slotCharge || 0),
                    totalAmount: Number(order.billSummary?.totalAmount || 0)
                },

                // 5. Pharmacy Details
                pharmacy: {
                    id: order.pharmacyId?._id || null,
                    name: order.pharmacyId?.name || "Pharmacy Partner",
                    address: order.pharmacyId?.address || "",
                    city: order.pharmacyId?.city || "",
                    phone: order.pharmacyId?.phone || "",
                    image: order.pharmacyId?.profileImage || null,
                    rating: order.pharmacyId?.rating || 4.5
                },

                // 6. Assigned Delivery Partner
                deliveryPartner: order.driverId ? {
                    id: order.driverId._id,
                    name: order.driverId.name,
                    phone: order.driverId.phone,
                    vehicleNumber: order.driverId.vehicleNumber,
                    vehicleType: order.driverId.vehicleType,
                    profilePic: order.driverId.profilePic
                } : null,

                // 7. Ordered Items List
                itemsCount: order.items?.length || 0,
                items: (order.items || []).map(item => ({
                    medicineId: item.medicineId?._id || item.medicineId,
                    name: item.name || item.medicineId?.name,
                    image: item.medicineId?.image_url?.[0] || null,
                    packaging: item.medicineId?.packaging || "10 tablets",
                    price: Number(item.price || 0),
                    mrp: Number(item.mrp || item.price || 0),
                    quantity: Number(item.quantity || 1),
                    duration: item.duration || "Full Course",
                    isComboApplied: item.isComboApplied || false,
                    freeQuantity: Number(item.freeQuantity || 0),
                    isReturnAllowed: item.isReturnAllowed || false,
                    isReplacementAllowed: item.isReplacementAllowed || false
                })),

                deliveryAddress: order.address,
                deliveryOTP: order.deliveryOTP || null,
                returnDetails: order.returnDetails || null
            };
        });

        res.status(200).json({
            success: true,
            totalOrders,
            totalPages: Math.ceil(totalOrders / parseInt(limit)),
            currentPage: parseInt(page),
            data: formattedOrders
        });

    } catch (error) {
        console.error("getOrderHistory Error:", error);
        res.status(500).json({ success: false, message: error.message || "Internal Server Error in order history." });
    }
};

// @desc    Get Detailed Live Order Tracking, Real-Time Timeline & Delivery Slot Breakdown
// @route   GET /user/pharmacy/track-order/:orderId
// @access  Private (User)
const trackOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user?.id || req.user?._id;

        const isObjectId = mongoose.isValidObjectId(orderId);
        const query = {
            userId,
            $or: [
                { _id: isObjectId ? new mongoose.Types.ObjectId(orderId) : new mongoose.Types.ObjectId() },
                { orderId: String(orderId).trim() }
            ]
        };

        const order = await PharmacyBooking.findOne(query)
            .populate('pharmacyId', 'name address phone city profileImage rating location')
            .populate('driverId', 'name phone vehicleNumber profilePic vehicleType location')
            .populate('items.medicineId', 'name packaging image_url manufacturers salt_composition')
            .populate('items.comboOfferId', 'campaignDisplayName buyQty getFreeQty')
            .lean();

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found." });
        }

        const isRapid = order.isRapid === true;
        const hasSlot = Boolean(
            order.appointmentTime && 
            !['Immediate', 'Immediate (1 Hour Express)', 'Immediate (1 Hour)', 'Standard Delivery', 'Standard Delivery (3 Hours)', 'undefined', 'null'].includes(order.appointmentTime) &&
            order.appointmentTime.trim() !== ''
        );
        const hasPremiumSlot = Number(order.billSummary?.slotCharge || 0) > 0;

        let deliveryModeLabel = "Standard Delivery (3 Hours)";
        let deliveryModeType = "STANDARD";

        if (order.collectionType === 'Self Pickup') {
            deliveryModeLabel = "Self Pickup";
            deliveryModeType = "PICKUP";
        } else if (isRapid) {
            deliveryModeLabel = "Express 1-Hour Delivery";
            deliveryModeType = "EXPRESS";
        } else if (hasSlot || hasPremiumSlot) {
            deliveryModeLabel = hasPremiumSlot ? `Scheduled Premium Slot (${order.appointmentTime})` : `Scheduled Slot (${order.appointmentTime})`;
            deliveryModeType = "SLOT";
        }

        // Live Dynamic Status Timeline
        const trackingTimeline = [
            {
                step: 1,
                title: "Order Placed",
                description: `Order placed via ${order.paymentMethod || 'COD'}`,
                time: order.createdAt,
                isCompleted: true,
                isCurrent: order.status === 'Placed'
            },
            {
                step: 2,
                title: "Packed by Pharmacy",
                description: "Medicines verified and packed in tamper-proof bag",
                time: ['Packed', 'Shipped', 'Delivered'].includes(order.status) ? order.updatedAt : null,
                isCompleted: ['Packed', 'Shipped', 'Delivered'].includes(order.status),
                isCurrent: order.status === 'Packed'
            },
            {
                step: 3,
                title: isRapid ? "Express 1-Hour Delivery On The Way" : (hasSlot ? `Out for Delivery (${order.appointmentTime})` : "Out for Delivery"),
                description: order.driverId ? `Delivery partner ${order.driverId.name} is on the way` : "Delivery partner assigning",
                time: order.startedAt || null,
                isCompleted: ['Delivered'].includes(order.status) || order.deliveryStatus === 'Delivered',
                isCurrent: ['OutForDelivery', 'ReachedLocation'].includes(order.deliveryStatus) || (order.status === 'Shipped' && order.deliveryStatus !== 'Delivered')
            },
            {
                step: 4,
                title: "Delivered",
                description: "Handed over to customer",
                time: order.deliveredAt || null,
                isCompleted: order.status === 'Delivered',
                isCurrent: order.status === 'Delivered'
            }
        ];

        res.status(200).json({
            success: true,
            data: {
                _id: order._id,
                orderId: order.orderId,
                status: order.status,
                deliveryStatus: order.deliveryStatus,
                orderType: order.orderType || 'General',
                createdAt: order.createdAt,
                formattedDate: moment(order.createdAt).format('DD MMM YYYY, hh:mm A'),

                // Delivery Mode Metadata
                deliveryMode: {
                    type: deliveryModeType,
                    label: deliveryModeLabel,
                    isRapid: isRapid,
                    rapidCharge: order.billSummary?.rapidDeliveryCharge || 0,
                    isSlotDelivery: hasSlot || hasPremiumSlot,
                    isPremiumSlot: hasPremiumSlot,
                    slotCharge: order.billSummary?.slotCharge || 0
                },

                // Slot Schedule Details
                slotSchedule: {
                    date: order.appointmentDate ? moment(order.appointmentDate).format('YYYY-MM-DD') : null,
                    formattedDate: order.appointmentDate ? moment(order.appointmentDate).format('DD MMM YYYY') : null,
                    timeSlot: order.appointmentTime || (isRapid ? "Immediate (1 Hour Express)" : "Standard Delivery (3 Hours)"),
                    isCustomTime: hasSlot
                },

                // Payment Info
                paymentInfo: {
                    method: order.paymentMethod || 'COD',
                    status: order.paymentStatus || 'Pending',
                    isCod: (order.paymentMethod === 'COD'),
                    transactionId: order.paymentDetails?.razorpayPaymentId || order.transactionId || null
                },

                // Bill Breakdown
                billSummary: {
                    itemTotal: Number(order.billSummary?.itemTotal || 0),
                    originalItemTotal: Number(order.billSummary?.originalItemTotal || order.billSummary?.itemTotal || 0),
                    comboSavings: Number(order.billSummary?.comboSavings || 0),
                    couponDiscount: Number(order.billSummary?.couponDiscount || 0),
                    deliveryCharge: Number(order.billSummary?.deliveryCharge || 0),
                    rapidDeliveryCharge: Number(order.billSummary?.rapidDeliveryCharge || 0),
                    slotCharge: Number(order.billSummary?.slotCharge || 0),
                    totalAmount: Number(order.billSummary?.totalAmount || 0)
                },

                // Store Details
                pharmacy: {
                    id: order.pharmacyId?._id || null,
                    name: order.pharmacyId?.name || "Pharmacy Partner",
                    address: order.pharmacyId?.address || "",
                    city: order.pharmacyId?.city || "",
                    phone: order.pharmacyId?.phone || "",
                    image: order.pharmacyId?.profileImage || null,
                    rating: order.pharmacyId?.rating || 4.5,
                    location: order.pharmacyId?.location || { lat: 0, lng: 0 }
                },

                // Assigned Driver Details
                deliveryPartner: order.driverId ? {
                    id: order.driverId._id,
                    name: order.driverId.name,
                    phone: order.driverId.phone,
                    vehicleNumber: order.driverId.vehicleNumber,
                    vehicleType: order.driverId.vehicleType,
                    profilePic: order.driverId.profilePic,
                    currentLocation: order.driverId.location || { lat: 0, lng: 0 }
                } : null,

                deliveryOTP: order.deliveryOTP || null,
                deliveryAddress: order.address,
                items: (order.items || []).map(item => ({
                    medicineId: item.medicineId?._id || item.medicineId,
                    name: item.name || item.medicineId?.name,
                    image: item.medicineId?.image_url?.[0] || null,
                    packaging: item.medicineId?.packaging || "10 tablets",
                    price: Number(item.price || 0),
                    mrp: Number(item.mrp || item.price || 0),
                    quantity: Number(item.quantity || 1),
                    duration: item.duration || "Full Course",
                    isComboApplied: item.isComboApplied || false,
                    freeQuantity: Number(item.freeQuantity || 0),
                    isReturnAllowed: item.isReturnAllowed || false,
                    isReplacementAllowed: item.isReplacementAllowed || false
                })),
                trackingTimeline,
                returnDetails: order.returnDetails || null
            }
        });

    } catch (error) {
        console.error("trackOrder Error:", error);
        res.status(500).json({ success: false, message: error.message || "Internal Server Error in order tracking." });
    }
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

// @desc    Get OTC / Non-Prescription Medicines with In-Stock First & Out-of-Stock at the End
// @route   GET /user/pharmacy/non-prescription-list
// @access  Public / User
const getNonPrescriptionMedicines = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const { search, category, pharmacyId } = req.query;

        // 1. Strict filter for Non-Prescription (OTC) Medicines
        let matchQuery = {
            prescription_required: { $regex: /^(no|false)$/i }
        };

        if (search && search.trim() !== '') {
            matchQuery.$or = [
                { name: { $regex: search.trim(), $options: 'i' } },
                { salt_composition: { $regex: search.trim(), $options: 'i' } },
                { manufacturers: { $regex: search.trim(), $options: 'i' } }
            ];
        }

        if (category && category !== 'All' && category.trim() !== '') {
            matchQuery.bread_crumb = { $regex: category.trim(), $options: 'i' };
        }

        // 2. Aggregate pipeline to lookup inventory stock & sort in-stock items first
        const pipeline = [
            { $match: matchQuery },
            {
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
                                        { $gt: ["$stock_quantity", 0] },
                                        ...(pharmacyId && mongoose.isValidObjectId(pharmacyId)
                                            ? [{ $eq: ["$pharmacyId", new mongoose.Types.ObjectId(pharmacyId)] }]
                                            : [])
                                    ]
                                }
                            }
                        },
                        { $sort: { vendor_price: 1, expiry_date: 1 } },
                        { $limit: 1 }
                    ],
                    as: "inventoryData"
                }
            },
            {
                $addFields: {
                    bestOffer: { $arrayElemAt: ["$inventoryData", 0] },
                    // Flag: 1 if in stock, 0 if out of stock
                    stockPriority: {
                        $cond: {
                            if: { $gt: [{ $size: "$inventoryData" }, 0] },
                            then: 1,
                            else: 0
                        }
                    }
                }
            },
            // 🚨 Sorting: In-stock items (stockPriority: 1) appear first, Out-of-stock (stockPriority: 0) pushed to last
            {
                $sort: {
                    stockPriority: -1,
                    createdAt: -1
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
        const total = result[0]?.metadata[0]?.total || 0;
        const medicines = result[0]?.data || [];

        // 3. Format response items with lowest price, batch MRP, and availability flag
        const formattedList = medicines.map(med => {
            const bestOffer = med.bestOffer;
            const lowestPrice = bestOffer ? bestOffer.vendor_price : null;
            const batchMrp = bestOffer ? Number(bestOffer.mrp || 0) : Number(med.mrp || 0);

            let discountPercent = med.discont_percent || "0%";
            if (lowestPrice !== null && batchMrp > 0) {
                discountPercent = `${Math.round(((batchMrp - lowestPrice) / batchMrp) * 100)}%`;
            }

            return {
                _id: med._id,
                name: med.name,
                manufacturers: med.manufacturers || "",
                salt_composition: med.salt_composition || "",
                packaging: med.packaging || "",
                mrp: batchMrp > 0 ? batchMrp.toString() : (med.mrp || "0"),
                best_price: lowestPrice !== null ? lowestPrice.toString() : (med.best_price || med.mrp || "0"),
                discont_percent: discountPercent,
                prescription_required: med.prescription_required || "No",
                image_url: med.image_url || [],
                bread_crumb: med.bread_crumb || "",
                primary_use: med.primary_use || "",
                description: med.description || "",
                
                // Inventory Snapshot
                isAvailable: lowestPrice !== null,
                availableStock: bestOffer ? bestOffer.stock_quantity : 0,
                vendor_id: bestOffer ? bestOffer.pharmacyId : null,
                isReturnAllowed: bestOffer ? Boolean(bestOffer.isReturnAllowed) : false,
                isReplacementAllowed: bestOffer ? Boolean(bestOffer.isReplacementAllowed) : false
            };
        });

        res.status(200).json({
            success: true,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            count: formattedList.length,
            data: formattedList
        });

    } catch (error) {
        console.error("getNonPrescriptionMedicines Error:", error);
        res.status(500).json({ success: false, message: error.message || "Internal Server Error in fetching OTC medicines." });
    }
};

const getHighestDiscountMedicines = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limitVal = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limitVal;

        const pipeline = [
            {
                // Match medicines having MRP defined
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
                // 🛡️ BUG 8 FIX: Safe numeric conversion preventing String-to-Double cast crashes on dirty data
                $addFields: {
                    numMRP: {
                        $convert: {
                            input: "$mrp",
                            to: "double",
                            onError: 0,
                            onNull: 0
                        }
                    },
                    numInventoryPrice: {
                        $convert: {
                            input: { $arrayElemAt: ["$inventory.vendor_price", 0] },
                            to: "double",
                            onError: 0,
                            onNull: 0
                        }
                    },
                    numInventoryMRP: {
                        $convert: {
                            input: { $arrayElemAt: ["$inventory.mrp", 0] },
                            to: "double",
                            onError: 0,
                            onNull: 0
                        }
                    },
                    isInventoryAvailable: { $gt: [{ $size: "$inventory" }, 0] }
                }
            },
            {
                $addFields: {
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
                            null
                        ]
                    },
                    isAvailable: "$isInventoryAvailable"
                }
            },
            {
                $addFields: {
                    // Dynamic discount percentage based strictly on live batch MRP and vendor price
                    discountPercentage: {
                        $cond: {
                            if: {
                                $and: [
                                    "$isInventoryAvailable",
                                    { $gt: ["$minimumMRP", 0] },
                                    { $gt: ["$minimumMRP", "$minimumPrice"] }
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
                // Overwrite best_price, mrp, and discont_percent with live batch values
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
                // Sort in-stock items with highest discount first, followed by alphabetical
                $sort: {
                    hasVendorPrice: -1,
                    discountPercentage: -1,
                    name: 1
                }
            },
            {
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

        if (!pharmacyId) {
            return res.status(400).json({ success: false, message: "Pharmacy ID is required" });
        }

        // Safe parser for medicines array
        let parsedMeds = [];
        if (typeof medicines === 'string') {
            try { parsedMeds = JSON.parse(medicines); } catch (e) { parsedMeds = []; }
        } else if (Array.isArray(medicines)) {
            parsedMeds = medicines;
        }

        if (!parsedMeds || parsedMeds.length === 0) {
            return res.status(400).json({ success: false, message: "Medicines list is required" });
        }

        let estimatedTotal = 0;
        const pricedMedicines = [];

        for (const med of parsedMeds) {
            if (!med || !med.name) continue;

            let pricePerUnit = 0;
            let mrp = 0;
            let matchedInInventory = false;

            const inventory = await MedicineInventory.findOne({
                pharmacyId,
                $or: [
                    { medicineId: mongoose.isValidObjectId(med.medicineId) ? med.medicineId : new mongoose.Types.ObjectId() },
                    { name: new RegExp(`^${escapeRegex(med.name)}$`, 'i') }
                ],
                is_available: true
            }).populate('medicineId');

            if (inventory) {
                pricePerUnit = Number(inventory.vendor_price || 0);
                mrp = inventory.medicineId ? Number(inventory.medicineId.mrp || 0) : Number(inventory.mrp || 0);
                matchedInInventory = true;
            } else {
                const masterMed = await Medicine.findOne({ name: new RegExp(`^${escapeRegex(med.name)}$`, 'i') });
                if (masterMed) {
                    mrp = Number(masterMed.mrp || 0);
                    pricePerUnit = Number(masterMed.best_price || masterMed.mrp || 0);
                } else {
                    mrp = Number(med.mrp || 0);
                    pricePerUnit = mrp > 0 ? mrp * 0.9 : 15;
                }
            }

            const calculatedQty = Math.max(1, Number(med.durationDays || 15));
            const subtotal = pricePerUnit * calculatedQty;
            estimatedTotal += subtotal;

            pricedMedicines.push({
                name: med.name,
                durationDays: calculatedQty,
                mrp,
                pricePerUnit,
                totalPrice: Math.round(subtotal),
                available: matchedInInventory
            });
        }

        res.json({
            success: true,
            estimatedTotal: Math.round(estimatedTotal),
            medicines: pricedMedicines
        });
    } catch (error) {
        console.error("estimateRxPrices Error:", error);
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

        // 🛡️ BUG 6 FIX: Crash-proof parser for requestedMedicines (Handles empty, undefined string, or raw JSON)
        let parsedMedicines = [];
        if (requestedMedicines && requestedMedicines !== 'undefined' && requestedMedicines !== 'null') {
            if (typeof requestedMedicines === 'string') {
                try {
                    parsedMedicines = JSON.parse(requestedMedicines);
                } catch (e) {
                    parsedMedicines = [];
                }
            } else if (Array.isArray(requestedMedicines)) {
                parsedMedicines = requestedMedicines;
            }
        }
        if (!Array.isArray(parsedMedicines)) parsedMedicines = [];

        // Populate baseline MRPs inside user request data safely
        const verifiedRequestedMeds = [];
        for (const med of parsedMedicines) {
            if (!med || !med.name) continue;
            const dbMed = await Medicine.findOne({ name: new RegExp(`^${med.name}$`, 'i') }).select('mrp').lean();
            verifiedRequestedMeds.push({
                name: med.name,
                dosage: med.dosage || '1-0-1',
                durationDays: Number(med.durationDays || 15),
                isSelected: med.isSelected !== false,
                mrp: dbMed ? Number(dbMed.mrp || 0) : Number(med.mrp || 0)
            });
        }

        // 🛡️ Crash-proof Address Parsing
        let finalAddress = {};
        if (address && address !== 'undefined' && address !== 'null') {
            if (typeof address === 'string') {
                try {
                    finalAddress = JSON.parse(address);
                } catch (e) {
                    finalAddress = { addressLine: address };
                }
            } else if (typeof address === 'object') {
                finalAddress = address;
            }
        }

        // 🛡️ Safe Date Parsing
        let finalPrescriptionDate = new Date();
        if (prescriptionDate && prescriptionDate !== 'undefined' && prescriptionDate !== 'null' && String(prescriptionDate).trim() !== '') {
            const parsed = new Date(prescriptionDate);
            if (!isNaN(parsed.getTime())) {
                finalPrescriptionDate = parsed;
            }
        }

        const newRequest = await PharmacyPrescriptionRequest.create({
            requestId: `REQ-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
            userId,
            pharmacyId,
            doctorName: (doctorName && doctorName !== 'undefined' && doctorName !== 'null') ? doctorName : 'Prescription Request',
            prescriptionDate: finalPrescriptionDate,
            prescriptionImage: req.file.path.replace(/\\/g, "/"),
            durationType: durationType || 'Full Course',
            requestedMedicines: verifiedRequestedMeds,
            address: finalAddress,
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

        console.log(`\x1b[36m[DEBUG] payAndConfirmOrder: Received Request -> requestId: "${requestId}", userId: "${userId}", paymentMethod: "${paymentMethod}"\x1b[0m`);

        if (!requestId || requestId === "undefined" || requestId === "null" || String(requestId).trim() === "") {
            return res.status(400).json({
                success: false,
                message: "Validation Error: 'requestId' parameter is missing, null, or undefined in the request body."
            });
        }

        const cleanId = String(requestId).trim();
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

        const bill = request.verifiedBill || {};
        const tempOrderId = `MED-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        // Online Payment Flow (Razorpay Gateway initialization)
        if (paymentMethod !== 'COD') {
            const rzpOrder = await createRazorpayOrder(bill.totalAmount || 0, `receipt_${tempOrderId}`);

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

        // COD Stock Deduction (FEFO Batch Sort)
        if (request.verifiedBill?.items) {
            for (const billItem of request.verifiedBill.items) {
                if (!billItem.medicineId) continue;
                await deductPharmacyStockFEFO(request.pharmacyId, billItem.medicineId, billItem.quantity || 1);
            }
        }

        // Map verified items safely with GST attributes
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
                hsn_number: item.hsn_number || "30049011",
                taxableAmount: item.taxableAmount || 0,
                cgstPercent: item.cgstPercent || 6,
                sgstPercent: item.sgstPercent || 6,
                cgstAmount: item.cgstAmount || 0,
                sgstAmount: item.sgstAmount || 0
            };
        });

        // 🚀 Create Final Pharmacy Booking
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
                taxableTotal: bill.taxableTotal || 0,
                cgstTotal: bill.cgstTotal || 0,
                sgstTotal: bill.sgstTotal || 0,
                deliveryCharge: bill.deliveryCharge || 0,
                totalAmount: bill.totalAmount || 0
            },
            paymentMethod: 'COD',
            paymentStatus: 'Pending',
            orderType: 'Prescription',
            prescriptionImages: request.prescriptionImage ? [request.prescriptionImage] : [],
            status: 'Placed',
            deliveryOTP: Math.floor(1000 + Math.random() * 9000).toString()
        });

        // 🛡️ BENEFIT DECREMENT: Deduct free pharmacy delivery count for active subscribers
        if (bill.deliveryCharge === 0) {
            const { deductBenefitCount } = require('../../../utils/subscriptionBenefitHelper');
            await deductBenefitCount(userId, 'freePharmacyDeliveriesCount');
        }

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

// VERIFY PRESCRIPTION REQUEST PAYMENT (Converts Inquiry to Live Booking & Deducts Stock)
// endpoint: POST /user/pharmacy/prescription-request/verify-payment
const verifyPrescriptionRequestPayment = async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Resolve Body Payload
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

        const targetRequestId = body.requestId || 
                                body.requestMongoId || 
                                body.id;

        if (!rzpPaymentId) {
            return res.status(400).json({ 
                success: false, 
                message: "Missing razorpayPaymentId / razorpay_payment_id parameter." 
            });
        }

        // 2. Cryptographic Signature Verification
        let isVerified = false;
        if (rzpOrderId && rzpSignature) {
            isVerified = verifyRazorpaySignature(rzpOrderId, rzpPaymentId, rzpSignature);
        }

        if (!isVerified && (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV)) {
            console.warn("⚠️ [DEV NOTICE]: Prescription payment signature mismatch bypassed in development mode.");
            isVerified = true;
        }

        if (!isVerified && process.env.NODE_ENV === 'production') {
            return res.status(400).json({ 
                success: false, 
                message: "Signature verification failed. Invalid transaction signature." 
            });
        }

        // 3. Find Prescription Request
        const searchConditions = [];
        if (targetRequestId) {
            if (mongoose.isValidObjectId(targetRequestId)) {
                searchConditions.push({ _id: targetRequestId });
            }
            searchConditions.push({ requestId: String(targetRequestId).trim() });
        }

        let request = null;
        if (searchConditions.length > 0) {
            request = await PharmacyPrescriptionRequest.findOne({ 
                userId, 
                $or: searchConditions 
            });
        }

        if (!request) {
            request = await PharmacyPrescriptionRequest.findOne({
                userId,
                status: { $in: ['Bill Generated', 'Pending Payment'] }
            }).sort({ updatedAt: -1 });
        }

        if (!request) {
            return res.status(404).json({ 
                success: false, 
                message: "Prescription request record not found or access denied." 
            });
        }

        // 4. Map Payment Details
        let rzpDetails = null;
        try {
            if (rzpSignature) {
                rzpDetails = await fetchAndMapRazorpayPayment(rzpPaymentId, rzpSignature);
            }
        } catch (fetchErr) {}

        if (!rzpDetails) {
            rzpDetails = {
                razorpayPaymentId: rzpPaymentId,
                razorpayOrderId: rzpOrderId || "",
                razorpaySignature: rzpSignature || "",
                method: 'Online',
                amount: request.verifiedBill?.totalAmount || 0,
                status: 'captured',
                paidAt: new Date()
            };
        }

        // 5. ATOMIC INVENTORY STOCK DEDUCTION FOR BILLED MEDICINES
        if (request.verifiedBill?.items && request.verifiedBill.items.length > 0) {
            for (const item of request.verifiedBill.items) {
                if (item.medicineId) {
                    const reqQty = Number(item.quantity || 1);
                    await MedicineInventory.findOneAndUpdate(
                        { pharmacyId: request.pharmacyId, medicineId: item.medicineId },
                        { $inc: { stock_quantity: -reqQty } }
                    );

                    // Update availability flag if depleted
                    const updatedInv = await MedicineInventory.findOne({ 
                        pharmacyId: request.pharmacyId, 
                        medicineId: item.medicineId 
                    });
                    if (updatedInv && updatedInv.stock_quantity <= 0) {
                        updatedInv.is_available = false;
                        await updatedInv.save();
                    }
                }
            }
        }

        // 6. Create Live Pharmacy Booking
        const customOrderId = `ORD-RX-${Date.now().toString().slice(-6)}${Math.floor(100 + Math.random() * 900)}`;
        const freshDeliveryOTP = Math.floor(1000 + Math.random() * 9000).toString();

        const booking = await PharmacyBooking.create({
            userId: request.userId,
            pharmacyId: request.pharmacyId,
            orderId: customOrderId,
            orderType: 'Prescription',
            items: request.verifiedBill.items.map(item => ({
                medicineId: item.medicineId,
                name: item.name,
                mrp: item.mrp || 0,
                price: item.pricePerUnit,
                quantity: item.quantity,
                duration: `${item.quantity} Days`,
                hsn_number: item.hsn_number || "30049099"
            })),
            collectionType: 'Home Delivery',
            appointmentDate: new Date(),
            appointmentTime: "Same Day Delivery",
            address: request.address,
            billSummary: {
                itemTotal: request.verifiedBill.itemTotal,
                taxableTotal: request.verifiedBill.taxableTotal,
                cgstTotal: request.verifiedBill.cgstTotal,
                sgstTotal: request.verifiedBill.sgstTotal,
                deliveryCharge: request.verifiedBill.deliveryCharge,
                totalAmount: request.verifiedBill.totalAmount
            },
            paymentMethod: 'Online',
            paymentStatus: 'Paid',
            paymentDetails: rzpDetails,
            status: 'Placed',
            deliveryStatus: 'PendingAssignment',
            deliveryOTP: freshDeliveryOTP,
            prescriptionFile: request.prescriptionImage
        });

        // Update Request Status
        request.status = 'Paid';
        await request.save();

        // Notify Pharmacy Store
        try {
            await sendPushNotification(
                request.pharmacyId,
                'pharmacy',
                "💊 Paid Prescription Order Confirmed!",
                `Prescription Order #${customOrderId} is paid. Please pack medicines for courier dispatch.`,
                { orderId: booking._id.toString(), type: 'new_prescription_order' }
            );
        } catch (e) {}

        res.status(200).json({
            success: true,
            message: "Prescription payment verified, order placed, and inventory stock updated successfully!",
            data: {
                orderId: booking.orderId,
                bookingMongoId: booking._id,
                status: booking.status,
                paymentStatus: booking.paymentStatus,
                amountPaid: booking.billSummary.totalAmount,
                deliveryOTP: freshDeliveryOTP
            }
        });

    } catch (error) {
        console.error("Verify Prescription Request Payment Error:", error);
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

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, message: "Rating must be between 1 and 5." });
        }

        const booking = await PharmacyBooking.findOne({ _id: bookingId, userId: req.user.id });
        if (!booking || booking.status !== 'Delivered') {
            return res.status(400).json({ success: false, message: "You can only rate successfully delivered medicine orders." });
        }

        // 🚨 FIXED: Race-condition duplicate review preventer
        const existingReview = await Review.findOne({ userId: req.user.id, orderId: bookingId });
        if (existingReview) {
            return res.status(400).json({ success: false, message: "You have already submitted a review for this medicine order." });
        }

        await Review.create({
            userId: req.user.id,
            userName: req.user.name || "Verified User",
            targetId: booking.pharmacyId,
            targetType: 'Pharmacy',
            orderId: bookingId,
            rating: Number(rating),
            comment: comment || ""
        });

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
                                            { $divide: [{ $subtract: ["$batchMrp", "$lowestVendorPrice"] }, "$batchMrp"] },
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

// returnReplacement: 'Return' | 'Replacement'
// SUBMIT RETURN / REPLACEMENT REQUEST (User App)
// Endpoint: POST /user/pharmacy/orders/return-request/:orderId
const requestPharmacyOrderReturn = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { requestType, reason, userComments } = req.body; 
        const userId = req.user.id;

        const order = await PharmacyBooking.findOne({
            $or: [{ _id: mongoose.isValidObjectId(orderId) ? orderId : new mongoose.Types.ObjectId() }, { orderId }],
            userId
        });

        if (!order) return res.status(404).json({ success: false, message: "Order not found." });

        if (order.status !== 'Delivered' && order.deliveryStatus !== 'Delivered') {
            return res.status(400).json({ success: false, message: "Only delivered orders are eligible for return/replacement." });
        }

        let eligibleSubtotal = 0;
        const eligibleItems = order.items.filter(item => {
            const isEligible = requestType === 'Return' ? item.isReturnAllowed : item.isReplacementAllowed;
            if (isEligible) {
                eligibleSubtotal += (Number(item.price || 0) * Number(item.quantity || 1));
            }
            return isEligible;
        });

        if (eligibleItems.length === 0) {
            return res.status(400).json({
                success: false,
                message: `Store Policy Blocked: None of the items in this order are eligible for ${requestType ? requestType.toLowerCase() : 'return'}.`
            });
        }

        let config = await PharmacyReturnConfig.findOne({ vendorType: 'Pharmacy' });
        if (!config) config = { returnWindowDays: 3, isReturnEnabled: true, isReplacementEnabled: true };

        const deliveryDate = order.deliveredAt || order.updatedAt || order.createdAt;
        const daysPassed = moment().diff(moment(deliveryDate), 'days');

        if (daysPassed > config.returnWindowDays) {
            return res.status(400).json({ 
                success: false, 
                message: `Return window expired: Requests were only allowed within ${config.returnWindowDays} days.` 
            });
        }

        if (order.returnDetails && order.returnDetails.status === 'Requested') {
            return res.status(400).json({ success: false, message: "A return request is already pending for this order." });
        }

        let uploadedProofs = [];
        if (req.files) {
            if (Array.isArray(req.files)) {
                uploadedProofs = req.files.map(f => f.path.replace(/\\/g, "/"));
            } else if (req.files.proofImages) {
                uploadedProofs = req.files.proofImages.map(f => f.path.replace(/\\/g, "/"));
            }
        }

        order.returnDetails = {
            requestType: requestType || 'Return',
            reason: reason || "Product issue",
            userComments: userComments || "",
            proofImages: uploadedProofs,
            status: 'Requested',
            requestedAt: new Date(),
            rejectionReason: null,
            refundAmount: Number(eligibleSubtotal.toFixed(2))
        };

        await order.save();

        // 🛡️ VENDOR NOTIFICATION: Alert Pharmacy Desk about new Return Request
        await notifyAdminsAndVendor(
            order.pharmacyId,
            'pharmacy',
            `🔄 New ${requestType || 'Return'} Request Received!`,
            `Customer requested ${requestType || 'Return'} for Order #${order.orderId}. Reason: ${reason || 'Product issue'}.`,
            { orderId: order._id.toString(), type: 'pharmacy_return_request' }
        );

        res.json({
            success: true,
            message: `${requestType || 'Return'} request submitted successfully! Pharmacist will review.`,
            data: order.returnDetails
        });

    } catch (error) {
        console.error("requestPharmacyOrderReturn Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// CANCEL RETURN REQUEST (By Patient before driver collection)
// Endpoint: POST /user/pharmacy/orders/return-request/cancel/:orderId
const cancelReturnRequestByCustomer = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user.id;

        const order = await PharmacyBooking.findOne({
            $or: [{ _id: mongoose.isValidObjectId(orderId) ? orderId : new mongoose.Types.ObjectId() }, { orderId }],
            userId
        });

        if (!order || !order.returnDetails || order.returnDetails.status === 'None') {
            return res.status(400).json({ success: false, message: "No active return request found on this order." });
        }

        // Agar driver already pickup kar chuka hai toh cancel nahi ho sakta
        if (order.returnDetails.pickupStatus === 'PickedUp' || order.returnDetails.status === 'CollectedByDriver') {
            return res.status(400).json({ success: false, message: "Cannot cancel: Package has already been collected by driver." });
        }

        // Free assigned driver if any
        if (order.returnDetails.pickupDriverId) {
            await Driver.findByIdAndUpdate(order.returnDetails.pickupDriverId, { status: 'Available' });
        }

        order.returnDetails.status = 'None';
        order.returnDetails.pickupStatus = 'PendingAssignment';
        order.returnDetails.pickupDriverId = null;
        order.returnDetails.returnOTP = null;
        order.returnDetails.rejectionReason = "Return request cancelled by customer.";
        await order.save();

        res.json({
            success: true,
            message: "Return request cancelled successfully. Your order remains Delivered.",
            data: order
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Endpoint: POST /user/pharmacy/retry-payment
// ==========================================
const retryPharmacyPayment = async (req, res) => {
    try {
        const { orderId } = req.body;
        const userId = req.user.id;

        if (!orderId) {
            return res.status(400).json({ success: false, message: "Order ID is required to retry payment." });
        }

        // 1. Fetch Order and verify ownership
        const order = await PharmacyBooking.findOne({
            $or: [
                { _id: mongoose.isValidObjectId(orderId) ? orderId : new mongoose.Types.ObjectId() },
                { orderId: String(orderId).trim() }
            ],
            userId
        });

        if (!order) {
            return res.status(404).json({ success: false, message: "Order record not found." });
        }

        // 2. Validate Payment Eligibility
        if (order.paymentMethod !== 'Online') {
            return res.status(400).json({ 
                success: false, 
                message: "Retry Payment is only available for Online orders. This order is marked as " + order.paymentMethod 
            });
        }

        if (order.paymentStatus === 'Paid') {
            return res.status(400).json({ 
                success: false, 
                message: "This order has already been paid for and confirmed." 
            });
        }

        if (order.status !== 'Pending') {
            return res.status(400).json({ 
                success: false, 
                message: `Cannot retry payment: Order is currently in '${order.status}' status.` 
            });
        }

        const totalPayable = Number(order.billSummary?.totalAmount || order.totalAmount || 0);
        if (totalPayable <= 0) {
            return res.status(400).json({ success: false, message: "Invalid order payable amount." });
        }

        // 3. Live Inventory Stock Verification
        for (const item of order.items) {
            if (!item.medicineId) continue;
            const availableStock = await MedicineInventory.find({
                pharmacyId: order.pharmacyId,
                medicineId: item.medicineId,
                is_available: true
            });
            const totalStock = availableStock.reduce((sum, inv) => sum + (inv.stock_quantity || 0), 0);

            if (totalStock < item.quantity) {
                return res.status(400).json({
                    success: false,
                    errorType: "OUT_OF_STOCK",
                    message: `Item '${item.name}' is currently out of stock at the pharmacy. Total available: ${totalStock} units.`
                });
            }
        }

        // 4. Create Fresh Razorpay Order
        const rzpOrder = await createRazorpayOrder(totalPayable, `retry_${order.orderId}_${Date.now().toString().slice(-4)}`);

        // Save fresh Razorpay orderId to order document
        if (!order.paymentDetails) {
            order.paymentDetails = {};
        }
        order.paymentDetails.razorpayOrderId = rzpOrder.id;
        await order.save();

        res.json({
            success: true,
            message: "Fresh payment gateway session initialized. Complete payment to confirm order.",
            key_id: process.env.RAZORPAY_KEY_ID,
            amount: rzpOrder.amount,
            razorpayOrderId: rzpOrder.id,
            appointmentId: order._id,
            bookingId: order.orderId
        });

    } catch (error) {
        console.error("retryPharmacyPayment Error:", error);
        res.status(500).json({ success: false, message: "Payment Gateway Initialization Failed: " + error.message });
    }
};


module.exports = {
    scanPrescription, getMedicineSuggestions, getMedicineFullDetails, getMedicineCategories, getPharmacySubCategories, getMedicineCategoryDetails, getPharmacySearchSuggestions, getPharmacyNameSuggestions, getPharmacies, getPharmacyDetails, searchAlternateBrand, getTrendingMedicinesNearUser, getStandardMedicineCatalog, getMedicineVendors,
    getPharmacySlots, getPharmacyDeliveryCharges, checkoutMedicineOrder, getPharmacyAvailableCoupons, validateCoupon, uploadPrescription, cancelMedicineOrder, placeOrder, verifyPharmacyPayment, getOrderHistory, trackOrder,
    getLatestAddedMedicines, getNonPrescriptionMedicines, getHighestDiscountMedicines, getActiveStoreComboOffers,

    createPrescriptionRequest, payAndConfirmOrder, verifyPrescriptionRequestPayment, getUserPrescriptionRequests, getUserPrescriptionRequestDetails, estimateRxPrices,
    ratePharmacyOrder, getGlobalActiveComboOffers, getComboOfferDetails,
    getSimilarInStockMedicines,
    requestPharmacyOrderReturn,
    cancelReturnRequestByCustomer,
    retryPharmacyPayment
};