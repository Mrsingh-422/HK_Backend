const HealthData = require('../../../models/HealthData');
const moment = require('moment');

// 1. ADD HEALTH METRIC
// endpoint POST /user/health-records/add-metric
const addHealthMetric = async (req, res) => {
    try {
        const { type, value, notes, date } = req.body;
        
        // Auto-assign units based on type
        const units = {
            'Heart rate': 'bpm',
            'Blood Pressure': 'mmHg',
            'Weight': 'kg',
            'Sugar': 'mg/dL',
            'Steps': 'steps',
            'Calories': 'kcal'
        };

        const numericValue = parseFloat(value.split('/')[0]); // "120/80" -> 120

        const newData = await HealthData.create({
            userId: req.user.id,
            type,
            value,
            numericValue,
            unit: units[type] || '',
            note: notes,
            date: date || Date.now()
        });

        res.status(201).json({ success: true, message: "Metric added", data: newData });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. GET STATISTICS (Figma: Graph with Min/Max/Avg)
// endpoint GET /user/health-records/stats?type=Heart rate&period=weekly
const getHealthStats = async (req, res) => {
    try {
        const { type, period } = req.query; // period: daily, weekly, monthly
        let startDate = moment().startOf('day').subtract(period === 'monthly' ? 30 : 7, 'days').toDate();

        // MongoDB Aggregation for Min, Max, Avg
        const statsData = await HealthData.aggregate([
            { $match: { userId: req.user.id, type, date: { $gte: startDate } } },
            { $group: {
                _id: null,
                min: { $min: "$numericValue" },
                max: { $max: "$numericValue" },
                avg: { $avg: "$numericValue" },
                history: { $push: "$$ROOT" }
            }},
            { $project: { _id: 0, min: 1, max: 1, avg: { $round: ["$avg", 1] }, history: 1 } }
        ]);

        const result = statsData.length > 0 ? statsData[0] : { min: 0, max: 0, avg: 0, history: [] };

        res.json({ success: true, period, type, ...result });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. GET LATEST SUMMARY (Figma Dashboard with % Change)
// endpoint GET /user/health-records/summary
const getDashboardSummary = async (req, res) => {
    try {
        const types = ['Heart rate', 'Steps', 'Calories', 'Blood Pressure'];
        let summary = {};

        // Calculate Weekly Progress for Steps (Example of Figma "+12% vs last week")
        const currentWeekSteps = await HealthData.aggregate([
            { $match: { userId: req.user.id, type: 'Steps', date: { $gte: moment().startOf('week').toDate() } } },
            { $group: { _id: null, total: { $sum: "$numericValue" } } }
        ]);

        const lastWeekSteps = await HealthData.aggregate([
            { $match: { 
                userId: req.user.id, 
                type: 'Steps', 
                date: { 
                    $gte: moment().subtract(1, 'weeks').startOf('week').toDate(),
                    $lte: moment().subtract(1, 'weeks').endOf('week').toDate()
                } 
            }},
            { $group: { _id: null, total: { $sum: "$numericValue" } } }
        ]);

        const curr = currentWeekSteps[0]?.total || 0;
        const prev = lastWeekSteps[0]?.total || 0;
        const progress = prev === 0 ? 0 : (((curr - prev) / prev) * 100).toFixed(1);

        // Get Latest Readings
        for (let type of types) {
            const latest = await HealthData.findOne({ userId: req.user.id, type }).sort({ date: -1 });
            summary[type] = latest;
        }

        res.json({ 
            success: true, 
            healthScore: 82, // Mock score as per Figma
            weeklyProgress: `${progress > 0 ? '+' : ''}${progress}%`,
            data: summary 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 4. GET FULL HISTORY (Pagination for History List)
const getHealthHistory = async (req, res) => {
    try {
        const { page = 1, limit = 15, type } = req.query;
        let query = { userId: req.user.id };
        if (type) query.type = type;

        const history = await HealthData.find(query)
            .sort({ date: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        res.json({ success: true, data: history });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    addHealthMetric, 
    getHealthStats, 
    getDashboardSummary, 
    getHealthHistory 
};