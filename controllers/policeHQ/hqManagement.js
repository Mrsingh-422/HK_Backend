const PoliceStation = require('../../models/PoliceStation');
const PoliceCase = require('../../models/PoliceCase');
const bcrypt = require('bcryptjs');
const PoliceHQ = require('../../models/PoliceHQ');

// 1. GET HQ DASHBOARD (Screen 3)
const getHQDashboard = async (req, res) => {
    try {
        const hqId = req.user.id;
        
        const fresh = await PoliceCase.countDocuments({ hqId, status: 'Fresh' });
        const pending = await PoliceCase.countDocuments({ hqId, status: 'Under Investigation' });
        const history = await PoliceCase.countDocuments({ hqId, status: { $in: ['Closed', 'Archived'] } });

        res.json({
            success: true,
            data: { freshCases: fresh, pendingCases: pending, historyCases: history }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. CREATE POLICE STATION (HQ Action)
const createStation = async (req, res) => {
    try {
        const { stationName, stationCode, shoName, email, phone, password, address, jurisdictionArea } = req.body;
        
        const exists = await PoliceStation.findOne({ $or: [{ email }, { stationCode }] });
        if (exists) return res.status(400).json({ message: "Station Code or Email already exists" });

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const station = await PoliceStation.create({
            hqId: req.user.id,
            stationName, stationCode, shoName, email, phone, address, jurisdictionArea,
            password: hashedPassword
        });

        res.status(201).json({ success: true, message: "Police Station Created", data: station });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. LIST ALL STATIONS UNDER HQ (Screen 4)
const listMyStations = async (req, res) => {
    try {
        const stations = await PoliceStation.find({ hqId: req.user.id });
        res.json({ success: true, data: stations });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. GET GLOBAL CASE HISTORY (Screen 5/11)
const getGlobalHistory = async (req, res) => {
    try {
        const { status, search } = req.query;
        let query = { hqId: req.user.id };

        if (status && status !== 'All') query.status = status;
        if (search) {
            query.$or = [
                { caseNo: new RegExp(search, 'i') },
                { address: new RegExp(search, 'i') }
            ];
        }

        const cases = await PoliceCase.find(query).populate('stationId', 'stationName').sort({ createdAt: -1 });
        res.json({ success: true, data: cases });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 5. CHANGE PASSWORD (Screen 15 Settings)
const changePasswordHQ = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const hq = await PoliceHQ.findById(req.user.id).select('+password');

        const isMatch = await bcrypt.compare(oldPassword, hq.password);
        if (!isMatch) return res.status(400).json({ message: "Current password is wrong" });

        hq.password = await bcrypt.hash(newPassword, 10);
        await hq.save();

        res.json({ success: true, message: "Password updated successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
module.exports = { getHQDashboard, createStation, listMyStations, getGlobalHistory, changePasswordHQ };