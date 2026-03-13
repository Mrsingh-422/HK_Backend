const PillReminder = require('../../../models/PillReminder');
const moment = require('moment');

// 1. ADD PILL (Same logic, slightly cleaned)
const addPill = async (req, res) => {
    try {
        const { medicineName, dosage, times, frequency, daysOfWeek, startDate, endDate, notes } = req.body;
        const formattedTimes = times.map(t => ({ time: t, isTakenToday: false }));

        const pill = await PillReminder.create({
            userId: req.user.id,
            medicineName, dosage, times: formattedTimes, frequency, 
            daysOfWeek, startDate, endDate, notes
        });
        res.status(201).json({ success: true, message: "Medication reminder set", data: pill });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. GET TODAY'S SCHEDULE (With Auto-Reset Logic)
// endpoint: GET /user/doctor/pills/today
const getTodaySchedule = async (req, res) => {
    try {
        const todayStr = moment().format('YYYY-MM-DD');
        const dayNum = moment().day();

        // Pehle wo saari pills nikale jo aaj ke liye active hain
        let pills = await PillReminder.find({
            userId: req.user.id,
            status: 'Active',
            startDate: { $lte: new Date() },
            $or: [{ frequency: 'Daily' }, { daysOfWeek: dayNum }]
        });

        // 🚀 Production Logic: Check if we need to reset "isTakenToday"
        // Agar history me aaj ki date ki entry nahi hai aur isTakenToday true hai, 
        // to iska matlab naya din shuru ho gaya hai.
        for (let pill of pills) {
            let needsSave = false;
            pill.times.forEach(t => {
                // Check history for this specific pill and time for today
                const alreadyRecorded = pill.history.some(h => h.date === todayStr && h.time === t.time && h.action === 'Taken');
                
                if (!alreadyRecorded && t.isTakenToday) {
                    t.isTakenToday = false; // Reset for new day
                    needsSave = true;
                }
            });
            if (needsSave) await pill.save();
        }

        res.json({ success: true, data: pills });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. RECORD ACTION (Taken / Snooze 10 Min)
// endpoint: PATCH /user/doctor/pills/action/:pillId
const recordPillAction = async (req, res) => {
    try {
        const { pillId } = req.params;
        const { time, action } = req.body; // action: 'Taken', 'Snoozed', 'Skipped'
        const todayStr = moment().format('YYYY-MM-DD');

        const pill = await PillReminder.findOne({ _id: pillId, userId: req.user.id });
        if (!pill) return res.status(404).json({ message: "Pill not found" });

        const timeIndex = pill.times.findIndex(t => t.time === time);
        if (timeIndex === -1) return res.status(400).json({ message: "Time slot not found" });

        if (action === 'Taken') {
            pill.times[timeIndex].isTakenToday = true;
            pill.times[timeIndex].snoozeUntil = null; // Clear snooze
        } else if (action === 'Snoozed') {
            // Figma logic: Snooze for 10 minutes
            pill.times[timeIndex].snoozeUntil = moment().add(10, 'minutes').toDate();
        }

        // Save to History
        pill.history.push({ date: todayStr, time: time, action: action });
        await pill.save();

        res.json({ success: true, message: `Medication marked as ${action}`, data: pill });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. GET MY PILLS (List View)
// endpoint: GET /user/doctor/pills
const getMyPills = async (req, res) => {
    try {
        const pills = await PillReminder.find({ userId: req.user.id }).sort({ createdAt: -1 });
        res.json({ success: true, data: pills });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 5. UPDATE PILL (Figma Edit Screen)
// endpoint: PUT /user/doctor/pills/update/:id
const updatePill = async (req, res) => {
    try {
        const pill = await PillReminder.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            { $set: req.body },
            { new: true }
        );
        res.json({ success: true, message: "Reminder updated", data: pill });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 6. DELETE PILL (Figma: Delete Button)
// endpoint: DELETE /user/doctor/pills/delete/:id
const deletePill = async (req, res) => {
    try {
        await PillReminder.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
        res.json({ success: true, message: "Medication deleted" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { 
    addPill, 
    getTodaySchedule, 
    recordPillAction, 
    getMyPills, 
    updatePill, 
    deletePill 
};