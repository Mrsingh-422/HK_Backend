const FireHQ = require('../../models/FireHQ');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { deleteFile } = require('../../utils/fileHandler');

// Updated Token Generator
const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// 1. REGISTER HQ
const registerHQ = async (req, res) => {
    try {
        const { stationName, email, phone, password, captainName, state, city } = req.body;
        const exists = await FireHQ.findOne({ $or: [{ email }, { phone }] });
        if (exists) return res.status(400).json({ message: "HQ already exists" });

        const hashedPassword = await bcrypt.hash(password, 10);
        await FireHQ.create({
            stationName, captainName, email, phone, state, city,
            password: hashedPassword
        });
        res.status(201).json({ success: true, message: "HQ Registered Successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. LOGIN HQ
const loginHQ = async (req, res) => {
    try {
        const { email, password } = req.body;
        const hq = await FireHQ.findOne({ email }).select('+password');
        if (!hq || !(await bcrypt.compare(password, hq.password))) {
            return res.status(401).json({ message: "Invalid credentials" });
        }
        const token = generateToken(hq._id, 'Fire-HQ');
        hq.token = token;
        await hq.save();
        res.json({ success: true, token, data: hq });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. UPDATE HQ PROFILE (Added File Deletion Logic)
const updateHQProfile = async (req, res) => {
    try {
        const hqId = req.user.id;
        const updates = req.body;
        const currentHQ = await FireHQ.findById(hqId);
        if (!currentHQ) return res.status(404).json({ message: "HQ not found" });

        if (req.file) {
            if (currentHQ.profileImage) deleteFile(currentHQ.profileImage);
            updates.profileImage = req.file.path;
        }

        const updatedHQ = await FireHQ.findByIdAndUpdate(hqId, updates, { new: true });
        res.json({ success: true, message: "HQ Profile Updated", data: updatedHQ });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const changePassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const hq = await FireHQ.findById(req.user.id).select('+password');

        const isMatch = await bcrypt.compare(oldPassword, hq.password);
        if (!isMatch) return res.status(400).json({ message: "Old password does not match" });

        hq.password = await bcrypt.hash(newPassword, 10);
        await hq.save();

        res.json({ success: true, message: "Password updated successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Forgot & Reset same rahenge (Bas token gen update ho gaya hai)
module.exports = { registerHQ, loginHQ, updateHQProfile, changePassword };