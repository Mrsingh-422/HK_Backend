const Cart = require('../../../models/Cart');
const LabTest = require('../../../models/LabTest');
const LabPackage = require('../../../models/LabPackage');


const VendorKMLimit = require('../../../models/VendorKMLimit');
const Lab = require('../../../models/Lab');
const { getDistance } = require('../../../utils/helpers');
const { generateTimeSlots } = require('../../../utils/timeSlotHelper');
const MedicineInventory = require('../../../models/MedicineInventory');
const Medicine = require('../../../models/Medicine');
const Availability = require('../../../models/Availability');
const DeliveryCharge = require('../../../models/DeliveryCharge');
const Coupon = require('../../../models/Coupon');


const calculateBill = async (vendorId, items, patientsCount, couponCode, isRapid, vendorType) => {
    let itemTotal = 0;
    
    if (vendorType === 'Pharmacy') {
        // Medicine Calculation
        items.forEach(item => { itemTotal += (item.price * item.quantity); });
    } else {
        // Lab Calculation (Tests + Packages)
        items.forEach(item => { itemTotal += (item.price * (patientsCount || 1)); });
    }

    let deliveryCharge = 0;
    let rapidCharge = 0;
    const charges = await DeliveryCharge.findOne({ vendorId });

    if (charges) {
        deliveryCharge = charges.fixedPrice || 40;
        if (isRapid) rapidCharge = (charges.fastDeliveryExtra || 29) * (patientsCount || 1);
    }

    let couponDiscount = 0;
    let couponId = null;
    if (couponCode) {
        const coupon = await Coupon.findOne({ couponName: couponCode.toUpperCase(), isActive: true });
        if (coupon && itemTotal >= coupon.minOrderAmount) {
            // Check if coupon belongs to this vendor or is Global (All)
            if (coupon.vendorId?.toString() === vendorId.toString() || coupon.vendorType === 'All') {
                couponDiscount = Math.min((itemTotal * coupon.discountPercentage) / 100, coupon.maxDiscount);
                couponId = coupon._id;
            }
        }
    }

    const totalAmount = (itemTotal - couponDiscount) + deliveryCharge + rapidCharge;
    return { itemTotal, couponDiscount, couponId, deliveryCharge, rapidDeliveryCharge: rapidCharge, totalAmount };
};

/////////////////////////////////////////////////////////////////////////////
////////////////////////////// LAB CART ///////////////////////////////////
/////////////////////////////////////////////////////////////////////////////

