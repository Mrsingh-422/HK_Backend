const FireStation = require('../../../models/FireStation');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { deleteFile } = require('../../../utils/fileHandler');

const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// 1. LOGIN STATION
const loginStation = async (req, res) => {
    try {
        const { email, password } = req.body;
        const station = await FireStation.findOne({ email }).select('+password');
        if (!station || !(await bcrypt.compare(password, station.password))) {
            return res.status(401).json({ message: "Invalid Station Credentials" });
        }
        const token = generateToken(station._id, 'Fire-Station');
        station.token = token;
        await station.save();
        res.json({ success: true, token, data: station });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. UPDATE PROFILE (Logic for deleteFile added)
const updateStationProfile = async (req, res) => {
    try {
        const stationId = req.user.id;
        const updates = req.body;
        const currentStation = await FireStation.findById(stationId);
        
        if (!currentStation) return res.status(404).json({ message: "Station not found" });

        if (req.file) {
            if (currentStation.profileImage) deleteFile(currentStation.profileImage);
            updates.profileImage = req.file.path;
        }

        const station = await FireStation.findByIdAndUpdate(stationId, updates, { new: true });
        res.json({ success: true, message: "Station Profile Updated", data: station });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
const getStationProfile = async (req, res) => {
    try {
        // req.user.id auth middleware se milta hai
        const stationId = req.user.id;
 
        const station = await FireStation.findById(stationId).populate('hqId', 'hqName email');
 
        if (!station) {
            return res.status(404).json({
                success: false,
                message: "Station not found"
            });
        }
 
        res.status(200).json({
            success: true,
            data: station
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};
const changePassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const stationId = req.user.id;
        const station = await FireStation.findById(stationId).select('+password');
 
        if (!station) {
            return res.status(404).json({ success: false, message: "Station not found" });
        }
 
       
        const isMatch = await bcrypt.compare(oldPassword, station.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: "Old password is incorrect" });
        }
 
 
        const salt = await bcrypt.genSalt(10);
        station.password = await bcrypt.hash(newPassword, salt);
 
       
        station.token = null;
 
        await station.save();
 
        res.json({ success: true, message: "Password updated successfully. Please login again." });
 
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { loginStation, updateStationProfile, getStationProfile, changePassword };