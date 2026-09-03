const User = require('../../../models/User');
const UnbanRequest = require('../../../models/UnbanRequest');

// Helper function: Data ko transform karne ke liye (Exact Keys as requested)
const transformUserData = (user) => ({
    id: user._id,
    name: user.name || "",
    email: user.email || "",
    number: user.phone || "",
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

// 4. TOGGLE USER STATUS
const toggleUserStatus = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: "User not found" });

        user.profileStatus = user.profileStatus === 'Approved' ? 'Blocked' : 'Approved';
        await user.save();

        res.json({ success: true, message: `User is now ${user.profileStatus}`, status: user.profileStatus });
    } catch (error) {
        res.status(500).json({ message: error.message });
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


module.exports = { 
    getAllUsersAdmin, 
    searchUsersAdmin, 
    getUserDetailsAdmin, 
    toggleUserStatus, 
    deleteUserAdmin ,
    adminUnbanUser,
    adminGetBannedUsers,
    adminGetUnbanRequests,
    adminHandleUnbanAction
};