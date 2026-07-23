const Cart = require('../../../models/Cart');
const LabTest = require('../../../models/LabTest');
const LabPackage = require('../../../models/LabPackage');
const moment = require('moment');


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

// ==========================================
// 🚨 NEW PRIVATE HELPER: Recalculate Lab Cart Category dynamically on mutations [1]
// ==========================================
const recalculateLabCartCategory = async (cart) => {
    if (!cart || !cart.labCart || cart.labCart.items.length === 0) {
        cart.labCart.categoryType = null;
        cart.labCart.labId = null;
        return;
    }

    let hasRadiology = false;

    // Scan all remaining items inside the cart [1]
    for (let item of cart.labCart.items) {
        if (item.productType === 'LabTest') {
            const test = await LabTest.findById(item.itemId);
            if (test && test.mainCategory && test.mainCategory.toLowerCase() === 'radiology') {
                hasRadiology = true;
                break;
            }
        } else if (item.productType === 'LabPackage') {
            const pkg = await LabPackage.findById(item.itemId).populate({
                path: 'tests',
                model: 'MasterLabTest',
                select: 'mainCategory'
            });
            if (pkg) {
                const packageHasRadiology = pkg.tests && pkg.tests.some(t => t.mainCategory && t.mainCategory.toLowerCase() === 'radiology');
                if (packageHasRadiology || (pkg.mainCategory && pkg.mainCategory.toLowerCase() === 'radiology')) {
                    hasRadiology = true;
                    break;
                }
            }
        }
    }

    // Set final cart category dynamically [1]
    cart.labCart.categoryType = hasRadiology ? 'Radiology' : 'General';
};

