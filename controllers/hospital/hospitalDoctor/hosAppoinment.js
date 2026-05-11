const Appointment = require('../../../models/Appointment');
const Ward = require('../../../models/Ward');
const Bed = require('../../../models/Bed');
const mongoose = require('mongoose');

// 1. GET ALL BOOKINGS (Bifurcated & Searchable)
const getHospitalAllBookings = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { status, bookingType, triageLevel, page = 1, limit = 10 } = req.query; 

        let query = { hospitalId: hospitalId };

        if (status) query.status = status;
        if (bookingType) query.bookingType = bookingType;
        if (triageLevel) query.triageLevel = triageLevel;

        const appointments = await Appointment.find(query)
            .populate('doctorId', 'name speciality profileImage')
            .populate({
                path: 'bedId',
                select: 'bedNumber pricePerDay',
                populate: { path: 'wardId', select: 'name type' } // Detailed ward info
            })
            .populate('userId', 'name phone email profilePic age gender')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Appointment.countDocuments(query);

        res.json({ success: true, total, count: appointments.length, data: appointments });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. APPROVE & ASSIGN (Professional Flow - Screenshot 35)
// Hospital admin patient ke liye doctor assign karke approve karega
const approveHospitalBooking = async (req, res) => {
    try {
        const { doctorId } = req.body; // Figma: Assign Doctor during approval
        const hospitalId = req.user.id;

        const appointment = await Appointment.findOne({ _id: req.params.id, hospitalId });
        if (!appointment) return res.status(404).json({ message: "Booking not found" });

        // Update Appointment
        appointment.status = 'Confirmed';
        if (doctorId) appointment.doctorId = doctorId;
        
        // Bed logic: Reserved -> Occupied
        if (appointment.bookingType === 'Admission' && appointment.bedId) {
             await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Occupied' } });
        }

        await appointment.save();
        res.json({ success: true, message: "Admission Confirmed & Doctor Assigned", data: appointment });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. REJECT & RELEASE (Screenshot 34)
const rejectHospitalBooking = async (req, res) => {
    try {
        const { reason } = req.body;
        const hospitalId = req.user.id;

        const appointment = await Appointment.findOne({ _id: req.params.id, hospitalId });
        if (!appointment) return res.status(404).json({ message: "Booking not found" });

        appointment.status = 'Cancelled-By-Hospital';
        appointment.paymentStatus = 'Refund-Initiated'; 
        appointment.cancellationDetails = {
            cancelledBy: hospitalId,
            reason: reason || "Hospital capacity full or medical mismatch",
            cancelledAt: new Date()
        };

        // Bed logic: Reserved -> Available (Release bed if rejected)
        if (appointment.bedId) {
            const bed = await Bed.findByIdAndUpdate(appointment.bedId, { $set: { status: 'Available' } });
            if (bed) {
                await Ward.findByIdAndUpdate(bed.wardId, { $inc: { availableBeds: 1 } });
            }
        }

        await appointment.save();
        res.json({ success: true, message: "Booking Rejected & Bed Released for others" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. STATS (Screenshot 4)
const getHospitalStats = async (req, res) => {
    try {
        const hospitalId = req.user.id;

        const stats = await Appointment.aggregate([
            { $match: { hospitalId: new mongoose.Types.ObjectId(hospitalId) } },
            { $group: {
                _id: null,
                emergency: { $sum: { $cond: [{ $eq: ["$triageLevel", "Emergency"] }, 1, 0] } },
                admission: { $sum: { $cond: [{ $eq: ["$bookingType", "Admission"] }, 1, 0] } },
                discharge: { $sum: { $cond: [{ $eq: ["$status", "Confirmed"] }, 1, 0] } } // Discharges Pending
            }}
        ]);

        res.json({ success: true, data: stats[0] || { emergency: 0, admission: 0, discharge: 0 } });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { 
    getHospitalAllBookings, approveHospitalBooking, rejectHospitalBooking, getHospitalStats 
};