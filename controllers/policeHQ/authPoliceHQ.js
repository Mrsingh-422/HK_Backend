const PoliceHQ = require('../../models/PoliceHQ');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { deleteFile } = require('../../utils/fileHandler');

const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// 1. REGISTER POLICE HQ
const registerPoliceHQ = async (req, res) => {
    try {
        const { hqName, commissionerName, email, phone, password, country, state, city, address, lat, lng } = req.body;
        const exists = await PoliceHQ.findOne({ $or: [{ email }, { phone }] });
        if (exists) return res.status(400).json({ message: "Police HQ already exists" });

        const hashedPassword = await bcrypt.hash(password, 10);
        await PoliceHQ.create({
            hqName, commissionerName, email, phone, country, state, city, address,
            location: { lat, lng },
            password: hashedPassword
        });
        res.status(201).json({ success: true, message: "Police HQ Registered Successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. LOGIN POLICE HQ
const loginPoliceHQ = async (req, res) => {
    try {
        const { email, password } = req.body;
        const hq = await PoliceHQ.findOne({ email }).select('+password');
        if (!hq || !(await bcrypt.compare(password, hq.password))) {
            return res.status(401).json({ message: "Invalid credentials" });
        }
        const token = generateToken(hq._id, 'Police-HQ');
        hq.token = token;
        await hq.save();
        res.json({ success: true, token, data: hq });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. UPDATE HQ PROFILE
const updatePoliceHQProfile = async (req, res) => {
    try {
        const id = req.user.id;
        const updates = req.body;
        const current = await PoliceHQ.findById(id);

        if (req.files && req.files.profileImage) {
            if (current.profileImage) deleteFile(current.profileImage);
            updates.profileImage = req.files.profileImage[0].path;
        }

        const updated = await PoliceHQ.findByIdAndUpdate(id, updates, { new: true });
        res.json({ success: true, message: "Profile Updated", data: updated });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { registerPoliceHQ, loginPoliceHQ, updatePoliceHQProfile };