const PillReminder = require('../../../models/PillReminder');
const moment = require('moment');

// HELPER: Gaps/Streak calculate karne ka dynamic function
const calculateStreak = (history) => {
    if (!history || history.length === 0) return 0;
    const takenDates = [...new Set(
        history
            .filter(h => h.action === 'Taken')
            .map(h => h.date)
    )].sort((a, b) => new Date(b) - new Date(a));

    if (takenDates.length === 0) return 0;

    let streak = 0;
    let expectedDate = moment().startOf('day');

    const latestLogDate = moment(takenDates[0], 'YYYY-MM-DD');
    const diffFromToday = expectedDate.diff(latestLogDate, 'days');
    
    if (diffFromToday > 1) {
        return 0; // Streak broken
    }

    expectedDate = latestLogDate;
    for (let i = 0; i < takenDates.length; i++) {
        const logDate = moment(takenDates[i], 'YYYY-MM-DD');
        if (expectedDate.isSame(logDate, 'day')) {
            streak++;
            expectedDate.subtract(1, 'days');
        } else {
            break; 
        }
    }
    return streak;
};

// HELPER: Dynamic Course Progress parser (Elapsed vs remaining days)
const enrichPillWithProgress = (pill) => {
    const pillObj = pill.toObject();
    
    if (!pillObj.startDate) {
        pillObj.progressPct = 0;
        pillObj.elapsedDays = 0;
        pillObj.totalCourseDays = null;
        pillObj.daysRemaining = null;
        pillObj.isOngoing = true;
        return pillObj;
    }

    const start = moment(pillObj.startDate).startOf('day');
    const today = moment().startOf('day');

    if (!pillObj.endDate) {
        pillObj.isOngoing = true;
        pillObj.totalCourseDays = null;
        pillObj.elapsedDays = today.diff(start, 'days') + 1;
        pillObj.progressPct = 100; 
        pillObj.daysRemaining = null;
    } else {
        const end = moment(pillObj.endDate).endOf('day');
        const totalDays = end.diff(start, 'days') + 1;
        let elapsed = today.diff(start, 'days') + 1;

        if (elapsed < 1) elapsed = 1;
        if (elapsed > totalDays) elapsed = totalDays; 

        pillObj.isOngoing = false;
        pillObj.totalCourseDays = totalDays;
        pillObj.elapsedDays = elapsed;
        pillObj.progressPct = Math.round((elapsed / totalDays) * 100);
        pillObj.daysRemaining = totalDays - elapsed >= 0 ? totalDays - elapsed : 0;
    }

    return pillObj;
};

// 💡 NEW HELPER: Relative duration strings (7 days, 14 days, No end date) ko valid JS Date object me parse karne ke liye
const parseEndDate = (startDate, endDate) => {
    if (!endDate || endDate === "No end date" || endDate === "null" || endDate === "") {
        return null;
    }

    // Agar value "7 days" jaisi string hai, to use parse karke dynamic date calculate karein
    if (typeof endDate === 'string' && endDate.includes('days')) {
        const daysNum = parseInt(endDate.split(' ')[0]);
        if (!isNaN(daysNum)) {
            // startDate + daysNum - 1 day (Inclusive limit: e.g., June 1st start + 7 days means end is June 7th)
            return moment(startDate).add(daysNum - 1, 'days').endOf('day').toDate();
        }
    }

    // Standard date parsing safety check
    const parsedDate = moment(endDate);
    return parsedDate.isValid() ? parsedDate.toDate() : null;
};

