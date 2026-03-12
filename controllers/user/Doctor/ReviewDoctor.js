const Review = require('../../../models/Review');
const Doctor = require('../../../models/Doctor');

// POST /user/review/add-review
const addReview = async (req, res) => {
    try {
        const { doctorId, appointmentId, rating, comment } = req.body;

        const review = await Review.create({
            userId: req.user.id,
            userName: req.user.name,
            doctorId,
            appointmentId,
            rating,
            comment
        });

        const allReviews = await Review.find({ doctorId });
        const avgRating = allReviews.reduce((acc, item) => item.rating + acc, 0) / allReviews.length;

        await Doctor.findByIdAndUpdate(doctorId, {
            averageRating: avgRating.toFixed(1),
            totalReviews: allReviews.length
        });

        res.status(201).json({ success: true, message: "Review added", data: review });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// GET /user/review/doctor/:doctorId
const getDoctorReviews = async (req, res) => {
    try {
        const reviews = await Review.find({ doctorId: req.params.doctorId })
            .sort({ createdAt: -1 })
            .populate('userId', 'profilePic'); // Agar user ki photo dikhani ho
            
        res.json({ success: true, data: reviews });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// GET /user/review/my-reviews
const getMyReviews = async (req, res) => {
    try {
        const reviews = await Review.find({ userId: req.user.id })
            .populate('doctorId', 'name speciality profileImage');

        res.json({ success: true, data: reviews });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// DELETE /user/review/delete/:id
const deleteReview = async (req, res) => {
    try {
        const review = await Review.findOne({ _id: req.params.id, userId: req.user.id });
        if (!review) return res.status(404).json({ message: "Review not found" });

        const doctorId = review.doctorId;
        await Review.findByIdAndDelete(req.params.id);

        const remainingReviews = await Review.find({ doctorId });
        let avgRating = 0;
        if (remainingReviews.length > 0) {
            avgRating = remainingReviews.reduce((acc, item) => item.rating + acc, 0) / remainingReviews.length;
        }

        await Doctor.findByIdAndUpdate(doctorId, {
            averageRating: avgRating.toFixed(1),
            totalReviews: remainingReviews.length
        });

        res.json({ success: true, message: "Review deleted and rating updated" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { addReview, getDoctorReviews, getMyReviews, deleteReview };