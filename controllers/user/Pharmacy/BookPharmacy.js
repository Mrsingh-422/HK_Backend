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

const { generateTimeSlots } = require('../../../utils/timeSlotHelper');
const moment = require('moment');



// --- HELPER: Bill Calculation (Mirroring Lab logic) ---
const calculatePharmacyBill = async (pharmacyId, items, couponCode, isRapid) => {
    let itemTotal = 0;
    
    // items usually cart.pharmacyCart.items se aayenge
    for (let item of items) {
        const inventory = await MedicineInventory.findOne({ 
            pharmacyId, 
            medicineId: item.medicineId, 
            is_available: true 
        });
        if (inventory) {
            itemTotal += (inventory.vendor_price * item.quantity);
        }
    }

    let deliveryCharge = 0;
    let rapidCharge = 0;
    const charges = await DeliveryCharge.findOne({ vendorId: pharmacyId });

    if (charges) {
        deliveryCharge = charges.fixedPrice || 40; // Default 40
        if (isRapid) rapidCharge = charges.fastDeliveryExtra || 29; // Figma logic: +29
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

    const totalAmount = (itemTotal - couponDiscount) + deliveryCharge + rapidCharge;
    return { itemTotal, couponDiscount, couponId, deliveryCharge, rapidDeliveryCharge: rapidCharge, totalAmount };
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
                    // Agar sellers hain toh minimum price nikalega, warna MRP dikhayega
                    minPrice: {
                        $cond: {
                            if: { $gt: [{ $size: "$sellers" }, 0] },
                            then: { $min: "$sellers.vendor_price" },
                            else: "$mrp" 
                        }
                    }
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

const checkoutMedicineOrder = async (req, res) => {
    try {
        const { address, paymentMethod, couponCode, isRapid } = req.body;
        const userId = req.user.id;

        const cart = await Cart.findOne({ userId });
        if (!cart || cart.pharmacyCart.items.length === 0) {
            return res.status(400).json({ message: "Medicine cart is empty" });
        }

        const pharmacyId = cart.pharmacyCart.pharmacyId;
        const bill = await calculatePharmacyBill(pharmacyId, cart.pharmacyCart.items, couponCode, isRapid);

        const order = await PharmacyBooking.create({
            orderId: `MED-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
            userId,
            pharmacyId,
            items: cart.pharmacyCart.items,
            address,
            billSummary: bill,
            paymentMethod,
            isRapid,
            status: 'Placed'
        });

        // Clear Cart Pharmacy section only
        await Cart.findOneAndUpdate({ userId }, { $set: { "pharmacyCart.items": [], "pharmacyCart.pharmacyId": null } });

        res.status(201).json({ success: true, message: "Order placed successfully!", data: order });
    } catch (error) { res.status(500).json({ message: error.message }); }
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

module.exports = {getPharmacySearchSuggestions,getPharmacyNameSuggestions, getPharmacies, getPharmacyDetails, getStandardMedicineCatalog,
    checkoutMedicineOrder,validateCoupon,uploadPrescription,cancelMedicineOrder, placeOrder,getOrderHistory, trackOrder };