// 1. ADD PILL (Relative course limit conversions applied)
const addPill = async (req, res) => {
    try {
        const { medicineName, dosage, times, frequency, daysOfWeek, startDate, endDate, notes } = req.body;
        const formattedTimes = times.map(t => ({ time: t, isTakenToday: false }));

        // Standardise input start date formatting safely
        const finalStartDate = startDate ? moment(startDate).toDate() : new Date();
        const finalEndDate = parseEndDate(finalStartDate, endDate); // Calculates dynamic date object

        const pill = await PillReminder.create({
            userId: req.user.id,
            medicineName, 
            dosage, 
            times: formattedTimes, 
            frequency, 
            daysOfWeek, 
            startDate: finalStartDate, 
            endDate: finalEndDate, 
            notes
        });
        
        res.status(201).json({ success: true, message: "Medication reminder set", data: enrichPillWithProgress(pill) });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. GET TODAY'S SCHEDULE (With Dynamic Statistics Aggregation)
const getTodaySchedule = async (req, res) => {
    try {
        const todayStr = req.query.clientDate || moment().format('YYYY-MM-DD');
        const dayNum = req.query.clientDay !== undefined ? parseInt(req.query.clientDay) : moment().day();

        let pills = await PillReminder.find({
            userId: req.user.id,
            status: 'Active',
            startDate: { $lte: new Date() },
            $or: [{ frequency: 'Daily' }, { daysOfWeek: dayNum }]
        });

        for (let pill of pills) {
            let needsSave = false;
            pill.times.forEach(t => {
                const alreadyRecorded = pill.history.some(
                    h => h.date === todayStr && h.time === t.time && h.action === 'Taken'
                );
                
                if (!alreadyRecorded && t.isTakenToday) {
                    t.isTakenToday = false; 
                    needsSave = true;
                }
            });
            if (needsSave) {
                await pill.save();
            }
        }

        const allPills = await PillReminder.find({ userId: req.user.id });
        let overallHistory = [];
        allPills.forEach(p => {
            if (p.history) overallHistory.push(...p.history);
        });

        let totalDosesToday = 0;
        let takenDosesToday = 0;
        pills.forEach(p => {
            p.times.forEach(t => {
                totalDosesToday++;
                if (t.isTakenToday) takenDosesToday++;
            });
        });

        const streak = calculateStreak(overallHistory);
        const totalDosesTakenOverall = overallHistory.filter(h => h.action === 'Taken').length;
        const upcomingCount = totalDosesToday - takenDosesToday;

        const enrichedPills = pills.map(p => enrichPillWithProgress(p));

        res.json({ 
            success: true, 
            progressRatio: `${takenDosesToday} / ${totalDosesToday}`,
            progressPercentage: totalDosesToday > 0 ? Math.round((takenDosesToday / totalDosesToday) * 100) : 0,
            streak: streak || 0,
            totalDosesTakenOverall: totalDosesTakenOverall || 0,
            upcomingCount: upcomingCount >= 0 ? upcomingCount : 0,
            data: enrichedPills 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 3. RECORD ACTION (Taken / Snooze 10 Min)
const recordPillAction = async (req, res) => {
    try {
        const { pillId } = req.params;
        const { time, action } = req.body; 
        const todayStr = moment().format('YYYY-MM-DD');

        const pill = await PillReminder.findOne({ _id: pillId, userId: req.user.id });
        if (!pill) return res.status(404).json({ message: "Pill not found" });

        const timeIndex = pill.times.findIndex(t => t.time === time);
        if (timeIndex === -1) return res.status(400).json({ message: "Time slot not found" });

        if (action === 'Taken') {
            pill.times[timeIndex].isTakenToday = true;
            pill.times[timeIndex].snoozeUntil = null; 
        } else if (action === 'Snoozed') {
            pill.times[timeIndex].snoozeUntil = moment().add(10, 'minutes').toDate();
        }

        pill.history.push({ date: todayStr, time: time, action: action });
        await pill.save();

        res.json({ success: true, message: `Medication marked as ${action}`, data: enrichPillWithProgress(pill) });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 4. GET MY PILLS (List View with course calculations)
const getMyPills = async (req, res) => {
    try {
        const pills = await PillReminder.find({ userId: req.user.id }).sort({ createdAt: -1 });
        const enrichedPills = pills.map(p => enrichPillWithProgress(p));
        
        res.json({ success: true, data: enrichedPills });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 5. UPDATE PILL (Details edit panel with relative date converter)
const updatePill = async (req, res) => {
    try {
        const { startDate, endDate } = req.body;
        const updateFields = { ...req.body };

        if (startDate) updateFields.startDate = moment(startDate).toDate();
        if (endDate) {
            const startRef = startDate ? moment(startDate).toDate() : new Date();
            updateFields.endDate = parseEndDate(startRef, endDate);
        }

        const pill = await PillReminder.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            { $set: updateFields },
            { new: true }
        );
        res.json({ success: true, message: "Reminder updated", data: enrichPillWithProgress(pill) });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 6. DELETE PILL
const deletePill = async (req, res) => {
    try {
        await PillReminder.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
        res.json({ success: true, message: "Medication deleted" });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 7. UPDATE SPECIFIC PILL SETTINGS (Timings, Reminder On/Off switches)
const updatePillSettings = async (req, res) => {
    try {
        const { times, isReminderOn, notes, endDate } = req.body;
        const pillId = req.params.id;
        const userId = req.user.id;

        // Document find karke user check validation secure karna
        const pill = await PillReminder.findOne({ _id: pillId, userId: userId });
        if (!pill) {
            return res.status(404).json({ 
                success: false, 
                message: "Pill reminder not found or unauthorized access" 
            });
        }

        const formattedTimes = times ? times.map(t => ({
            time: t,
            isTakenToday: false
        })) : [];

        // Dynamic helper parses relative limits safely based on the original document start date reference
        const finalEndDate = parseEndDate(pill.startDate, endDate);

        const updatedPill = await PillReminder.findOneAndUpdate(
            { _id: pillId, userId: userId },
            { 
                $set: { 
                    times: formattedTimes, 
                    isReminderOn, 
                    notes,
                    endDate: finalEndDate
                } 
            },
            { new: true } 
        );

        res.json({ success: true, message: "Changes saved", data: enrichPillWithProgress(updatedPill) });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

module.exports = { 
    addPill, 
    getTodaySchedule, 
    recordPillAction, 
    getMyPills, 
    updatePill, 
    updatePillSettings,
    deletePill 
};