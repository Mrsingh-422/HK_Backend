const mongoose = require('mongoose');
const Review = require('../../../models/Review');
const Doctor = require('../../../models/Doctor');

// POST /user/review/add-review
const addReview = async (req, res) => {
    try {
        const { doctorId, targetId, appointmentId, orderId, rating, comment } = req.body;
        const finalDocId = doctorId || targetId;
        const finalOrderId = appointmentId || orderId || new mongoose.Types.ObjectId();

        if (!finalDocId || !rating) {
            return res.status(400).json({ success: false, message: "doctorId and rating are required." });
        }

        const review = await Review.create({
            userId: req.user.id,
            userName: req.user.name || "Verified Patient",
            targetId: finalDocId,
            targetType: 'Doctor',
            orderId: mongoose.isValidObjectId(finalOrderId) ? finalOrderId : new mongoose.Types.ObjectId(),
            rating: Number(rating),
            comment: comment || ""
        });

        const allReviews = await Review.find({ targetId: finalDocId, targetType: 'Doctor' });
        const avgRating = allReviews.reduce((acc, item) => item.rating + acc, 0) / (allReviews.length || 1);

        await Doctor.findByIdAndUpdate(finalDocId, {
            averageRating: parseFloat(avgRating.toFixed(1)),
            totalReviews: allReviews.length
        });

        res.status(201).json({ success: true, message: "Review added", data: review });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET /user/review/doctor/:doctorId
const getDoctorReviews = async (req, res) => {
    try {
        const reviews = await Review.find({ targetId: req.params.doctorId, targetType: 'Doctor' })
            .sort({ createdAt: -1 })
            .populate('userId', 'name profilePic');
            
        res.json({ success: true, data: reviews });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET /user/review/my-reviews
const getMyReviews = async (req, res) => {
    try {
        const reviews = await Review.find({ userId: req.user.id, targetType: 'Doctor' })
            .populate('targetId', 'name speciality profileImage');

        res.json({ success: true, data: reviews });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// DELETE /user/review/delete/:id
const deleteReview = async (req, res) => {
    try {
        const review = await Review.findOne({ _id: req.params.id, userId: req.user.id });
        if (!review) return res.status(404).json({ success: false, message: "Review not found" });

        const doctorId = review.targetId;
        await Review.findByIdAndDelete(req.params.id);

        const remainingReviews = await Review.find({ targetId: doctorId, targetType: 'Doctor' });
        let avgRating = 0;
        if (remainingReviews.length > 0) {
            avgRating = remainingReviews.reduce((acc, item) => item.rating + acc, 0) / remainingReviews.length;
        }

        await Doctor.findByIdAndUpdate(doctorId, {
            averageRating: parseFloat(avgRating.toFixed(1)),
            totalReviews: remainingReviews.length
        });

        res.json({ success: true, message: "Review deleted and rating updated" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { addReview, getDoctorReviews, getMyReviews, deleteReview };