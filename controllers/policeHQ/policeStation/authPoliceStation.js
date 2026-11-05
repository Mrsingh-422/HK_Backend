const PoliceStation = require('../../../models/PoliceStation');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { deleteFile } = require('../../../utils/fileHandler');

const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// 1. LOGIN POLICE STATION
const loginPoliceStation = async (req, res) => {
    try {
        const { email, password } = req.body;
        const station = await PoliceStation.findOne({ email }).select('+password');
        if (!station || !(await bcrypt.compare(password, station.password))) {
            return res.status(401).json({ message: "Invalid Station Credentials" });
        }
        const token = generateToken(station._id, 'Police-Station');
        station.token = token;
        await station.save();
        res.json({ success: true, token, data: station });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. UPDATE STATION PROFILE (Null-Safe)
const updatePoliceStationProfile = async (req, res) => {
    try {
        const id = req.user.id;
        const updates = { ...req.body };
        const current = await PoliceStation.findById(id);

        if (!current) {
            return res.status(404).json({ success: false, message: "Police Station not found" });
        }

        if (req.files && req.files.profileImage && req.files.profileImage[0]) {
            if (current.profileImage) deleteFile(current.profileImage);
            updates.profileImage = req.files.profileImage[0].path.replace(/\\/g, "/");
        } else if (req.file) {
            if (current.profileImage) deleteFile(current.profileImage);
            updates.profileImage = req.file.path.replace(/\\/g, "/");
        }

        const updated = await PoliceStation.findByIdAndUpdate(id, { $set: updates }, { new: true });
        res.json({ success: true, data: updated });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

module.exports = { loginPoliceStation, updatePoliceStationProfile };