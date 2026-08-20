const HealthData = require('../../../models/HealthData');
const moment = require('moment');
const mongoose = require('mongoose'); // Secured import for Type Casting

// 1. ADD HEALTH PARAMETER (Optional Heart Rate handling added for BP)
const addHealthMetric = async (req, res) => {
    try {
        const { type, value, notes, date, heartRate } = req.body;
        
        const units = {
            'Heart rate': 'bpm',
            'Blood Pressure': 'mmHg',
            'Weight': 'kg',
            'Sugar': 'mg/dL',
            'Steps': 'steps',
            'Calories': 'kcal'
        };

        // 🚀 SYNC FIX: Safe string conversion before split
        const rawStringValue = value !== undefined && value !== null ? String(value) : "0";
        const numericValue = parseFloat(rawStringValue.split('/')[0]) || 0;

        const newData = await HealthData.create({
            userId: req.user.id,
            type,
            value: rawStringValue,
            numericValue,
            unit: units[type] || '',
            note: notes || '',
            date: date || new Date()
        });

        if (type === 'Blood Pressure' && heartRate) {
            await HealthData.create({
                userId: req.user.id,
                type: 'Heart rate',
                value: `${heartRate}`,
                numericValue: parseFloat(heartRate) || 0,
                unit: 'bpm',
                note: 'Logged during Blood Pressure check',
                date: date || new Date()
            });
        }

        res.status(201).json({ success: true, message: "Metric logged successfully", data: newData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// 2. GET STATISTICS (Casting bug completely fixed here)
const getHealthStats = async (req, res) => {
    try {
        const { type, period } = req.query; // period: daily, weekly, monthly
        let startDate = moment().startOf('day').subtract(period === 'monthly' ? 30 : 7, 'days').toDate();

        // Security & Casting Fix: Convert req.user.id string to mongoose ObjectId for Aggregation Pipeline
        const userIdObj = new mongoose.Types.ObjectId(req.user.id);

        // MongoDB Aggregation for Min, Max, Avg
        const statsData = await HealthData.aggregate([
            { $match: { userId: userIdObj, type, date: { $gte: startDate } } },
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

        // History descending order arrangement
        if (result.history) {
            result.history.sort((a, b) => new Date(b.date) - new Date(a.date));
        }

        res.json({ success: true, period, type, ...result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. GET DASHBOARD SUMMARY (Casting bug also resolved here for aggregate)
const getDashboardSummary = async (req, res) => {
    try {
        const types = ['Heart rate', 'Steps', 'Calories', 'Blood Pressure'];
        let summary = {};
        const todayStart = moment().startOf('day').toDate();

        // Casting Fix: string userId to ObjectId
        const userIdObj = new mongoose.Types.ObjectId(req.user.id);

        // Calculate Weekly steps progress vs last week
        const currentWeekSteps = await HealthData.aggregate([
            { $match: { userId: userIdObj, type: 'Steps', date: { $gte: moment().startOf('week').toDate() } } },
            { $group: { _id: null, total: { $sum: "$numericValue" } } }
        ]);

        const lastWeekSteps = await HealthData.aggregate([
            { $match: { 
                userId: userIdObj, 
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

        // Fetch latest reading for each parameter type
        for (let type of types) {
            const latest = await HealthData.findOne({ userId: req.user.id, type }).sort({ date: -1 });
            summary[type] = latest;
        }

        // Today's Activity Calculations
        const todayStepsDocs = await HealthData.find({ userId: req.user.id, type: 'Steps', date: { $gte: todayStart } });
        const todayCalDocs = await HealthData.find({ userId: req.user.id, type: 'Calories', date: { $gte: todayStart } });
        const todayHRDocs = await HealthData.find({ userId: req.user.id, type: 'Heart rate', date: { $gte: todayStart } });

        const stepsSum = todayStepsDocs.reduce((sum, doc) => sum + (doc.numericValue || 0), 0);
        const caloriesSum = todayCalDocs.reduce((sum, doc) => sum + (doc.numericValue || 0), 0);
        
        let avgHR = 0;
        if (todayHRDocs.length > 0) {
            const hrSum = todayHRDocs.reduce((sum, doc) => sum + (doc.numericValue || 0), 0);
            avgHR = Math.round(hrSum / todayHRDocs.length);
        }

        res.json({ 
            success: true, 
            healthScore: 82, 
            weeklyProgress: `${progress > 0 ? '+' : ''}${progress}%`,
            todayActivity: {
                stepsWalked: stepsSum,
                caloriesBurned: caloriesSum,
                avgHeartRate: avgHR || (summary['Heart rate'] ? parseFloat(summary['Heart rate'].value) : 0),
                activeMinutes: Math.round(stepsSum / 180) // Dynamic conversion ratio
            },
            data: summary 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. GET PARAMETERS LOG LIST
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
        res.status(500).json({ success: false, message: error.message });
    }
};

// 5. SAVE NEW MEAL INTAKE RECORD
const addMeal = async (req, res) => {
    try {
        const { mealType, items } = req.body; 
        const totalKcal = items.reduce((sum, item) => sum + (item.kcal * item.qty), 0);

        const mealData = await HealthData.create({
            userId: req.user.id,
            type: 'Calories',
            value: `${totalKcal} kcal`,
            numericValue: totalKcal,
            unit: 'kcal',
            note: JSON.stringify({ mealType, items }),
            date: new Date()
        });

        res.status(201).json({ success: true, message: "Meal added", data: mealData });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 6. MEALS BREAKDOWNS
const getCalorieBreakdown = async (req, res) => {
    try {
        const today = moment().startOf('day').toDate();
        const records = await HealthData.find({
            userId: req.user.id,
            type: 'Calories',
            date: { $gte: today }
        });

        let breakdown = { Breakfast: 0, Lunch: 0, Dinner: 0, Snacks: 0 };
        let totalConsumed = 0;

        records.forEach(r => {
            try {
                const details = JSON.parse(r.note);
                if (breakdown[details.mealType] !== undefined) {
                    breakdown[details.mealType] += r.numericValue;
                    totalConsumed += r.numericValue;
                }
            } catch (e) { 
                totalConsumed += r.numericValue; 
            }
        });

        res.json({
            success: true,
            data: {
                totalConsumed,
                goal: 2000,
                percentage: Math.round((totalConsumed / 2000) * 100),
                breakdown,
                activityBurn: { walking: 120, running: 350, workout: 210 }
            }
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

module.exports = { 
    addHealthMetric, 
    getHealthStats, 
    getDashboardSummary, 
    getHealthHistory,
    addMeal,
    getCalorieBreakdown
};