const Coupon = require('../../models/Coupon');

// 1. CREATE DOCTOR COUPON
const createDoctorCoupon = async (req, res) => {
    try {
        const { couponName, discountPercentage, maxDiscount, expiryDate, minOrderAmount } = req.body;

        // Validation
        if (discountPercentage > 100 || discountPercentage <= 0) {
            return res.status(400).json({ success: false, message: "Percentage must be between 1 and 100" });
        }
        if (new Date(expiryDate) <= new Date()) {
            return res.status(400).json({ success: false, message: "Expiry date must be in the future" });
        }

        const coupon = await Coupon.create({ 
            creatorId: req.user.id,
            vendorId: req.user.id, 
            vendorType: 'Doctor', // Specifically for Doctor
            isAdminCreated: false, 
            ...req.body 
        });

        res.status(201).json({ success: true, message: "Coupon created successfully", data: coupon });
    } catch (error) { 
        if (error.code === 11000) return res.status(400).json({ success: false, message: "Coupon name already exists" });
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. LIST DOCTOR COUPONS (Own + Admin's Doctor Coupons)
const getDoctorCoupons = async (req, res) => {
    try {
        const list = await Coupon.find({ 
            $or: [
                { vendorId: req.user.id }, // Doctor's own
                { 
                    isAdminCreated: true, 
                    vendorType: { $in: ['Doctor', 'All'] }, // Global coupons for Doctors
                    vendorId: null 
                }
            ]
        }).sort({ createdAt: -1 });

        res.json({ success: true, data: list });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

// 3. TOGGLE STATUS
const toggleDoctorCoupon = async (req, res) => {
    try {
        const coupon = await Coupon.findOne({ _id: req.params.id, vendorId: req.user.id });
        if (!coupon) return res.status(404).json({ success: false, message: "Coupon not found" });
        
        coupon.isActive = !coupon.isActive;
        await coupon.save();
        res.json({ success: true, message: `Coupon is now ${coupon.isActive ? 'Active' : 'Inactive'}` });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

// 4. UPDATE COUPON
const updateDoctorCoupon = async (req, res) => {
    try {
        const updated = await Coupon.findOneAndUpdate(
            { _id: req.params.id, vendorId: req.user.id },
            { $set: req.body },
            { new: true }
        );
        if (!updated) return res.status(404).json({ success: false, message: "Coupon not found" });
        res.json({ success: true, message: "Coupon updated", data: updated });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

// 5. DELETE COUPON
const deleteDoctorCoupon = async (req, res) => {
    try {
        const deleted = await Coupon.findOneAndDelete({ _id: req.params.id, vendorId: req.user.id });
        if (!deleted) return res.status(404).json({ success: false, message: "Coupon not found" });
        res.json({ success: true, message: "Coupon deleted successfully" });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

module.exports = {
    createDoctorCoupon,
    getDoctorCoupons,
    toggleDoctorCoupon,
    updateDoctorCoupon,
    deleteDoctorCoupon
};