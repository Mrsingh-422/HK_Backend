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

        // --- Fallback coordinates logic ---
        const filterLat = lat || DEFAULT_LAT;
        const filterLng = lng || DEFAULT_LNG;

        // Base Query
        let query = { profileStatus: 'Approved', isActive: true };

        // --- Strict Location Matching (Dropdown selection) ---
        if (city) query.city = new RegExp(`^${city}$`, 'i');
        if (state) query.state = new RegExp(`^${state}$`, 'i');
        if (country) query.country = new RegExp(`^${country}$`, 'i');

        // --- Global Name Search Logic ---
        if (search) {
            const searchRegex = new RegExp(search, 'i');
            if (city) {
                // Specific city ke andar search
                query.name = searchRegex;
            } else {
                // Poore database mein search
                query.$or = [
                    { name: searchRegex },
                    { city: searchRegex },
                    { state: searchRegex }
                ];
            }
        }

        // Fetch Pharmacies
        const pharmacies = await Pharmacy.find(query)
            .select('name profileImage city state country address location rating totalReviews isHomeDeliveryAvailable is24x7 documents.pharmacyImages')
            .lean();

        let finalPharmacies = [];
        
        // KM Limit Configuration
        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Pharmacy', isActive: true });
        const maxRadius = limitConfig ? limitConfig.kmLimit : 100;

        for (let pharma of pharmacies) {
            let distance = null;

            if (pharma.location?.lat) {
                distance = await getDistance(filterLat, filterLng, pharma.location.lat, pharma.location.lng);
            }

            // Logic: Agar user ne name search kiya hai ya city select ki hai (Broad Search), 
            // toh radius ignore karein. Warna nearest dikhayein.
            const isBroadSearch = !!(city || search);

            if (isBroadSearch || distance <= maxRadius) {
                finalPharmacies.push({
                    ...pharma,
                    distance: distance ? distance.toFixed(1) : "N/A",
                    openStatus: pharma.is24x7 ? "Open 24/7" : "Open Now" // Standard label
                });
            }
        }

        // Sorting: Nearest First
        finalPharmacies.sort((a, b) => {
            if (a.distance === "N/A") return 1;
            if (b.distance === "N/A") return -1;
            return parseFloat(a.distance) - parseFloat(b.distance);
        });

        res.json({ 
            success: true, 
            count: finalPharmacies.length, 
            locationApplied: (!lat || !lng) ? "Delhi (Default Base)" : "User GPS Base",
            isGlobalSearch: !!(city || search),
            data: finalPharmacies 
        });

    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
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