// 1. ADD TO LAB CART
// endpoint: /user/cart/lab/add
const addToLabCart = async (req, res) => {
    try {
        const { labId, itemId, productType, forceReplace } = req.body; 
        const userId = req.user.id;

        let itemData, newItemCategory;
        if (productType === 'LabTest') {
            itemData = await LabTest.findById(itemId);
            if (!itemData) return res.status(404).json({ success: false, message: "Lab Test not found" });
            newItemCategory = itemData.mainCategory || 'Pathology';
        } else {
            itemData = await LabPackage.findById(itemId);
            if (!itemData) return res.status(404).json({ success: false, message: "Lab Package not found" });
            newItemCategory = 'Package';
        }

        let cart = await Cart.findOne({ userId });
        if (!cart) cart = new Cart({ userId, labCart: { items: [] } });

        const hasItems = cart.labCart.items.length > 0;
        const isDifferentLab = hasItems && cart.labCart.labId && cart.labCart.labId.toString() !== labId;

        if (isDifferentLab && !forceReplace) {
            return res.status(400).json({ 
                success: false, 
                canReplace: true, 
                message: "Cart already has items from another lab. Replace them?"
            });
        }

        if (forceReplace) { cart.labCart.items = []; }

        cart.labCart.labId = labId;
        cart.labCart.categoryType = newItemCategory;

        const itemIndex = cart.labCart.items.findIndex(i => i.itemId.toString() === itemId);
        if (itemIndex > -1) {
            cart.labCart.items[itemIndex].quantity += 1;
        } else {
            cart.labCart.items.push({
                productType, itemId,
                name: productType === 'LabTest' ? itemData.testName : itemData.packageName,
                price: productType === 'LabTest' ? itemData.discountPrice : itemData.offerPrice,
                quantity: 1
            });
        }

        await cart.save();
        res.json({ success: true, message: "Cart Updated", data: cart });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. UPDATE QUANTITY (Inc/Dec)
const updateCartQuantity = async (req, res) => {
    try {
        const { itemId, action } = req.body; // action: 'inc' or 'dec'
        const cart = await Cart.findOne({ userId: req.user.id });
        
        const itemIndex = cart.labCart.items.findIndex(i => i.itemId.toString() === itemId);
        if (itemIndex > -1) {
            if (action === 'inc') cart.labCart.items[itemIndex].quantity += 1;
            else cart.labCart.items[itemIndex].quantity -= 1;

            // Remove item if quantity becomes 0
            if (cart.labCart.items[itemIndex].quantity <= 0) {
                cart.labCart.items.splice(itemIndex, 1);
            }
        }

        if (cart.labCart.items.length === 0) {
            cart.labCart.categoryType = null;
            cart.labCart.labId = null;
        }

        await cart.save();
        res.json({ success: true, data: cart });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. GET COMBINED CART (Lab + Pharmacy)
const getMyCart = async (req, res) => {
    try {
        const cart = await Cart.findOne({ userId: req.user.id })
            .populate('labCart.labId', 'name city address profileImage')
            .populate('pharmacyCart.pharmacyId', 'name address rating city')
            .populate('pharmacyCart.items.medicineId', 'image_url manufacturers name mrp prescription_required')

        if (!cart) {
            return res.json({ 
                success: true, 
                data: { 
                    labCart: { items: [] }, 
                    pharmacyCart: { items: [] },
                    labCartTotal: 0,
                    pharmacyCartTotal: 0,
                    totalItems: 0 // Default zero count
                } 
            });
        }

        // 1. Totals calculate karein (Price * Quantity)
        let labTotal = cart.labCart.items.reduce((acc, i) => acc + (i.price * i.quantity), 0);
        let medTotal = cart.pharmacyCart.items.reduce((acc, i) => acc + (i.price * i.quantity), 0);

        // 2. Total Items Count calculate karein (Sum of all quantities)
        let labItemCount = cart.labCart.items.reduce((acc, i) => acc + i.quantity, 0);
        let pharmacyItemCount = cart.pharmacyCart.items.reduce((acc, i) => acc + i.quantity, 0);
        
        let totalItems = labItemCount + pharmacyItemCount;

        res.json({ 
            success: true, 
            data: { 
                ...cart._doc, 
                labCartTotal: labTotal, 
                pharmacyCartTotal: medTotal,
                totalItems: totalItems // <-- Yeh rahi aapki nayi key
            } 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 3. REMOVE ITEM / CLEAR LAB CART
// endpoint: /user/cart/lab/clear
const clearLabCart = async (req, res) => {
    try {
        await Cart.findOneAndUpdate(
            { userId: req.user.id },
            { $set: { "labCart.items": [], "labCart.categoryType": null, "labCart.labId": null } }
        );
        res.json({ success: true, message: "Lab cart cleared" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. REMOVE ITEM
// endpoint: /user/cart/item/:itemId
const removeItem = async (req, res) => {
    try {
        const { itemId } = req.params;
        const cart = await Cart.findOne({ userId: req.user.id });
        
        cart.labCart.items = cart.labCart.items.filter(i => i.itemId.toString() !== itemId);
        
        // Reset category if cart becomes empty
        if (cart.labCart.items.length === 0) {
            cart.labCart.categoryType = null;
            cart.labCart.labId = null;
        }

        await cart.save();
        res.json({ success: true, message: "Item removed", data: cart });
    } catch (error) { res.status(500).json({ message: error.message }); }
}; 


// only for lab user cart
const compareCartOnMap = async (req, res) => {
    try {
        const { lat, lng } = req.body;
        const userId = req.user.id;

        // 1. User ki cart fetch karein
        const cart = await Cart.findOne({ userId });
        if (!cart || cart.labCart.items.length === 0) {
            return res.status(400).json({ success: false, message: "Cart is empty" });
        }

        const cartItems = cart.labCart.items;
        const totalRequestedCount = cartItems.length;

        // Optimization: Cart ke items ki Master IDs nikal lein taaki baar-baar DB call na ho
        const processedCartItems = await Promise.all(cartItems.map(async (item) => {
            if (item.productType === 'LabTest') {
                const data = await LabTest.findById(item.itemId).select('masterTestId');
                return { productType: 'LabTest', masterId: data?.masterTestId };
            } else {
                const data = await LabPackage.findById(item.itemId).select('masterPackageId');
                return { productType: 'LabPackage', masterId: data?.masterPackageId };
            }
        }));

        // 2. Radius limit check
        const limitConfig = await VendorKMLimit.findOne({ vendorType: 'Lab', isActive: true });
        const maxRadius = limitConfig ? limitConfig.kmLimit : 50;

        // 3. Approved Labs fetch karein
        const labs = await Lab.find({ profileStatus: 'Approved', isActive: true })
            .select('name location rating totalReviews profileImage city')
            .lean();

        const comparisonData = [];

        for (let lab of labs) {
            let distance = 0;
            if (lat && lng && lab.location?.lat) {
                distance = await getDistance(lat, lng, lab.location.lat, lab.location.lng);
            }

            // Radius Filter
            if (!lat || distance <= maxRadius) {
                let labTotalPrice = 0;
                let foundItems = []; // Isme found items ki details store hongi

                // 4. Har cart item ko is specific lab ki inventory mein dhoondo
                for (let item of processedCartItems) {
                    if (!item.masterId) continue;

                    let match = null;
                    if (item.productType === 'LabTest') {
                        match = await LabTest.findOne({ 
                            labId: lab._id, 
                            masterTestId: item.masterId, 
                            isActive: true 
                        }).select('testName discountPrice amount');
                    } else {
                        match = await LabPackage.findOne({ 
                            labId: lab._id, 
                            masterPackageId: item.masterId, 
                            isActive: true 
                        }).select('packageName offerPrice mrp');
                    }

                    if (match) {
                        const price = match.discountPrice || match.offerPrice || match.amount || match.mrp;
                        labTotalPrice += price;
                        
                        // Item details jo is lab mein mili hain
                        foundItems.push({
                            itemId: match._id,
                            name: match.testName || match.packageName,
                            type: item.productType,
                            price: price
                        });
                    }
                }

                // 5. Sirf wahi labs dikhao jahan kam se kam 1 item mil gaya ho
                if (foundItems.length > 0) {
                    comparisonData.push({
                        labId: lab._id,
                        labName: lab.name,
                        city: lab.city,
                        location: lab.location,
                        profileImage: lab.profileImage,
                        rating: lab.rating,
                        distance: distance.toFixed(2),
                        stats: {
                            totalRequested: totalRequestedCount,
                            totalFound: foundItems.length,
                            isFullMatch: foundItems.length === totalRequestedCount
                        },
                        totalPrice: labTotalPrice,
                        availableItems: foundItems // <-- Naya Logic: Found items ki list
                    });
                }
            }
        }

        // 6. Sort: Full Match pehle, phir Sasta pehle
        comparisonData.sort((a, b) => b.stats.totalFound - a.stats.totalFound || a.totalPrice - b.totalPrice);

        res.json({ 
            success: true, 
            data: comparisonData 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/////////////////////////////////////////////////////////////////////////
//////////////////// PHARMACY CART LOGIC ///////////////////////////////
/////////////////////////////////////////////////////////////////////////

// 1. ADD TO PHARMACY CART
// endpoint: /user/cart/pharmacy/add
const addToPharmacyCart = async (req, res) => {
    try {
        const { pharmacyId, medicineId, quantity = 1, duration = "Full Course", forceReplace } = req.body;
        const userId = req.user.id;

        const inventory = await MedicineInventory.findOne({ pharmacyId, medicineId, is_available: true });
        if (!inventory) return res.status(404).json({ success: false, message: "Out of stock in this pharmacy" });

        let cart = await Cart.findOne({ userId });
        if (!cart) cart = new Cart({ userId, pharmacyCart: { items: [] } });

        if (cart.pharmacyCart.items.length > 0 && cart.pharmacyCart.pharmacyId?.toString() !== pharmacyId && !forceReplace) {
            return res.status(400).json({ success: false, canReplace: true, message: "Clear existing pharmacy items?" });
        }

        if (forceReplace) cart.pharmacyCart.items = [];
        cart.pharmacyCart.pharmacyId = pharmacyId;

        const itemIndex = cart.pharmacyCart.items.findIndex(i => i.medicineId.toString() === medicineId);
        if (itemIndex > -1) {
            cart.pharmacyCart.items[itemIndex].quantity += Number(quantity);
            cart.pharmacyCart.items[itemIndex].duration = duration;
        } else {
            const medData = await Medicine.findById(medicineId);
            cart.pharmacyCart.items.push({
                medicineId,
                name: medData.name,
                price: inventory.vendor_price,
                quantity: Number(quantity),
                duration: duration // Figma: Full Course / Custom
            });
        }
        await cart.save();
        res.json({ success: true, message: "Added to cart", data: cart });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// 2. UPDATE PHARMACY QUANTITY
const updatePharmacyQuantity = async (req, res) => {
    try {
        const { medicineId, action } = req.body; // action: 'inc', 'dec'
        const cart = await Cart.findOne({ userId: req.user.id });
        
        const itemIndex = cart.pharmacyCart.items.findIndex(i => i.medicineId.toString() === medicineId);
        if (itemIndex > -1) {
            if (action === 'inc') cart.pharmacyCart.items[itemIndex].quantity += 1;
            else cart.pharmacyCart.items[itemIndex].quantity -= 1;

            if (cart.pharmacyCart.items[itemIndex].quantity <= 0) {
                cart.pharmacyCart.items.splice(itemIndex, 1);
            }
        }

        if (cart.pharmacyCart.items.length === 0) cart.pharmacyCart.pharmacyId = null;

        await cart.save();
        res.json({ success: true, data: cart });
    } catch (error) { res.status(500).json({ message: error.message }); }
};



const checkBetterOptions = async (req, res) => {
    const { medicineId, currentPrice } = req.body;
    
    const currentMed = await Medicine.findById(medicineId);
    
    // Check if any other medicine with same salt has lower vendor_price
    const cheaperOption = await MedicineInventory.find({ is_available: true })
        .populate({
            path: 'medicineId',
            match: { salt_composition: currentMed.salt_composition, _id: { $ne: medicineId } }
        })
        .sort({ vendor_price: 1 })
        .limit(1);

    if(cheaperOption[0] && cheaperOption[0].vendor_price < currentPrice) {
        res.json({ 
            betterOptionAvailable: true, 
            saveAmount: currentPrice - cheaperOption[0].vendor_price,
            product: cheaperOption[0] 
        });
    } else {
        res.json({ betterOptionAvailable: false });
    }
};








const getAvailableSlots = async (req, res) => {
    try {
        const { vendorId, date } = req.query; 
        const config = await Availability.findOne({ vendorId });
        if (!config) return res.status(404).json({ message: "Slots not configured" });

        const dayName = moment(date).format('dddd');
        if (config.offDays.includes(dayName)) return res.json({ success: true, isClosed: true, slots: [] });

        const allSlots = generateTimeSlots(config);
        // Add occupancy logic here if needed (similar to your lab logic)
        res.json({ success: true, slots: allSlots });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. COMMON COUPONS API
const getAvailableCoupons = async (req, res) => {
    try {
        const { vendorId, vendorType } = req.query; // vendorType: 'Lab' or 'Pharmacy'
        const today = new Date();

        const coupons = await Coupon.find({
            isActive: true,
            expiryDate: { $gte: today },
            $or: [
                { vendorId: vendorId },
                { isAdminCreated: true, vendorType: { $in: [vendorType, 'All'] } }
            ]
        });

        res.json({ success: true, data: coupons });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


module.exports = { addToLabCart,updateCartQuantity, getMyCart, clearLabCart, removeItem,
    compareCartOnMap,
    addToPharmacyCart, updatePharmacyQuantity , checkBetterOptions,
    getAvailableSlots, getAvailableCoupons
 };