const PoliceHQ = require('../../../models/PoliceHQ');
const PoliceStation = require('../../../models/PoliceStation');
const PoliceStaff = require('../../../models/PoliceStaff');
const bcrypt = require('bcryptjs');
 
// Helper function to extract image path from Multer (req.file or req.files)
// Helper function to extract image path from Multer (Clean & Standardized)
const getImagePath = (req) => {
    let filePath = null;
 
    // 1. File path nikalna
    if (req.file) {
        filePath = req.file.path;
    } else if (req.files) {
        if (req.files.profileImage && req.files.profileImage[0]) {
            filePath = req.files.profileImage[0].path;
        } else if (Array.isArray(req.files)) {
            const found = req.files.find(f => f.fieldname === 'profileImage');
            if (found) filePath = found.path;
        }
    }
 
    if (!filePath) return null;
 
    // 2. 🚨 FIX: Windows ke backslashes (\) ko seedhe slashes (/) mein badalna
    filePath = filePath.replace(/\\/g, '/');
 
    // 3. 🚨 FIX: 'public' word ko URL se hatana
    if (filePath.startsWith('public/')) {
        filePath = filePath.replace('public/', '/');
    } else if (!filePath.startsWith('/')) {
        filePath = '/' + filePath;
    }
 
    return filePath;
};
 
 
// --- POLICE HEADQUARTER (HQ) CRUD ---
 
const adminCreatePoliceHQ = async (req, res) => {
    try {
        const { hqName, commissionerName, email, phone, password, lat, lng } = req.body;
       
        // 1. Validation
        if (!hqName || !commissionerName || !email || !phone || !password) {
            return res.status(400).json({ success: false, message: "Required fields missing (hqName, commissionerName, email, phone, password)." });
        }
 
        // 2. Duplicate Check
        const exists = await PoliceHQ.findOne({ $or: [{ email }, { phone }] });
        if (exists) return res.status(400).json({ success: false, message: "Police HQ with this email or phone already exists." });
 
        // 3. Password Hashing
        const hashedPassword = await bcrypt.hash(password, 10);
        const profileImage = getImagePath(req);
 
        // 4. Creation
        const newHQ = await PoliceHQ.create({
            ...req.body,
            password: hashedPassword,
            profileImage,
            location: {
                lat: Number(lat) || 0,
                lng: Number(lng) || 0
            }
        });
 
        res.status(201).json({ success: true, message: "Police HQ Created Successfully", data: newHQ });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
 
const getAllPoliceHQs = async (req, res) => {
    try {
        const hqs = await PoliceHQ.find().sort({ createdAt: -1 });
        res.json({ success: true, count: hqs.length, data: hqs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
 
const updatePoliceHQ = async (req, res) => {
    try {
        const updates = { ...req.body };
       
        // Agar password update ho raha hai
        if (updates.password) {
            updates.password = await bcrypt.hash(updates.password, 10);
        }
       
        // Image update logic
        const newImage = getImagePath(req);
        if (newImage) updates.profileImage = newImage;
 
        const updatedHQ = await PoliceHQ.findByIdAndUpdate(req.params.id, updates, { new: true });
       
        if (!updatedHQ) return res.status(404).json({ success: false, message: "Police HQ not found" });
 
        res.json({ success: true, message: "Police HQ Updated Successfully", data: updatedHQ });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
 
const togglePoliceHQStatus = async (req, res) => {
    try {
        const hq = await PoliceHQ.findById(req.params.id);
        if (!hq) return res.status(404).json({ success: false, message: "Police HQ not found" });
 
        hq.isActive = !hq.isActive;
        await hq.save();
 
        res.json({
            success: true,
            message: `Police HQ is now ${hq.isActive ? 'Active' : 'Inactive'}`
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
 
const getAllPoliceStations = async (req, res) => {
    try {
        const { hqId, search } = req.query;
        let query = {};
 
        if (hqId) query.hqId = hqId;
        if (search) {
            query.stationName = { $regex: search, $options: 'i' };
        }
 
        // HQ ID se HQ Name populate kar rahe hain
        const stations = await PoliceStation.find(query)
            .populate('hqId', 'hqName')
            .sort({ createdAt: -1 });
 
        res.json({ success: true, count: stations.length, data: stations });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
 
const getAllPoliceStaff = async (req, res) => {
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
        const staff = await PoliceStaff.find(query)
            .populate('stationId', 'stationName')
            .sort({ createdAt: -1 });
 
        res.json({ success: true, count: staff.length, data: staff });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
 
 
module.exports = {
    adminCreatePoliceHQ,
    getAllPoliceHQs,
    updatePoliceHQ,
    togglePoliceHQStatus,
    getAllPoliceStations,
    getAllPoliceStaff
};
 
 