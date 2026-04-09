const Review = require('../../../models/Review');
const Doctor = require('../../../models/Doctor');
const Lab = require('../../../models/Lab');
const Pharmacy = require('../../../models/Pharmacy');
const Nurse = require('../../../models/Nurse');
const Hospital = require('../../../models/Hospital');
const Ambulance = require('../../../models/Ambulance');
const Driver = require('../../../models/Driver');
// ... baaki models import karein (Pharmacy, Nurse, Hospital, Ambulance)

// Helper: Model map
const getModelByType = (type) => {
    const map = { 'Doctor': Doctor, 'Lab': Lab , 'Pharmacy': Pharmacy, 'Nurse': Nurse, 'Hospital': Hospital, 'Ambulance': Ambulance,'Driver': Driver /* *, ...add others */ };
    return map[type];
};

const addReview = async (req, res) => {
    try {
        const { targetId, targetType, orderId, rating, comment } = req.body;

        // 1. Create Review
        const review = await Review.create({
            userId: req.user.id,
            userName: req.user.name,
            targetId,
            targetType,
            orderId,
            rating,
            comment
        });

        // 2. Update Vendor's Average Rating
        const Model = getModelByType(targetType);
        const allReviews = await Review.find({ targetId });
        const avgRating = allReviews.reduce((acc, item) => item.rating + acc, 0) / allReviews.length;

        await Model.findByIdAndUpdate(targetId, {
            rating: avgRating.toFixed(1),
            totalReviews: allReviews.length
        });

        res.status(201).json({ success: true, message: "Review added", data: review });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// GET ALL REVIEWS FOR A VENDOR (For Doctor/Lab Profile Screen)
// Endpoint: GET /api/user/review/list/:targetType/:targetId
const getVendorReviews = async (req, res) => {
    try {
        const reviews = await Review.find({ 
            targetId: req.params.targetId, 
            targetType: req.params.targetType 
        }).sort({ createdAt: -1 });
        res.json({ success: true, data: reviews });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { addReview, getVendorReviews };