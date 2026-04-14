const Coupon = require('../../../models/Coupon');

// 1. CREATE VENDOR COUPON (Specific Vendor)
const createCoupon = async (req, res) => {
    try {
        const { discountPercentage, expiryDate, minOrderAmount } = req.body;

        // Gap Fix: Data Validation
        if (discountPercentage > 100 || discountPercentage <= 0) {
            return res.status(400).json({ message: "Percentage must be between 1 and 100" });
        }
        if (new Date(expiryDate) <= new Date()) {
            return res.status(400).json({ message: "Expiry date must be in the future" });
        }

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
                { vendorId: req.user.id }, // Vendor's own
                { 
                    isAdminCreated: true, 
                    vendorType: { $in: [req.user.role, 'All'] }, // Gap Fix: 'All' check
                    vendorId: null 
                }
            ]
        }).sort({ createdAt: -1 });
        res.json({ success: true, data: list });
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

// 5. UPDATE COUPON
// endpoint: PATCH /provider/coupons/update/:id
const updateCoupon = async (req, res) => {
    try {
        const { id } = req.params;
        let coupon = await Coupon.findOne({ _id: id, vendorId: req.user.id });

        if (!coupon) {
            return res.status(404).json({ success: false, message: "Vendor Coupon not found" });
        }

        const fieldsToUpdate = ['couponName', 'discountPercentage', 'maxDiscount', 'minOrderAmount', 'maxUsagePerUser', 'expiryDate', 'isActive'];
        
        fieldsToUpdate.forEach(field => {
            if (req.body[field] !== undefined) {
                coupon[field] = req.body[field];
            }
        });

        const updatedCoupon = await coupon.save();
        res.json({ success: true, message: "Vendor Coupon updated successfully", data: updatedCoupon });

    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: "Coupon name already exists" });
        }
        res.status(500).json({ success: false, message: error.message });
    }
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

// 2. Admin List All Admin-Created Coupons
const getAdminCoupons = async (req, res) => {
    try {
        // Admin ko sirf wahi dikhenge jo usne (ya any admin ne) banaye hain
        const list = await Coupon.find({ isAdminCreated: true }).sort({ createdAt: -1 });
        res.json({ success: true, data: list });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. Admin Toggle (Any Admin Coupon)
const toggleAdminCoupon = async (req, res) => {
    try {
        const coupon = await Coupon.findOne({ _id: req.params.id, isAdminCreated: true });
        if (!coupon) return res.status(404).json({ message: "Admin Coupon not found" });
        coupon.isActive = !coupon.isActive;
        await coupon.save();
        res.json({ success: true, message: "Admin coupon status updated" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. Admin Update (Any Admin Coupon)
const updateAdminCoupon = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Pehle check karein ki kya coupon exist karta hai aur Admin ne banaya hai
        let coupon = await Coupon.findOne({ _id: id, isAdminCreated: true });

        if (!coupon) {
            return res.status(404).json({ success: false, message: "Admin Coupon not found" });
        }

        // 2. Body se data nikal kar update karein
        const fieldsToUpdate = [
            'vendorType', 'couponName', 'discountPercentage', 'maxDiscount', 
            'minOrderAmount', 'maxUsagePerUser', 'startDate', 'expiryDate', 'isActive'
        ];

        fieldsToUpdate.forEach(field => {
            if (req.body[field] !== undefined) {
                coupon[field] = req.body[field];
            }
        });

        // 3. Save karein (Isse Unique Validation trigger hogi)
        const updatedCoupon = await coupon.save();

        res.json({ 
            success: true, 
            message: "Admin Global Coupon updated successfully", 
            data: updatedCoupon 
        });

    } catch (error) {
        console.error("ADMIN UPDATE ERROR:", error);

        // Duplicate Name Error (Code 11000)
        if (error.code === 11000) {
            return res.status(400).json({ 
                success: false, 
                message: `Coupon name '${req.body.couponName}' already exists. Please use a unique name.` 
            });
        }

        res.status(500).json({ success: false, message: error.message });
    }
};



// 4. Admin Delete (Any Admin Coupon)
const deleteAdminCoupon = async (req, res) => {
    try {
        const deleted = await Coupon.findOneAndDelete({ _id: req.params.id, isAdminCreated: true });
        if (!deleted) return res.status(404).json({ message: "Admin Coupon not found" });
        res.json({ success: true, message: "Admin Coupon deleted successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


const getCouponEnumTypes = async (req, res) => {
    try {
        // Schema se 'vendorType' field ke allowed values (Enum) nikalna
        const enumValues = await Coupon.schema.path('vendorType').enumValues;

        // Agar aap 'Admin' ko dropdown mein nahi dikhana chahte (kyunki admin admin ke liye coupon nahi banayega)
        // Toh use filter kar sakte hain:
        const filteredTypes = enumValues.filter(type => type !== 'Admin');

        res.status(200).json({ 
            success: true, 
            data: filteredTypes // Returns: ["Lab", "Pharmacy", "Nurse", "Hospital", "Ambulance"]
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { createCoupon, getMyCoupons, createAdminCoupon, toggleCoupon, deleteCoupon,getCouponEnumTypes, getAdminCoupons, toggleAdminCoupon, deleteAdminCoupon ,updateAdminCoupon, updateCoupon};