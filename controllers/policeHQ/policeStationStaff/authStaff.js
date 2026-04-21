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

module.exports = { loginPoliceStaff, updatePoliceStaffProfile };