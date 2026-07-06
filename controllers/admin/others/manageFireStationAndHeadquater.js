const FireHQ = require('../../../models/FireHQ');
const FireStaff = require('../../../models/FireStaff');
const FireStation = require('../../../models/FireStation');
const bcrypt = require('bcryptjs');
 
// Helper function to extract image path from Multer (req.file or req.files)
const getImagePath = (req) => {
    if (req.file) return req.file.path;
    if (req.files) {
        if (req.files.profileImage && req.files.profileImage[0]) return req.files.profileImage[0].path;
        if (Array.isArray(req.files)) {
            const found = req.files.find(f => f.fieldname === 'profileImage');
            if (found) return found.path;
        }
    }
    return null;
};
 
// --- 1. HEADQUARTER (HQ) LOGIC ---
 
exports.adminCreateFireHQ = async (req, res) => {
    try {
        const { stationName, captainName, email, phone, password, lat, lng } = req.body;
        if (!stationName || !email || !password || !phone) return res.status(400).json({ success: false, message: "Required fields missing." });
 
        const exists = await FireHQ.findOne({ $or: [{ email }, { phone }] });
        if (exists) return res.status(400).json({ success: false, message: "HQ already exists." });
 
        const hashedPassword = await bcrypt.hash(password, 10);
        const profileImage = getImagePath(req);
 
        const newHQ = await FireHQ.create({
            ...req.body,
            password: hashedPassword,
            profileImage,
            location: { lat: Number(lat) || 30.7022, lng: Number(lng) || 76.7327 }
        });
 
        res.status(201).json({ success: true, data: newHQ });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
exports.getAllFireHQs = async (req, res) => {
    try {
        const hqs = await FireHQ.find().sort({ createdAt: -1 });
        res.json({ success: true, count: hqs.length, data: hqs });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
exports.updateFireHQ = async (req, res) => {
    try {
        const updates = { ...req.body };
        if (updates.password) updates.password = await bcrypt.hash(updates.password, 10);
        
        const newImage = getImagePath(req);
        if (newImage) updates.profileImage = newImage;
 
        const updatedHQ = await FireHQ.findByIdAndUpdate(req.params.id, updates, { new: true });
        if (!updatedHQ) return res.status(404).json({ message: "HQ not found" });
 
        res.json({ success: true, message: "HQ Updated", data: updatedHQ });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
// Soft Delete (Toggle isActive)
exports.toggleHQStatus = async (req, res) => {
    try {
        const hq = await FireHQ.findById(req.params.id);
        hq.isActive = !hq.isActive;
        await hq.save();
        res.json({ success: true, message: `HQ is now ${hq.isActive ? 'Active' : 'Inactive'}` });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};
 
exports.deleteFireHQ = async (req, res) => {
    try {
        const hq = await FireHQ.findByIdAndDelete(req.params.id);
        if (!hq) return res.status(404).json({ message: "HQ not found" });
 
        res.json({ success: true, message: "HQ Deleted" });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

 
// --- GET ALL FIRE STATIONS (With HQ Name) ---
exports.getAllFireStations = async (req, res) => {
    try {
        const { hqId, search } = req.query;
        let query = {};
 
        // 1. Filter by HQ if provided
        if (hqId) query.hqId = hqId;
 
        // 2. Search logic (Station Name or Code)
        if (search) {
            query.$or = [
                { stationName: { $regex: search, $options: 'i' } },
                { stationCode: { $regex: search, $options: 'i' } }
            ];
        }
 
        // 3. Fetch Stations with HQ Details
        // .populate('hqId', 'stationName') se sirf HQ ka naam aur ID aayegi
        const stations = await FireStation.find(query)
            .populate('hqId', 'stationName')
            .sort({ createdAt: -1 });
 
        res.json({
            success: true,
            count: stations.length,
            data: stations
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
 
exports.getAllFireStaff = async (req, res) => {
    try {
        const { stationId, search } = req.query;
        let query = {};
 
        if (stationId) query.stationId = stationId;
        if (search) {
            query.$or = [
                { fullName: { $regex: search, $options: 'i' } },
                { badgeId: { $regex: search, $options: 'i' } }
            ];
        }
 
        // Station ID se Station Name populate kar rahe hain
        const staff = await FireStaff.find(query)
            .populate('stationId', 'stationName')
            .sort({ createdAt: -1 });
 
        res.json({ success: true, count: staff.length, data: staff });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
 