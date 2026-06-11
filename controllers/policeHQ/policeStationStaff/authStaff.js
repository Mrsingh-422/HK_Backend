const PoliceStaff = require('../../../models/PoliceStaff');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { deleteFile } = require('../../../utils/fileHandler');

const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// 1. LOGIN POLICE STAFF
const loginPoliceStaff = async (req, res) => {
    try {
        const { email, password } = req.body; // Official email
        const staff = await PoliceStaff.findOne({ officialEmail: email }).select('+password');
        if (!staff || !(await bcrypt.compare(password, staff.password))) {
            return res.status(401).json({ message: "Invalid Official Credentials" });
        }
        const token = generateToken(staff._id, 'Police-Staff');
        staff.token = token;
        await staff.save();
        res.json({ success: true, token, data: staff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. UPDATE STAFF PROFILE
const updatePoliceStaffProfile = async (req, res) => {
    try {
        const id = req.user.id;
        const updates = req.body;
        const current = await PoliceStaff.findById(id);

        if (req.file) {
            if (current.profileImage) deleteFile(current.profileImage);
            updates.profileImage = req.file.path;
        }

        const updated = await PoliceStaff.findByIdAndUpdate(id, updates, { new: true });
        res.json({ success: true, message: "Police Staff Profile Updated", data: updated });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

/**
 * CHANGE PASSWORD (With Old/New/Confirm Validations)
 * Figma Link: Settings -> Change Password Modal (Image 13)
 */
const changePassword = async (req, res) => {
    try {
        const { oldPassword, newPassword, confirmPassword } = req.body;

        if (!oldPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({ success: false, message: "All password fields are required." });
        }

        // Figma Screen 13: Confirm password parity matching
        if (newPassword !== confirmPassword) {
            return res.status(400).json({ success: false, message: "New password and confirm password do not match." });
        }

        const staff = await PoliceStaff.findById(req.user.id).select('+password');
        
        const isMatch = await bcrypt.compare(oldPassword, staff.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Current password is wrong" });
        }

        staff.password = await bcrypt.hash(newPassword, 10);
        await staff.save();
        
        res.json({ success: true, message: "Password changed successfully" });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};
module.exports = { loginPoliceStaff, updatePoliceStaffProfile, changePassword };