// 1. ADD TO LAB CART
// endpoint: /user/cart/lab/add
const addToLabCart = async (req, res) => {
    try {
        // 🚨 UPDATED: Capturing 'confirmRadiologyBypass' from request body [1]
        const { labId, itemId, productType, forceReplace, confirmRadiologyBypass = false } = req.body; 
        const userId = req.user.id;

        // Fetch Item Data and Determine Category
        let itemData, newItemCategory;
        if (productType === 'LabTest') {
            itemData = await LabTest.findById(itemId);
            if (!itemData) return res.status(404).json({ success: false, message: "Lab Test not found" });
            newItemCategory = itemData.mainCategory; 
        } else {
            itemData = await LabPackage.findById(itemId).populate({
                path: 'tests',
                model: 'MasterLabTest',
                select: 'mainCategory'
            });
            if (!itemData) return res.status(404).json({ success: false, message: "Lab Package not found" });
            
            const hasRadiology = itemData.tests && itemData.tests.some(t => t.mainCategory && t.mainCategory.toLowerCase() === 'radiology');
            newItemCategory = hasRadiology ? 'Radiology' : 'General';
        }

        let cart = await Cart.findOne({ userId });
        if (!cart) cart = new Cart({ userId, labCart: { items: [] } });

        const hasItems = cart.labCart.items.length > 0;
        const existingCategory = cart.labCart.categoryType; 
        const existingLabId = cart.labCart.labId;
        const existingProductType = hasItems ? cart.labCart.items[0].productType : null;

        const isDifferentLab = hasItems && existingLabId && existingLabId.toString() !== labId;
        const isDifferentType = hasItems && existingProductType && existingProductType !== productType;

        if ((isDifferentLab || isDifferentType) && !forceReplace) {
            let message = "";
            if (isDifferentLab) {
                message = "Your cart has items from another lab. Replace them?";
            } else if (isDifferentType) {
                const existingLabel = existingProductType === 'LabTest' ? 'Tests' : 'Packages';
                const incomingLabel = productType === 'LabTest' ? 'Test' : 'Package';
                message = `Your cart already contains Lab ${existingLabel}. You cannot add a ${incomingLabel} to this order. Replace cart?`;
            }

            return res.status(400).json({ 
                success: false, 
                canReplace: true, 
                message: message
            });
        }

        // 🚨 2. PRE-ADD RADIOLOGY WARNING POPUP TRIGGER [1]
        // If the incoming test is Radiology and user hasn't confirmed the bypass, throw warning [1]
        const isIncomingRadiology = newItemCategory && newItemCategory.toLowerCase() === 'radiology';
        
        if (isIncomingRadiology && !confirmRadiologyBypass && !forceReplace) {
            return res.status(400).json({
                success: false,
                canReplace: false,
                confirmRadiologyBypass: true, // 👈 Frontend checks this key to pop up the warning [1]
                message: "Warning: This is a Radiology scan. If you add this item to your cart, the 'Home Collection' option will be disabled for this entire order. Do you want to proceed?"
            });
        }

        if (forceReplace) { 
            cart.labCart.items = []; 
        }

        cart.labCart.labId = labId;

        // Add or Update Item in memory array
        const itemIndex = cart.labCart.items.findIndex(i => i.itemId.toString() === itemId);
        if (itemIndex > -1) {
            cart.labCart.items[itemIndex].quantity += 1;
        } else {
            cart.labCart.items.push({
                productType, 
                itemId,
                name: productType === 'LabTest' ? itemData.testName : itemData.packageName,
                price: productType === 'LabTest' ? itemData.discountPrice : itemData.offerPrice,
                quantity: 1
            });
        }

        // 🚨 Dynamic category recalculator check [1]
        await recalculateLabCartCategory(cart);

        await cart.save();
        res.json({ success: true, message: "Cart Updated successfully!", data: cart });

    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};


// 2. UPDATE QUANTITY (Inc/Dec)
const updateCartQuantity = async (req, res) => {
    try {
        const { itemId, action } = req.body;
        const cart = await Cart.findOne({ userId: req.user.id });
        
        const itemIndex = cart.labCart.items.findIndex(i => i.itemId.toString() === itemId);
        if (itemIndex > -1) {
            if (action === 'inc') cart.labCart.items[itemIndex].quantity += 1;
            else cart.labCart.items[itemIndex].quantity -= 1;

            if (cart.labCart.items[itemIndex].quantity <= 0) {
                cart.labCart.items.splice(itemIndex, 1);
            }
        }

        if (cart.labCart.items.length === 0) {
            cart.labCart.categoryType = null;
            cart.labCart.labId = null;
        }

        // 🚨 ADD ONLY THIS ONE LINE (Aapka purana baki saara logic same hai) [cite: custom_context]
        await recalculateLabCartCategory(cart); 

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
                    totalItems: 0 
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

        // 🚨 3. DYNAMIC PREPARATION GUIDE INJECTOR [1]
        // Loop through all lab cart items to fetch their clinical precautions on-the-fly [1]
        const mappedLabItems = await Promise.all(cart.labCart.items.map(async (item) => {
            let precaution = "No special preparation required."; // Default fallback instruction [1]

            if (item.productType === 'LabTest') {
                const test = await LabTest.findById(item.itemId).select('precaution');
                if (test && test.precaution) precaution = test.precaution;
            } else if (item.productType === 'LabPackage') {
                const pkg = await LabPackage.findById(item.itemId).select('precaution');
                if (pkg && pkg.precaution) precaution = pkg.precaution;
            }

            return {
                ...item.toObject(), // Convert mongoose document to raw Javascript object
                preparationGuide: precaution // 👈 Dynamic key injected for frontend UI rendering [1]
            };
        }));

        // 4. Construct response ensuring NO OTHER KEY is modified [1]
        res.json({ 
            success: true, 
            data: { 
                ...cart._doc, 
                labCart: {
                    ...cart.labCart.toObject(),
                    items: mappedLabItems // 👈 Replaced with dynamic mapped array [1]
                },
                labCartTotal: labTotal, 
                pharmacyCartTotal: medTotal,
                totalItems: totalItems 
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
        
        if (cart.labCart.items.length === 0) {
            cart.labCart.categoryType = null;
            cart.labCart.labId = null;
        }

        // 🚨 ADD ONLY THIS ONE LINE (Aapka purana baki saara logic same hai) [cite: custom_context]
        await recalculateLabCartCategory(cart); 

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
        // 🚨 UPDATED: Destructured BOGO indicators from request body [1]
        const { 
            pharmacyId, 
            medicineId, 
            quantity = 1, 
            duration = "Full Course", 
            forceReplace,
            isComboApplied = false, // 👈 Capture combo status [1]
            comboOfferId = null     // 👈 Capture campaign ID [1]
        } = req.body;
        
        const userId = req.user.id;

        const inventory = await MedicineInventory.findOne({ pharmacyId, medicineId, is_available: true });
        if (!inventory) return res.status(404).json({ success: false, message: "Out of stock in this pharmacy" });

        let cart = await Cart.findOne({ userId });
        if (!cart) cart = new Cart({ userId, pharmacyCart: { items: [] } });

        // "Replace Cart" logic for Pharmacy mismatch
        if (cart.pharmacyCart.items.length > 0 && cart.pharmacyCart.pharmacyId?.toString() !== pharmacyId && !forceReplace) {
            return res.status(400).json({ 
                success: false, 
                canReplace: true, 
                message: "Your cart has medicines from another pharmacy. Clear and add this instead?" 
            });
        }

        if (forceReplace) {
            cart.pharmacyCart.items = [];
        }
        
        cart.pharmacyCart.pharmacyId = pharmacyId;

        // 🚨 FIXED: findIndex now strictly checks BOTH medicineId AND isComboApplied status
        // This stops normal & BOGO items of the same medicine from clashing/merging [1]
        const itemIndex = cart.pharmacyCart.items.findIndex(i => 
            i.medicineId.toString() === medicineId && 
            i.isComboApplied === (isComboApplied === true)
        );

        if (itemIndex > -1) {
            cart.pharmacyCart.items[itemIndex].quantity += Number(quantity);
            cart.pharmacyCart.items[itemIndex].duration = duration;
        } else {
            const medData = await Medicine.findById(medicineId);
            // 🚨 UPDATED: Save BOGO indicators directly inside cart items subdocument [1]
            cart.pharmacyCart.items.push({
                medicineId,
                name: medData.name,
                price: inventory.vendor_price,
                quantity: Number(quantity),
                duration: duration,
                isComboApplied: isComboApplied === true,
                comboOfferId: comboOfferId || null
            });
        }
        await cart.save();
        res.json({ success: true, message: "Added to pharmacy cart successfully!", data: cart });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 2. UPDATE PHARMACY QUANTITY (Strict BOGO Match)
const updatePharmacyQuantity = async (req, res) => {
    try {
        const { medicineId, action, isComboApplied = false } = req.body; // action: 'inc', 'dec'
        const userId = req.user.id;

        // 1. Fetch cart directly using index-covered findOne
        const cart = await Cart.findOne({ userId });
        if (!cart) return res.status(404).json({ success: false, message: "Cart not found." });
        
        // Find targeted item in memory array safely
        const itemIndex = cart.pharmacyCart.items.findIndex(i => 
            i.medicineId.toString() === medicineId && 
            i.isComboApplied === (isComboApplied === true)
        );

        if (itemIndex > -1) {
            if (action === 'inc') {
                cart.pharmacyCart.items[itemIndex].quantity += 1;
            } else {
                cart.pharmacyCart.items[itemIndex].quantity -= 1;
            }

            // Remove item dynamically if quantity becomes 0 or less
            if (cart.pharmacyCart.items[itemIndex].quantity <= 0) {
                cart.pharmacyCart.items.splice(itemIndex, 1);
            }
        } else {
            return res.status(404).json({ success: false, message: "Item not found in cart." });
        }

        if (cart.pharmacyCart.items.length === 0) {
            cart.pharmacyCart.pharmacyId = null;
        }

        // Save mutations securely
        await cart.save();

        // 🚨 OPTIMIZATION: Deep populate identically to 'getMyCart' in a single database round-trip
        // This eliminates the need for the frontend to make a second fetch request!
        const populatedCart = await Cart.findById(cart._id)
            .populate('labCart.labId', 'name city address profileImage')
            .populate('pharmacyCart.pharmacyId', 'name address rating city')
            .populate('pharmacyCart.items.medicineId', 'image_url manufacturers name mrp prescription_required');

        // Calculate checkout totals on-the-fly inside the same response
        let labTotal = populatedCart.labCart.items.reduce((acc, i) => acc + (i.price * i.quantity), 0);
        let medTotal = populatedCart.pharmacyCart.items.reduce((acc, i) => acc + (i.price * i.quantity), 0);

        let labItemCount = populatedCart.labCart.items.reduce((acc, i) => acc + i.quantity, 0);
        let pharmacyItemCount = populatedCart.pharmacyCart.items.reduce((acc, i) => acc + i.quantity, 0);
        let totalItems = labItemCount + pharmacyItemCount;

        // Send fully populated structure back to the frontend instantly
        res.json({ 
            success: true, 
            message: "Quantity updated and synchronized.",
            data: { 
                ...populatedCart._doc, 
                labCartTotal: labTotal, 
                pharmacyCartTotal: medTotal,
                totalItems: totalItems 
            } 
        });

    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};


// 1. CLEAR FULL PHARMACY CART
// endpoint: POST /user/cart/pharmacy/clear
const clearPharmacyCart = async (req, res) => {
    try {
        await Cart.findOneAndUpdate(
            { userId: req.user.id },
            { $set: { "pharmacyCart.items": [], "pharmacyCart.pharmacyId": null } }
        );
        res.json({ success: true, message: "Pharmacy cart cleared successfully" });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. REMOVE SPECIFIC MEDICINE FROM CART
// endpoint: DELETE /user/cart/pharmacy/item/:itemId
const removePharmacyItem = async (req, res) => {
    try {
        const { medicineId } = req.params;
        const cart = await Cart.findOne({ userId: req.user.id });
        
        if (!cart || !cart.pharmacyCart) {
            return res.status(404).json({ message: "Cart not found" });
        }

        // Filter out the medicine
        cart.pharmacyCart.items = cart.pharmacyCart.items.filter(
            item => item.medicineId.toString() !== medicineId
        );

        // Agar cart khali ho gayi hai toh pharmacyId null kar dein
        if (cart.pharmacyCart.items.length === 0) {
            cart.pharmacyCart.pharmacyId = null;
        }

        await cart.save();
        res.json({ success: true, message: "Medicine removed", data: cart });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
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

// PUT /user/cart/pharmacy/update-duration
const updateMedicineDuration = async (req, res) => {
    try {
        const { type, customData } = req.body; 
        // type: 'Full Course' or 'Custom'
        // customData: [{ medicineId: "...", days: 5 }] (Sirf Custom ke liye)

        const userId = req.user.id;
        let cart = await Cart.findOne({ userId });

        if (!cart || cart.pharmacyCart.items.length === 0) {
            return res.status(400).json({ success: false, message: "Cart is empty" });
        }

        if (type === 'Full Course') {
            // Case 1: Sabhi items ko Full Course mark kar do
            cart.pharmacyCart.items.forEach(item => {
                item.duration = "Full Course";
                // Quantity unchanged rakhein ya default strip quantity set karein
            });
        } else if (type === 'Custom' && customData) {
            // Case 2: Har medicine ke liye alag-alag days set karein
            customData.forEach(data => {
                const itemIndex = cart.pharmacyCart.items.findIndex(
                    i => i.medicineId.toString() === data.medicineId
                );
                
                if (itemIndex > -1) {
                    cart.pharmacyCart.items[itemIndex].duration = `${data.days} Days`;
                    // Business Logic: Jitne din, utni quantity (assuming 1 tab/day)
                    // Flutter se user quantity alag se bhi update kar sakta hai
                    cart.pharmacyCart.items[itemIndex].quantity = data.days;
                }
            });
        }

        await cart.save();
        res.json({ 
            success: true, 
            message: `Duration updated to ${type}`, 
            data: cart.pharmacyCart 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
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
    clearPharmacyCart, removePharmacyItem,
    updateMedicineDuration,


    getAvailableSlots, getAvailableCoupons
 };