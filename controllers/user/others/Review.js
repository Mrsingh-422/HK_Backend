const mongoose = require('mongoose');
const Review = require('../../../models/Review');
const Doctor = require('../../../models/Doctor');
const Lab = require('../../../models/Lab');
const Pharmacy = require('../../../models/Pharmacy');
const Nurse = require('../../../models/Nurse');
const Hospital = require('../../../models/Hospital');
const Ambulance = require('../../../models/Ambulance');
const Driver = require('../../../models/Driver');


// 👈 MISSING BOOKING MODELS IMPORTED AT TOP
const Appointment = require('../../../models/Appointment');
const LabBooking = require('../../../models/LabBooking');
const PharmacyBooking = require('../../../models/PharmacyBooking');
const NurseBooking = require('../../../models/NurseBooking');
const AmbulanceBooking = require('../../../models/AmbulanceBooking');

// Helper: Model map
const getModelByType = (type) => {
    const map = { 
        'Doctor': Doctor, 
        'Lab': Lab, 
        'Pharmacy': Pharmacy, 
        'Nurse': Nurse, 
        'Hospital': Hospital, 
        'Ambulance': Ambulance, 
        'Driver': Driver 
    };
    return map[type];
};

// @desc    Submit review for Doctor/Hospital/Lab/Pharmacy/Nurse/Ambulance
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

        let resolvedOrderMongoId = null;

        if (orderId) {
            if (mongoose.isValidObjectId(orderId)) {
                resolvedOrderMongoId = new mongoose.Types.ObjectId(orderId);
            } else {
                const cleanId = String(orderId).trim();
                if (targetType === 'Doctor' || targetType === 'Hospital') {
                    const b = await Appointment.findOne({ bookingId: cleanId }).select('_id').lean();
                    if (b) resolvedOrderMongoId = b._id;
                } else if (targetType === 'Lab') {
                    const b = await LabBooking.findOne({ bookingId: cleanId }).select('_id').lean();
                    if (b) resolvedOrderMongoId = b._id;
                } else if (targetType === 'Pharmacy') {
                    const b = await PharmacyBooking.findOne({ orderId: cleanId }).select('_id').lean();
                    if (b) resolvedOrderMongoId = b._id;
                } else if (targetType === 'Nurse') {
                    const b = await NurseBooking.findOne({ bookingId: cleanId }).select('_id').lean();
                    if (b) resolvedOrderMongoId = b._id;
                } else if (targetType === 'Ambulance') {
                    const b = await AmbulanceBooking.findOne({ bookingId: cleanId }).select('_id').lean();
                    if (b) resolvedOrderMongoId = b._id;
                }
            }
        }

        // Fallback ObjectId if orderId was not provided or not resolved
        if (!resolvedOrderMongoId) {
            resolvedOrderMongoId = new mongoose.Types.ObjectId();
        }

        const review = await Review.create({
            userId: req.user.id,
            userName: req.user.name || "Verified Patient",
            targetId: new mongoose.Types.ObjectId(targetId),
            targetType,
            orderId: resolvedOrderMongoId,
            rating: Math.min(5, Math.max(1, Number(rating))),
            comment: comment ? String(comment).trim() : ""
        });

        const Model = getModelByType(targetType);
        if (Model) {
            const allReviews = await Review.find({ targetId, targetType }).select('rating').lean();
            const avgRating = allReviews.reduce((acc, item) => item.rating + acc, 0) / (allReviews.length || 1);
            const formattedAvg = parseFloat(avgRating.toFixed(1));

            await Model.findByIdAndUpdate(targetId, {
                $set: {
                    rating: formattedAvg,
                    averageRating: formattedAvg,
                    totalReviews: allReviews.length
                }
            });
        }

        return res.status(201).json({ 
            success: true, 
            message: "Review submitted and rating updated successfully.", 
            data: review 
        });

    } catch (error) { 
        console.error("Add Review Error:", error);
        return res.status(500).json({ success: false, message: error.message }); 
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