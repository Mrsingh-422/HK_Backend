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

// @desc    Submit review for Doctor/Hospital/Lab/Pharmacy/Nurse/Ambulance (Resolves string order IDs safely)
// @route   POST /api/user/review/add
// @access  Private (User)
const addReview = async (req, res) => {
    try {
        const { targetId, targetType, orderId, rating, comment } = req.body;

        if (!targetId || !targetType || !rating) {
            return res.status(400).json({ success: false, message: "targetId, targetType, and rating are required." });
        }

        if (!mongoose.isValidObjectId(targetId)) {
            return res.status(400).json({ success: false, message: "Invalid targetId format." });
        }

        // 🚨 BUG FIX: Resolve orderId whether sent as MongoDB ObjectId OR string custom booking ID
        let resolvedOrderMongoId = null;

        if (orderId) {
            if (mongoose.isValidObjectId(orderId)) {
                resolvedOrderMongoId = new mongoose.Types.ObjectId(orderId);
            } else {
                const cleanId = String(orderId).trim();
                // Resolve from respective collection
                if (targetType === 'Doctor' || targetType === 'Hospital') {
                    const b = await Appointment.findOne({ bookingId: cleanId }).select('_id');
                    if (b) resolvedOrderMongoId = b._id;
                } else if (targetType === 'Lab') {
                    const b = await LabBooking.findOne({ bookingId: cleanId }).select('_id');
                    if (b) resolvedOrderMongoId = b._id;
                } else if (targetType === 'Pharmacy') {
                    const b = await PharmacyBooking.findOne({ orderId: cleanId }).select('_id');
                    if (b) resolvedOrderMongoId = b._id;
                } else if (targetType === 'Nurse') {
                    const b = await NurseBooking.findOne({ bookingId: cleanId }).select('_id');
                    if (b) resolvedOrderMongoId = b._id;
                } else if (targetType === 'Ambulance') {
                    const b = await AmbulanceBooking.findOne({ bookingId: cleanId }).select('_id');
                    if (b) resolvedOrderMongoId = b._id;
                }
            }
        }

        // 1. Create Review Document safely
        const review = await Review.create({
            userId: req.user.id,
            userName: req.user.name || "Verified Patient",
            targetId: new mongoose.Types.ObjectId(targetId),
            targetType,
            orderId: resolvedOrderMongoId || undefined,
            rating: Math.min(5, Math.max(1, Number(rating))),
            comment: comment ? String(comment).trim() : ""
        });

        // 2. Recalculate Vendor Average Rating
        const Model = getModelByType(targetType);
        if (Model) {
            const allReviews = await Review.find({ targetId });
            const avgRating = allReviews.reduce((acc, item) => item.rating + acc, 0) / allReviews.length;
            const formattedAvg = parseFloat(avgRating.toFixed(1));

            await Model.findByIdAndUpdate(targetId, {
                $set: {
                    rating: formattedAvg,
                    averageRating: formattedAvg,
                    totalReviews: allReviews.length
                }
            });
        }

        res.status(201).json({ 
            success: true, 
            message: "Review submitted and rating updated successfully.", 
            data: review 
        });

    } catch (error) { 
        console.error("Add Review Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
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