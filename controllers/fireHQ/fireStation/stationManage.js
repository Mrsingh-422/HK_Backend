const FireCase = require('../../../models/FireCase');
const FireStaff = require('../../../models/FireStaff');
const FireVehicle = require('../../../models/FireVehicle');
const bcrypt = require('bcryptjs');

// 1. STATION DASHBOARD STATS (Screen 2)
const getStationDashboard = async (req, res) => {
    try {
        const stationId = req.user.id;
        const newAlerts = await FireCase.countDocuments({ stationId, status: 'Fresh' });
        const ongoing = await FireCase.countDocuments({ stationId, status: 'Pending' });
        const resolved = await FireCase.countDocuments({ stationId, status: 'Closed' });

        res.json({
            success: true,
            data: { newAlerts, ongoing, resolved }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. INCIDENT MANAGEMENT (Screen 1 & 3)
// Get Fresh Cases
const getFreshCases = async (req, res) => {
    try {
        const cases = await FireCase.find({ stationId: req.user.id, status: 'Fresh' }).sort({ reportedAt: -1 });
        res.json({ success: true, data: cases });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Accept Case (Screen 1: Accept Case Button)
const acceptCase = async (req, res) => {
    try {
        const updatedCase = await FireCase.findByIdAndUpdate(
            req.params.id, 
            { status: 'Pending', dispatchedAt: Date.now() }, 
            { new: true }
        );
        res.json({ success: true, message: "Case Accepted. Team Dispatched.", data: updatedCase });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. STAFF MANAGEMENT (Screen 8 & 11)
const addStaff = async (req, res) => {
    try {
        const { fullName, badgeId, rank, mobileNumber, officialEmail, password, address } = req.body;
        
        const exists = await FireStaff.findOne({ $or: [{ badgeId }, { officialEmail }] });
        if (exists) return res.status(400).json({ message: "Staff with this Badge ID or Email already exists" });

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const staff = await FireStaff.create({
            stationId: req.user.id,
            hqId: req.user.hqId, // FireStation model se HQ ID leni hogi
            fullName, badgeId, rank, mobileNumber, officialEmail, address,
            password: hashedPassword
        });

        res.status(201).json({ success: true, message: "Staff Added Successfully", data: staff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getStaffList = async (req, res) => {
    try {
        const staff = await FireStaff.find({ stationId: req.user.id });
        res.json({ success: true, data: staff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. FLEET/EQUIPMENT MANAGEMENT (Screen 6)
const addVehicle = async (req, res) => {
    try {
        const vehicle = await FireVehicle.create({ ...req.body, stationId: req.user.id });
        res.status(201).json({ success: true, data: vehicle });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getFleetList = async (req, res) => {
    try {
        const vehicles = await FireVehicle.find({ stationId: req.user.id });
        res.json({ success: true, data: vehicles });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { getStationDashboard, getFreshCases, acceptCase, addStaff, getStaffList, addVehicle, getFleetList };