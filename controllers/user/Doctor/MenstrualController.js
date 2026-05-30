const MenstrualTracker = require('../../../models/MenstrualTracker');
const PillReminder = require('../../../models/PillReminder');
const moment = require('moment');

// HELPER: Range ke beech ki saari tareekhein array me generate karne ke liye
const getDatesInRange = (startDate, endDate) => {
    const dates = [];
    let curr = moment(startDate).startOf('day');
    const last = moment(endDate).startOf('day');
    while (curr.isSameOrBefore(last)) {
        dates.push(curr.format('YYYY-MM-DD'));
        curr.add(1, 'days');
    }
    return dates;
};

// A. INIT / UPDATE BASIC SETTINGS (Cycle length aur average configuration)
const updatePeriodSettings = async (req, res) => {
    try {
        const { cycleLength, periodDuration } = req.body;
        const userId = req.user.id;

        let tracker = await MenstrualTracker.findOne({ userId });
        if (!tracker) {
            return res.status(404).json({ success: false, message: "Tracker not initialized. Log a period first." });
        }

        tracker.cycleLength = cycleLength || tracker.cycleLength;
        tracker.periodDuration = periodDuration || tracker.periodDuration;
        await tracker.save();

        res.json({ success: true, message: "Settings updated successfully", data: tracker });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// B. LOG NEW PERIOD START DATE (Screenshot 1: "Add" Button Logic)
const logNewPeriodDate = async (req, res) => {
    try {
        const { startDate } = req.body;
        const userId = req.user.id;

        if (!startDate) {
            return res.status(400).json({ success: false, message: "Start date is required" });
        }

        let tracker = await MenstrualTracker.findOne({ userId });
        const startMoment = moment(startDate).startOf('day');
        const duration = tracker ? tracker.periodDuration : 5;
        const endDate = moment(startMoment).add(duration - 1, 'days').toDate();

        const newPeriodObj = {
            startDate: startMoment.toDate(),
            endDate: endDate,
            duration: duration
        };

        if (!tracker) {
            tracker = await MenstrualTracker.create({
                userId,
                lastPeriodDate: startMoment.toDate(),
                periods: [newPeriodObj],
                periodDuration: duration,
                cycleLength: 28 // Default fallback for first entry
            });
        } else {
            const exists = tracker.periods.some(p => 
                moment(p.startDate).format('YYYY-MM-DD') === startMoment.format('YYYY-MM-DD')
            );
            
            if (exists) {
                return res.status(400).json({ success: false, message: "This period start date is already logged." });
            }

            tracker.periods.push(newPeriodObj);

            if (startMoment.isAfter(moment(tracker.lastPeriodDate))) {
                tracker.lastPeriodDate = startMoment.toDate();
            }

            // Recalculate gaps dynamically
            recalculateCycleMetrics(tracker);
            await tracker.save();
        }

        // Period supplement logic
        const existingReminder = await PillReminder.findOne({ userId, medicineName: "Period Care (Iron/Painkiller)" });
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

        res.json({ success: true, message: "New period start date logged successfully", data: tracker });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// C. GET OVERVIEW INSIGHTS (Screenshot 1: Core Dashboard Data)
const getPeriodInsights = async (req, res) => {
    try {
        const tracker = await MenstrualTracker.findOne({ userId: req.user.id });
        if (!tracker) return res.json({ success: true, data: null });

        // Next Period Date = Last Logged Date + Cycle Length
        const nextPeriod = moment(tracker.lastPeriodDate).add(tracker.cycleLength, 'days').startOf('day');
        const today = moment().startOf('day');
        const daysUntilNext = nextPeriod.diff(today, 'days');

        res.json({
            success: true,
            data: {
                cycleLength: tracker.cycleLength,
                periodDuration: tracker.periodDuration,
                lastPeriodDate: moment(tracker.lastPeriodDate).format('YYYY-MM-DD'),
                nextPeriodDate: nextPeriod.format('YYYY-MM-DD'),
                daysUntilNext: daysUntilNext >= 0 ? daysUntilNext : 0,
                regularity: tracker.regularity // "Regular cycle"
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// D. GET CALENDAR DAY HIGHLIGHTS (Screenshot 2: Month cell marking engine)
const getCalendarHighlights = async (req, res) => {
    try {
        const { month } = req.query; // Expects format: "YYYY-MM" (e.g. "2025-05")
        const tracker = await MenstrualTracker.findOne({ userId: req.user.id });
        
        if (!tracker || !month) {
            return res.json({ success: true, recordedPeriodDays: [], predictedPeriodDays: [] });
        }

        const requestedMonth = moment(month, 'YYYY-MM');
        const recordedPeriodDays = [];
        const predictedPeriodDays = [];

        // 1. LOGGED/ACTUAL DAYS GENERATION (Pink Dots for actual logs)
        tracker.periods.forEach(p => {
            const daysRange = getDatesInRange(p.startDate, p.endDate);
            daysRange.forEach(dateStr => {
                if (dateStr.startsWith(month)) {
                    recordedPeriodDays.push(dateStr);
                }
            });
        });

        // 2. PREDICTED DAYS GENERATION (Forward projections recursively)
        let currentProjectionStart = moment(tracker.lastPeriodDate);
        const projectionLimit = moment(requestedMonth).endOf('month').add(3, 'months'); // Safe boundary

        while (currentProjectionStart.isBefore(projectionLimit)) {
            currentProjectionStart.add(tracker.cycleLength, 'days');
            const predictedEnd = moment(currentProjectionStart).add(tracker.periodDuration - 1, 'days');

            const predictedRange = getDatesInRange(currentProjectionStart, predictedEnd);
            predictedRange.forEach(dateStr => {
                if (dateStr.startsWith(month)) {
                    predictedPeriodDays.push(dateStr);
                }
            });
        }

        // Response formatting for direct Flutter UI coloring mapping
        res.json({
            success: true,
            month,
            recordedPeriodDays, // Real bleeding days
            predictedPeriodDays // Future projections days
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// E. GET HISTORY LIST (Screenshot 3: Past Logged List Views)
const getPeriodHistory = async (req, res) => {
    try {
        const tracker = await MenstrualTracker.findOne({ userId: req.user.id });
        if (!tracker) {
            return res.json({ success: true, data: [] });
        }

        // Sort past logs with latest logged cycle first
        const sortedHistory = tracker.periods
            .map(p => ({
                startDate: moment(p.startDate).format('YYYY-MM-DD'),
                endDate: moment(p.endDate).format('YYYY-MM-DD'),
                duration: p.duration
            }))
            .sort((a, b) => new Date(b.startDate) - new Date(a.startDate));

        res.json({ success: true, data: sortedHistory });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// HELPER FUNCTION: Dynamic Cycle Length & Regularity calculate karne ke liye
const recalculateCycleMetrics = (tracker) => {
    if (!tracker.periods || tracker.periods.length < 2) {
        // Agar sirf 1 cycle logged hai, to default standard values par rakhein
        tracker.cycleLength = tracker.cycleLength || 28;
        tracker.regularity = "Regular cycle";
        return;
    }

    // 1. Periods ko ascending order (purane se naye) me sort karein
    const sortedPeriods = [...tracker.periods].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

    // 2. Gaps (difference) calculate karein
    const gaps = [];
    for (let i = 1; i < sortedPeriods.length; i++) {
        const currentStart = moment(sortedPeriods[i].startDate);
        const previousStart = moment(sortedPeriods[i-1].startDate);
        const diffInDays = currentStart.diff(previousStart, 'days');
        
        // Negative ya zero diffs ko ignore karne ke liye safety check
        if (diffInDays > 0) {
            gaps.push(diffInDays);
        }
    }

    if (gaps.length > 0) {
        // 3. Average Gap calculate karein
        const totalGapDays = gaps.reduce((sum, val) => sum + val, 0);
        const avgGap = Math.round(totalGapDays / gaps.length);
        
        // 4. cycleLength update karein (e.g. 29 days)
        tracker.cycleLength = avgGap;

        // 5. Standard Deviation se Regularity nikalna
        const variance = gaps.reduce((sum, val) => sum + Math.pow(val - avgGap, 2), 0) / gaps.length;
        const stdDev = Math.sqrt(variance);

        // Agar standard deviation 4 days se kam hai to regular, varna irregular
        tracker.regularity = stdDev < 4 ? "Regular cycle" : "Irregular cycle";
    }
};


// B. EDIT PERIOD LOG (With dynamic recalculation)
const editPeriodDate = async (req, res) => {
    try {
        const { oldStartDate, newStartDate } = req.body;
        const userId = req.user.id;

        const tracker = await MenstrualTracker.findOne({ userId });
        if (!tracker) return res.status(404).json({ success: false, message: "Tracker not found" });

        const periodIndex = tracker.periods.findIndex(p => 
            moment(p.startDate).format('YYYY-MM-DD') === moment(oldStartDate).format('YYYY-MM-DD')
        );

        if (periodIndex === -1) {
            return res.status(404).json({ success: false, message: "Logged period not found" });
        }

        const newStartMoment = moment(newStartDate).startOf('day');
        const duration = tracker.periodDuration;
        const newEndDate = moment(newStartMoment).add(duration - 1, 'days').toDate();

        tracker.periods[periodIndex].startDate = newStartMoment.toDate();
        tracker.periods[periodIndex].endDate = newEndDate;

        // Recalculate metrics based on edited date
        recalculateCycleMetrics(tracker);

        const sorted = [...tracker.periods].sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
        tracker.lastPeriodDate = sorted[0].startDate;

        await tracker.save();
        res.json({ success: true, message: "Logged period edited successfully", data: tracker });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// C. DELETE PERIOD LOG (With dynamic recalculation)
const deletePeriodDate = async (req, res) => {
    try {
        const { startDate } = req.body;
        const userId = req.user.id;
        
        const tracker = await MenstrualTracker.findOne({ userId });
        if (!tracker) return res.status(404).json({ success: false, message: "Tracker not found" });

        const originalLength = tracker.periods.length;
        tracker.periods = tracker.periods.filter(p => 
            moment(p.startDate).format('YYYY-MM-DD') !== moment(startDate).format('YYYY-MM-DD')
        );

        if (tracker.periods.length === originalLength) {
            return res.status(404).json({ success: false, message: "No logged period matches this date" });
        }

        // Recalculate metrics post deletion
        recalculateCycleMetrics(tracker);

        if (tracker.periods.length > 0) {
            const sorted = [...tracker.periods].sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
            tracker.lastPeriodDate = sorted[0].startDate;
        } else {
            tracker.lastPeriodDate = new Date();
        }

        await tracker.save();
        res.json({ success: true, message: "Logged period deleted successfully", data: tracker });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
module.exports = { 
    updatePeriodSettings, 
    logNewPeriodDate, 
    getPeriodInsights, 
    getCalendarHighlights,
    getPeriodHistory,
    deletePeriodDate,
    editPeriodDate
};