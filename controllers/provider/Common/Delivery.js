const DeliveryCharge = require('../../../models/DeliveryCharge');

// Default Values for Production (agar vendor ne set nahi kiya)
const DEFAULT_CHARGES = {
    fixedPrice: 50,
    fixedDistance: 5,
    pricePerKM: 5,
    fastDeliveryExtra: 100,
    freeDeliveryThreshold: 300,
    taxPercentage: 0,
    taxInRupees: 0
};

// 1. SAVE/UPDATE DELIVERY CHARGES
const saveDeliveryCharges = async (req, res) => {
    try {
        const vendorId = req.user.id;
        const vendorType = req.user.role; // Role: Lab, Pharmacy, ya Nurse

        const charges = await DeliveryCharge.findOneAndUpdate(
            { vendorId: vendorId },
            { 
                $set: { 
                    ...req.body, 
                    vendorId, 
                    vendorType // Vendor Type yahan save ho raha hai
                } 
            },
            { upsert: true, new: true }
        );

        res.json({ success: true, message: "Delivery charges saved", data: charges });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 2. GET MY DELIVERY CHARGES
const getMyDeliveryCharges = async (req, res) => {
    try {
        const charges = await DeliveryCharge.findOne({ vendorId: req.user.id });

        if (!charges) {
            return res.json({ 
                success: true, 
                data: { ...DEFAULT_CHARGES, vendorType: req.user.role }, 
                isDefault: true 
            });
        }
        
        res.json({ success: true, data: charges, isDefault: false });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// for USER side logic ( USER Side Checkout Logic )
// jab user checkout krega toh delivery fee calculate karo
const getCalculatedDelivery = (distance, orderTotal, charges) => {
    let deliveryFee = 0;
    
    // 1. Check Free Delivery Threshold
    if (orderTotal >= charges.freeDeliveryThreshold) {
        deliveryFee = 0;
    } else {
        // 2. Distance Based Logic
        if (distance <= charges.fixedDistance) {
            deliveryFee = charges.fixedPrice;
        } else {
            const extraDistance = distance - charges.fixedDistance;
            deliveryFee = charges.fixedPrice + (extraDistance * charges.pricePerKM);
        }
    }
    return deliveryFee;
};

module.exports = { saveDeliveryCharges, getMyDeliveryCharges };