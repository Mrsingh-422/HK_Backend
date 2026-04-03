const User = require('../../../models/User');

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

module.exports = { 
    getAllUsersAdmin, 
    searchUsersAdmin, 
    getUserDetailsAdmin, 
    toggleUserStatus, 
    deleteUserAdmin 
};