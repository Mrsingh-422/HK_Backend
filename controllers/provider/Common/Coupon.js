const Coupon = require('../../../models/Coupon');

// 1. CREATE VENDOR COUPON (Specific Vendor)
const createCoupon = async (req, res) => {
    try {
        const coupon = await Coupon.create({ 
            creatorId: req.user.id,
            vendorId: req.user.id, 
            vendorType: req.user.role,
            isAdminCreated: false, 
            ...req.body 
        });
        res.status(201).json({ success: true, message: "Coupon created", data: coupon });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. LIST MY COUPONS (Vendor + Admin Global)
const getMyCoupons = async (req, res) => {
    try {
        const list = await Coupon.find({ 
            $or: [
                // Condition 1: Vendor ke apne coupons
                { vendorId: req.user.id }, 
                
                // Condition 2: Admin ke banaye coupons jo is vendor ke type ke hain
                { 
                    isAdminCreated: true, 
                    vendorType: req.user.role, // e.g., 'Lab'
                    vendorId: null             // Global ones
                }
            ]
        }).sort({ createdAt: -1 });

        res.json({ success: true, data: list });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. ADMIN: CREATE GLOBAL COUPON
const createAdminCoupon = async (req, res) => {
    try {
        const { vendorType, ...couponDetails } = req.body; 

        // Optional: Enum check
        const allowedTypes = ['Lab', 'Pharmacy', 'Nurse', 'Hospital', 'Ambulance'];
        if (!allowedTypes.includes(vendorType)) {
            return res.status(400).json({ message: "Invalid Vendor Type selected" });
        }

        const coupon = await Coupon.create({ 
            creatorId: req.user.id,
            vendorType: vendorType, 
            vendorId: null,          
            isAdminCreated: true,    
            ...couponDetails 
        });

        res.status(201).json({ success: true, data: coupon });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. TOGGLE COUPON STATUS (Activate/Deactivate)
// endpoint: PATCH /provider/coupons/toggle/:id
const toggleCoupon = async (req, res) => {
    try {
        const coupon = await Coupon.findOne({ _id: req.params.id, vendorId: req.user.id });
        if (!coupon) return res.status(404).json({ message: "Coupon not found" });
        
        coupon.isActive = !coupon.isActive;
        await coupon.save();
        res.json({ success: true, message: `Coupon is now ${coupon.isActive ? 'Active' : 'Inactive'}` });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 5. DELETE COUPON
// endpoint: DELETE /provider/coupons/delete/:id
const deleteCoupon = async (req, res) => {
    try {
        const deleted = await Coupon.findOneAndDelete({ _id: req.params.id, vendorId: req.user.id });
        if (!deleted) return res.status(404).json({ message: "Coupon not found" });
        res.json({ success: true, message: "Coupon deleted successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { createCoupon, getMyCoupons, createAdminCoupon, toggleCoupon, deleteCoupon };