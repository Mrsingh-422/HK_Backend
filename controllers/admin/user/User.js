const User = require('../../../models/User');
const UnbanRequest = require('../../../models/UnbanRequest');

const Appointment = require('../../../models/Appointment');
const LabBooking = require('../../../models/LabBooking');
const PharmacyBooking = require('../../../models/PharmacyBooking');
const NurseBooking = require('../../../models/NurseBooking');
const AmbulanceBooking = require('../../../models/AmbulanceBooking');
const mongoose = require('mongoose');

// Helper function: Data ko transform karne ke liye (Exact Keys as requested)
const transformUserData = (user) => ({
    id: user._id,
    name: user.name || "",
    email: user.email || "",
    number: user.phone || "",
    active: user.isActive !== false,
    active: user.profileStatus === 'Approved', // Approved = true, else false
    profilePic: user.profilePic // Added as per your request
});

// 1. GET ALL USERS (With Pagination - 50 per page)
const getAllUsersAdmin = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 50;
        const skip = (page - 1) * limit;

        const totalUsers = await User.countDocuments({ role: 'user' });
        
        const users = await User.find({ role: 'user' })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        // Sirf wahi keys bhej rahe hain jo aapne di hain
        const formattedData = users.map(transformUserData);

        res.json({
            success: true,
            total: totalUsers,
            page,
            pages: Math.ceil(totalUsers / limit),
            data: formattedData
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. SEARCH USERS (Search by Name, Email, or Phone)
const searchUsersAdmin = async (req, res) => {
    try {
        const { query } = req.query; // Search keyword
        if (!query) {
            return res.status(400).json({ message: "Search query is required" });
        }

        const searchCriteria = {
            role: 'user',
            $or: [
                { name: { $regex: query, $options: 'i' } },
                { email: { $regex: query, $options: 'i' } },
                { phone: { $regex: query, $options: 'i' } }
            ]
        };

        const users = await User.find(searchCriteria).limit(20); // Search results limited to 20

        const formattedData = users.map(transformUserData);

        res.json({
            success: true,
            count: users.length,
            data: formattedData
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. GET SINGLE USER DETAILS (Full Data)
const getUserDetailsAdmin = async (req, res) => {
    try {
        const user = await User.findById(req.params.id).populate('insuranceId');
        if (!user) return res.status(404).json({ message: "User not found" });
        res.json({ success: true, data: user });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 4. TOGGLE USER STATUS (Active / Inactive Switch)
const toggleUserStatus = async (req, res) => {
    try {
        const { id } = req.params;

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // 🔄 Toggle isActive status (True <-> False)
        user.isActive = user.isActive === false ? true : false;

        // Agar Admin ne user ko Deactivate / Inactive kar diya, toh uske active session tokens revoke karein
        if (user.isActive === false) {
            user.token = null; // 👈 Auto-logout from all devices
        }

        await user.save();

        const currentStatus = user.isActive ? 'Active' : 'Inactive';

        res.json({
            success: true,
            message: `User status successfully updated to ${currentStatus}.`,
            isActive: user.isActive,
            status: currentStatus,
            data: {
                id: user._id,
                name: user.name,
                phone: user.phone,
                isActive: user.isActive
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 5. DELETE USER
const deleteUserAdmin = async (req, res) => {
    try {
        const deleted = await User.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ message: "User not found" });
        res.json({ success: true, message: "User deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 1. GET ALL BANNED USERS (Auto-Banned on 2 Accidental Cancellations)
// Endpoint: GET /admin/users/banned-users
const adminGetBannedUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;

        const query = {
            $or: [
                { isBanned: true },
                { isActive: false }
            ]
        };

        const total = await User.countDocuments(query);
        const bannedUsers = await User.find(query)
            .select('name phone email banReason isBanned isActive accidentalBookingCount createdAt updatedAt')
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        res.json({
            success: true,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: bannedUsers
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. UNBAN USER (Admin Action)
// Endpoint: PATCH /admin/users/unban/:userId
const adminUnbanUser = async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await User.findByIdAndUpdate(
            userId,
            {
                $set: {
                    isActive: true,
                    isBanned: false,
                    banReason: null,
                    unbannedAt: new Date() // 👈 Saves unban timestamp
                }
            },
            { new: true }
        );

        if (!user) return res.status(404).json({ success: false, message: "User not found." });

        res.json({
            success: true,
            message: `User ${user.name} (${user.phone}) has been unbanned and reactivated successfully.`,
            data: user
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 1. GET ALL UNBAN REQUESTS (Pending, Approved, Rejected)
// Endpoint: GET /admin/users/unban-requests?status=Pending&page=1
const adminGetUnbanRequests = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const { status } = req.query;

        const query = {};
        if (status && status !== 'All') {
            query.status = status;
        }

        const total = await UnbanRequest.countDocuments(query);
        const requests = await UnbanRequest.find(query)
            .populate('userId', 'name phone email banReason accidentalBookingCount createdAt')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        res.json({
            success: true,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: requests
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. ADMIN ACTION ON UNBAN REQUEST (Approve / Reject)
// Endpoint: PATCH /admin/users/unban-requests/:requestId
const adminHandleUnbanAction = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { action, adminComments } = req.body; // action: 'Approved' | 'Rejected'
        const adminId = req.user.id;

        if (!action || !['Approved', 'Rejected'].includes(action)) {
            return res.status(400).json({ success: false, message: "action must be 'Approved' or 'Rejected'." });
        }

        const request = await UnbanRequest.findById(requestId);
        if (!request || request.status !== 'Pending') {
            return res.status(404).json({ success: false, message: "Active pending unban request not found." });
        }

        // ==========================================
        // CASE A: APPROVE UNBAN
        // ==========================================
        if (action === 'Approved') {
            request.status = 'Approved';
            request.adminComments = adminComments || "Unbanned by Admin";
            request.adminId = adminId;
            request.resolvedAt = new Date();
            await request.save();

            // 🚨 UNBAN USER & GIVE FRESH 24-HOUR CHANCE
            await User.findByIdAndUpdate(request.userId, {
                $set: {
                    isActive: true,
                    isBanned: false,
                    banReason: null,
                    unbannedAt: new Date() // 👈 Reset unban timestamp
                }
            });

            return res.json({
                success: true,
                message: `User ${request.name} (${request.phone}) has been unbanned successfully!`,
                data: request
            });
        }

        // ==========================================
        // CASE B: REJECT UNBAN
        // ==========================================
        if (action === 'Rejected') {
            request.status = 'Rejected';
            request.adminComments = adminComments || "Unban request rejected by Admin.";
            request.adminId = adminId;
            request.resolvedAt = new Date();
            await request.save();

            return res.json({
                success: true,
                message: "Unban request rejected. User remains suspended.",
                data: request
            });
        }

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getUserOrdersAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const type = req.query.type || 'All'; // Options: 'Doctor', 'Lab', 'Pharmacy', 'Nurse', 'Ambulance', 'All'

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid User ID format." });
        }

        let orders = [];
        let total = 0;

        // Specific category logic for fast DB execution & precise pagination
        if (type === 'Doctor') {
            total = await Appointment.countDocuments({ userId: id });
            const data = await Appointment.find({ userId: id })
                .populate('doctorId', 'name speciality')
                .populate('hospitalId', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean();

            orders = data.map(item => ({
                orderId: item.bookingId || "N/A",
                mongoId: item._id,
                type: 'Doctor',
                date: item.appointmentDate || item.createdAt,
                status: item.status,
                total: item.totalAmount || 0,
                details: item.bookingType === 'Admission' ? 'Hospital Admission' : `Consultation with Dr. ${item.doctorId?.name || 'Staff'}`
            }));

        } else if (type === 'Lab') {
            total = await LabBooking.countDocuments({ userId: id });
            const data = await LabBooking.find({ userId: id })
                .populate('labId', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean();

            orders = data.map(item => ({
                orderId: item.bookingId || "N/A",
                mongoId: item._id,
                type: 'Lab',
                date: item.appointmentDate || item.createdAt,
                status: item.status,
                total: item.billSummary?.totalAmount || 0,
                details: `Lab Test at ${item.labId?.name || 'Partner Lab'}`
            }));

        } else if (type === 'Pharmacy') {
            total = await PharmacyBooking.countDocuments({ userId: id });
            const data = await PharmacyBooking.find({ userId: id })
                .populate('pharmacyId', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean();

            orders = data.map(item => ({
                orderId: item.orderId || "N/A",
                mongoId: item._id,
                type: 'Pharmacy',
                date: item.appointmentDate || item.createdAt,
                status: item.status,
                total: item.billSummary?.totalAmount || 0,
                details: `Medicine Order from ${item.pharmacyId?.name || 'Pharmacy Partner'}`
            }));

        } else if (type === 'Nurse') {
            total = await NurseBooking.countDocuments({ userId: id });
            const data = await NurseBooking.find({ userId: id })
                .populate('nurseId', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean();

            orders = data.map(item => ({
                orderId: item.bookingId || "N/A",
                mongoId: item._id,
                type: 'Nurse',
                date: item.schedule?.startDate || item.createdAt,
                status: item.status,
                total: item.priceBreakdown?.totalPrice || 0,
                details: `Nurse Service by ${item.nurseId?.name || 'Staff'}`
            }));

        } else if (type === 'Ambulance') {
            total = await AmbulanceBooking.countDocuments({ userId: id });
            const data = await AmbulanceBooking.find({ userId: id })
                .populate('ambulanceId', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean();

            orders = data.map(item => ({
                orderId: item.bookingId || "N/A",
                mongoId: item._id,
                type: 'Ambulance',
                date: item.scheduledAt || item.createdAt,
                status: item.status,
                total: item.pricing?.total || 0,
                details: `${item.serviceType} Booking`
            }));

        } else {
            // 'All' - Parallel fetch for recent orders across all services
            const [doctorList, labList, pharmacyList, nurseList, ambulanceList] = await Promise.all([
                Appointment.find({ userId: id }).populate('doctorId', 'name').populate('hospitalId', 'name').sort({ createdAt: -1 }).limit(100).lean(),
                LabBooking.find({ userId: id }).populate('labId', 'name').sort({ createdAt: -1 }).limit(100).lean(),
                PharmacyBooking.find({ userId: id }).populate('pharmacyId', 'name').sort({ createdAt: -1 }).limit(100).lean(),
                NurseBooking.find({ userId: id }).populate('nurseId', 'name').sort({ createdAt: -1 }).limit(100).lean(),
                AmbulanceBooking.find({ userId: id }).populate('ambulanceId', 'name').sort({ createdAt: -1 }).limit(100).lean()
            ]);

            const compiled = [
                ...doctorList.map(item => ({
                    orderId: item.bookingId || "N/A",
                    mongoId: item._id,
                    type: 'Doctor',
                    date: item.appointmentDate || item.createdAt,
                    status: item.status,
                    total: item.totalAmount || 0,
                    details: item.bookingType === 'Admission' ? 'Hospital Admission' : `Consultation with Dr. ${item.doctorId?.name || 'Staff'}`,
                    createdAt: item.createdAt
                })),
                ...labList.map(item => ({
                    orderId: item.bookingId || "N/A",
                    mongoId: item._id,
                    type: 'Lab',
                    date: item.appointmentDate || item.createdAt,
                    status: item.status,
                    total: item.billSummary?.totalAmount || 0,
                    details: `Lab Test at ${item.labId?.name || 'Partner Lab'}`,
                    createdAt: item.createdAt
                })),
                ...pharmacyList.map(item => ({
                    orderId: item.orderId || "N/A",
                    mongoId: item._id,
                    type: 'Pharmacy',
                    date: item.appointmentDate || item.createdAt,
                    status: item.status,
                    total: item.billSummary?.totalAmount || 0,
                    details: `Medicine Order from ${item.pharmacyId?.name || 'Pharmacy Partner'}`,
                    createdAt: item.createdAt
                })),
                ...nurseList.map(item => ({
                    orderId: item.bookingId || "N/A",
                    mongoId: item._id,
                    type: 'Nurse',
                    date: item.schedule?.startDate || item.createdAt,
                    status: item.status,
                    total: item.priceBreakdown?.totalPrice || 0,
                    details: `Nurse Service by ${item.nurseId?.name || 'Staff'}`,
                    createdAt: item.createdAt
                })),
                ...ambulanceList.map(item => ({
                    orderId: item.bookingId || "N/A",
                    mongoId: item._id,
                    type: 'Ambulance',
                    date: item.scheduledAt || item.createdAt,
                    status: item.status,
                    total: item.pricing?.total || 0,
                    details: `${item.serviceType} Booking`,
                    createdAt: item.createdAt
                }))
            ];

            // Real-time Sorting of compiled logs by creation timestamp
            compiled.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            total = compiled.length;
            orders = compiled.slice(skip, skip + limit);
        }

        res.json({
            success: true,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            limit,
            typeApplied: type,
            data: orders
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getUserOrderDetailAdmin = async (req, res) => {
    try {
        const { type, id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid MongoDB ID format." });
        }

        let detail = null;

        switch (type) {
            case 'Doctor':
                // 🩺 Doctor Appointment & Hospital Bed Booking (Both resolved under Appointment schema)
                detail = await Appointment.findById(id)
                    .populate('userId', 'name email phone profilePic gender dob')
                    .populate('doctorId', 'name email phone speciality qualification profileImage fees alternatePhone languages')
                    .populate('hospitalId', 'name address phone location hospitalImage type')
                    .populate('bedId', 'bedNumber status pricePerDay isVentilatorAvailable')
                    .populate('clinicalLogs.doctorId', 'name speciality')
                    .populate('bedsideCareTeam.doctorId', 'name speciality')
                    .populate('activeMedications.addedBy', 'name speciality')
                    .populate('pendingDoctorId', 'name speciality')
                    .populate('treatmentHistory.fromDoctorId', 'name speciality')
                    .populate('treatmentHistory.toDoctorId', 'name speciality')
                    .lean();

                if (!detail) {
                    return res.status(404).json({ success: false, message: "Doctor Appointment/Admission record not found." });
                }
                break;

            case 'Lab':
                // 🧪 Lab Tests & Packages Bookings
                detail = await LabBooking.findById(id)
                    .populate('userId', 'name email phone profilePic')
                    .populate('labId', 'name email phone location address isHomeCollectionAvailable isRapidServiceAvailable')
                    .populate('phlebotomistId', 'name phone profilePic vehicleNumber vehicleType')
                    .populate('items.tests.testId', 'testName mainCategory sampleType reportTime amount discountPrice')
                    .populate('items.packages.packageId', 'packageName mainCategory sampleType reportTime amount discountPrice')
                    .lean();

                if (!detail) {
                    return res.status(404).json({ success: false, message: "Lab Booking not found." });
                }
                break;

            case 'Pharmacy':
                // 💊 Pharmacy Medicine Orders
                detail = await PharmacyBooking.findById(id)
                    .populate('userId', 'name email phone profilePic')
                    .populate('pharmacyId', 'name email phone address location isHomeDeliveryAvailable')
                    .populate('driverId', 'name phone profilePic vehicleNumber vehicleType')
                    .populate('items.medicineId', 'name manufacturers packaging mrp best_price salt_composition image_url introduction benefits')
                    .lean();

                if (!detail) {
                    return res.status(404).json({ success: false, message: "Pharmacy Order not found." });
                }
                break;

            case 'Nurse':
                // 🩻 Nurse Clinical Visita & Stay Packages
                detail = await NurseBooking.findById(id)
                    .populate('userId', 'name email phone profilePic gender dob')
                    .populate('nurseId', 'name email phone speciality profileImage experienceYears gender about')
                    .populate('assignedStaffId', 'name phone profilePic vehicleNumber vehicleType status')
                    .lean();

                if (!detail) {
                    return res.status(404).json({ success: false, message: "Nurse Booking not found." });
                }
                break;

            case 'Ambulance':
                // 🚑 Emergency SOS & Scheduled Ambulance Bookings
                detail = await AmbulanceBooking.findById(id)
                    .populate('userId', 'name email phone profilePic')
                    .populate('ambulanceId', 'name phone vehicleNumber vehicleType location driverInfo profilePic')
                    .populate('hospitalId', 'name address location phone hospitalImage')
                    .populate('pickupHospitalId', 'name address location phone')
                    .lean();

                if (!detail) {
                    return res.status(404).json({ success: false, message: "Ambulance Booking not found." });
                }
                break;

            default:
                return res.status(400).json({ 
                    success: false, 
                    message: "Invalid order type. Supported categories are: Doctor, Lab, Pharmacy, Nurse, Ambulance." 
                });
        }

        res.json({
            success: true,
            type,
            data: detail
        });

    } catch (error) {
        console.error("Admin Get User Order Detail Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = { 
    getAllUsersAdmin, 
    searchUsersAdmin, 
    getUserDetailsAdmin, 
    toggleUserStatus, 
    deleteUserAdmin ,
    adminUnbanUser,
    adminGetBannedUsers,
    adminGetUnbanRequests,
    adminHandleUnbanAction,
    getUserOrdersAdmin,
    getUserOrderDetailAdmin
};