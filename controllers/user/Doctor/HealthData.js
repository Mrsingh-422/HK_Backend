const HealthData = require('../../../models/HealthData');
const moment = require('moment'); // Time handling ke liye useful hai


// 1. ADD HEALTH METRIC
// endpoint POST /user/health-records/add-metric
const addHealthMetric = async (req, res) => {
    try {
        const { type, value, notes, date } = req.body;
        
        // Basic Validation
        if(!type || !value) return res.status(400).json({ message: "Type and Value are required" });

        const newData = await HealthData.create({
            userId: req.user.id,
            type, 
            value, 
            note: notes, 
            date: date || Date.now()
        });
        res.status(201).json({ success: true, message: "Metric added", data: newData });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. GET LATEST METRICS (For Home Dashboard)
// Har type (Heart Rate, BP, etc.) ki sabse latest reading nikalne ke liye
// endpoint GET /user/health-records/latest
const getLatestMetrics = async (req, res) => {
    try {
        const types = ['Heart rate', 'Blood Pressure', 'Weight', 'Sugar'];
        let latestData = {};

        for (let type of types) {
            const record = await HealthData.findOne({ userId: req.user.id, type })
                .sort({ date: -1 });
            latestData[type] = record;
        }

        res.json({ success: true, data: latestData });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. GET STATISTICS (For Figma Graphs: Daily/Weekly/Monthly)
// endpoint GET /user/health-records/stats?type=Heart rate&period=weekly
const getHealthStats = async (req, res) => {
    try {
        const { type, period } = req.query; // period: daily, weekly, monthly
        let startDate = moment().startOf('day');

        if (period === 'weekly') startDate = moment().subtract(7, 'days');
        else if (period === 'monthly') startDate = moment().subtract(30, 'days');

        const stats = await HealthData.find({
            userId: req.user.id,
            type: type,
            date: { $gte: startDate.toDate() }
        }).sort({ date: 1 });

        res.json({ success: true, period, data: stats });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 4. GET FULL HISTORY (With Pagination)
// endpoint GET /user/health-records/history?page=1&limit=20
const getHealthHistory = async (req, res) => {
    try {
        const { page = 1, limit = 20, type } = req.query;
        const query = { userId: req.user.id };
        if (type) query.type = type;

        const history = await HealthData.find(query)
            .sort({ date: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        res.json({ success: true, count: history.length, data: history });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 5. DELETE A RECORD
// endpoint DELETE /user/health-records/delete/:id
const deleteHealthRecord = async (req, res) => {
    try {
        await HealthData.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
        res.json({ success: true, message: "Record deleted" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    addHealthMetric, 
    getLatestMetrics, 
    getHealthStats, 
    getHealthHistory,
    deleteHealthRecord 
};