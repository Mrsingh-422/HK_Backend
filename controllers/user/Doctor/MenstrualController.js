const MenstrualTracker = require('../../../models/MenstrualTracker');
const PillReminder = require('../../../models/PillReminder');
const moment = require('moment');

// 1. Add/Update Period Data
const updatePeriodData = async (req, res) => {
    try {
        const { lastPeriodDate, cycleLength, periodDuration } = req.body;
        const userId = req.user.id;

        // 1. Update Tracker
        let tracker = await MenstrualTracker.findOne({ userId });
        if (!tracker) {
            tracker = await MenstrualTracker.create({ userId, lastPeriodDate, cycleLength, periodDuration });
        } else {
            tracker.lastPeriodDate = lastPeriodDate;
            tracker.cycleLength = cycleLength;
            tracker.periodDuration = periodDuration;
            await tracker.save();
        }

        // 2. AUTO-CREATE PERIOD SUPPLEMENT REMINDER
        // Check if a reminder for "Period Care" already exists
        const existingReminder = await PillReminder.findOne({ 
            userId, 
            medicineName: "Period Care (Iron/Painkiller)" 
        });

        if (!existingReminder) {
            await PillReminder.create({
                userId,
                medicineName: "Period Care (Iron/Painkiller)",
                dosage: "1 Tablet",
                frequency: "Daily",
                times: [{ time: "09:00 AM", isTakenToday: false }],
                startDate: new Date(),
                notes: "Auto-generated for period support",
                status: 'Active'
            });
        }

        res.json({ success: true, message: "Period data saved and supplements activated", data: tracker });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. Get Insights (Prediction Logic)
const getPeriodInsights = async (req, res) => {
    try {
        const tracker = await MenstrualTracker.findOne({ userId: req.user.id });
        if (!tracker) return res.json({ success: true, data: null });

        // Prediction: Next Period Date = Last + Cycle Length
        const nextPeriod = moment(tracker.lastPeriodDate).add(tracker.cycleLength, 'days');
        const isNear = moment().diff(nextPeriod, 'days') > -3; // 3 din pehle notice

        res.json({
            success: true,
            data: {
                ...tracker._doc,
                nextPeriodDate: nextPeriod.format('YYYY-MM-DD'),
                daysUntilNext: moment(nextPeriod).diff(moment(), 'days'),
                isNear
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
module.exports = { updatePeriodData, getPeriodInsights };