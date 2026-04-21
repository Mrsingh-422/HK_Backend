const FireStaff = require('../../../models/FireStaff');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { deleteFile } = require('../../../utils/fileHandler');

const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// 1. LOGIN STAFF
const loginStaff = async (req, res) => {
    try {
        const { email, password } = req.body;
        const staff = await FireStaff.findOne({ officialEmail: email }).select('+password');
        if (!staff || !(await bcrypt.compare(password, staff.password))) {
            return res.status(401).json({ message: "Invalid Official Credentials" });
        }
        const token = generateToken(staff._id, 'Fire-Staff');
        staff.token = token;
        await staff.save();
        res.json({ success: true, token, data: staff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. UPDATE STAFF PROFILE
const updateStaffProfile = async (req, res) => {
    try {
        const staffId = req.user.id;
        const updates = req.body;
        const currentStaff = await FireStaff.findById(staffId);
        
        if (!currentStaff) return res.status(404).json({ message: "Staff not found" });

        if (req.file) {
            if (currentStaff.profileImage) deleteFile(currentStaff.profileImage);
            updates.profileImage = req.file.path;
        }

        const updatedStaff = await FireStaff.findByIdAndUpdate(staffId, updates, { new: true });
        res.json({ success: true, message: "Staff Profile Updated", data: updatedStaff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { loginStaff, updateStaffProfile };