// 1. GET STANDARD LIST (Dawaiyan jinke sabse zyada vendors hain wo pehle)
// endpoint: GET /user/medicine/standard-list
const getStandardMedicineCatalog = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;

        const aggregate = await Medicine.aggregate([
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
                // Sirf zaroori data bhejna, sellers array ko remove karna
                $project: {
                    sellers: 0 // Isse sellers ki badi list remove ho jayegi
                }
            },
            { $sort: { vendorCount: -1, name: 1 } },
            { $skip: skip },
            { $limit: limit }
        ]);

        const total = await Medicine.countDocuments();

        res.json({
            success: true,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            data: aggregate
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 2. GET VENDORS FOR A SPECIFIC MEDICINE
// endpoint: GET /user/medicine/vendors/:medicineId?lat=28.6&lng=77.2
const getMedicineVendors = async (req, res) => {
    try {
        const { medicineId } = req.params;
        const { lat, lng } = req.query;

        // 1. Medicine ki basic details find karein
        const medicine = await Medicine.findById(medicineId).lean();
        if (!medicine) {
            return res.status(404).json({ success: false, message: "Medicine not found" });
        }

        // 2. Inventory se data nikalna (For Vendor List and Summary)
        const inventoryRecords = await MedicineInventory.find({
            medicineId: medicineId,
            stock_quantity: { $gt: 0 },
            is_available: true
        })
        .populate({
            path: 'pharmacyId', 
            select: 'name profileImage rating totalReviews address location city isHomeDeliveryAvailable is24x7 profileStatus isActive'
        })
        .lean();

        // 3. Distance & Radius Logic
        const userLat = parseFloat(lat) || DEFAULT_LAT;
        const userLng = parseFloat(lng) || DEFAULT_LNG;
        
        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Pharmacy', isActive: true });
        const maxRadius = limitConfig ? limitConfig.kmLimit : 100;

        let formattedVendors = [];
        let minPrice = null;

        for (let record of inventoryRecords) {
            const pharmacy = record.pharmacyId;
            
            // Pharmacy validation
            if (!pharmacy || pharmacy.profileStatus !== 'Approved' || pharmacy.isActive === false) continue;

            // Track Min Price (Standard list logic ki tarah)
            if (minPrice === null || record.vendor_price < minPrice) {
                minPrice = record.vendor_price;
            }

            let distance = null;
            if (pharmacy.location?.lat && pharmacy.location?.lng) {
                distance = await getDistance(userLat, userLng, pharmacy.location.lat, pharmacy.location.lng);
            }

            // Radius filter
            if (distance === null || distance <= maxRadius) {
                formattedVendors.push({
                    pharmacyId: pharmacy._id,
                    pharmacyName: pharmacy.name,
                    profileImage: pharmacy.profileImage,
                    rating: pharmacy.rating,
                    totalReviews: pharmacy.totalReviews,
                    address: pharmacy.address,
                    city: pharmacy.city,
                    distance: distance ? distance.toFixed(1) : "N/A",
                    price: record.vendor_price,
                    mrp: medicine.mrp,
                    discount: medicine.mrp > record.vendor_price ? 
                        Math.round(((medicine.mrp - record.vendor_price) / medicine.mrp) * 100) : 0,
                    stock: record.stock_quantity,
                    isHomeDelivery: pharmacy.isHomeDeliveryAvailable,
                    isOpen: pharmacy.is24x7 ? "Open 24/7" : "Open Now"
                });
            }
        }

        // Sorting: Cheapest vendor first
        formattedVendors.sort((a, b) => a.price - b.price);

        // 4. Combine Response: Exact same as Standard List structure
        res.json({
            success: true,
            medicineData: {
                ...medicine,           // Saare purane fields (bread_crumb, salt, etc.)
                vendorCount: inventoryRecords.length,
                minPrice: minPrice     // Lowest price among sellers
            },
            totalVendors: formattedVendors.length,
            vendors: formattedVendors
        });

    } catch (error) {
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
const checkoutMedicineOrder = async (req, res) => {
    try {
        const { 
            appointmentDate, appointmentTime, address, 
            paymentMethod, couponCode, isRapid, collectionType 
        } = req.body;

        const userId = req.user.id;
        
        const cart = await Cart.findOne({ userId }).populate('pharmacyCart.items.medicineId');

        if (!cart || !cart.pharmacyCart || cart.pharmacyCart.items.length === 0) {
            return res.status(400).json({ success: false, message: "Cart is empty" });
        }

        // FIXED: Added toUpperCase() to match your Database Reference "YES"
        const rxMandatory = cart.pharmacyCart.items.some(item => 
            item.medicineId && 
            item.medicineId.prescription_required && 
            item.medicineId.prescription_required.toUpperCase() === "YES"
        );

        let rxImages = [];
        
        if (rxMandatory) {
            // Check if files exist in req.files
            if (!req.files || !req.files['prescriptionImages'] || req.files['prescriptionImages'].length === 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: "One or more medicines in your cart require a valid prescription. Please upload it." 
                });
            }
            rxImages = req.files['prescriptionImages'].map(f => f.path);
        }

        const bill = await calculatePharmacyBillHelper(
            cart.pharmacyCart.pharmacyId, 
            cart.pharmacyCart.items, 
            1, collectionType, couponCode, isRapid, appointmentTime
        );

        const order = await PharmacyBooking.create({
            orderId: `MED-${require('crypto').randomBytes(3).toString('hex').toUpperCase()}`,
            userId,
            pharmacyId: cart.pharmacyCart.pharmacyId,
            items: cart.pharmacyCart.items,
            collectionType, 
            address: typeof address === 'string' ? JSON.parse(address) : address, 
            appointmentDate, 
            appointmentTime,
            billSummary: bill,
            paymentMethod: paymentMethod || 'COD',
            isRapid: isRapid || false,
            orderType: rxMandatory ? 'Prescription' : 'General',
            prescriptionImages: rxImages,
            status: rxMandatory ? 'Under Review' : 'Placed', 
            deliveryStatus: 'PendingAssignment'
        });

        await Cart.findOneAndUpdate({ userId }, { $set: { "pharmacyCart.items": [], "pharmacyCart.pharmacyId": null } });

        res.status(201).json({ 
            success: true, 
            message: rxMandatory ? "Order placed! Pharmacist will verify your prescription." : "Order placed successfully!", 
            data: order 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
const placeOrder = async (req, res) => {
    try {
        const cart = await Cart.findOne({ userId: req.user.id });
        if (!cart || cart.pharmacyCart.items.length === 0) return res.status(400).json({ message: "Cart is empty" });

        const orderId = `ORD-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        
        const order = await PharmacyBooking.create({
            userId: req.user.id,
            pharmacyId: cart.pharmacyCart.pharmacyId,
            items: cart.pharmacyCart.items,
            billSummary: req.body.billSummary,
            deliveryAddress: req.body.deliveryAddress,
            orderId
        });

        // Clear Cart
        cart.pharmacyCart = { items: [], pharmacyId: null };
        await cart.save();

        res.status(201).json({ success: true, message: "Order Placed", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
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
        const userId = req.user.id;
        
        // Saari bookings nikalna jo is user ki hain
        // Pharmacy ki details populate kar rahe hain taaki name aur image dikh sake
        const orders = await PharmacyBooking.find({ userId })
            .populate('pharmacyId', 'name profileImage city')
            .sort({ createdAt: -1 }); // Newest orders first

        res.json({
            success: true,
            count: orders.length,
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

module.exports = {scanPrescription,getPharmacySearchSuggestions,getPharmacyNameSuggestions, getPharmacies, getPharmacyDetails, getStandardMedicineCatalog,getMedicineVendors,
   getPharmacySlots,getPharmacyDeliveryCharges, checkoutMedicineOrder,validateCoupon,uploadPrescription,cancelMedicineOrder, placeOrder,getOrderHistory, trackOrder };