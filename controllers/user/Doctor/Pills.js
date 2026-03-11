const PillReminder = require('../../../models/PillReminder');
const moment = require('moment');

/**
 * 1. ADD NEW MEDICATION
 * endpoint: POST /user/doctor/pills/add
 */
const addPill = async (req, res) => {
    try {
        const { medicineName, dosage, times, frequency, daysOfWeek, startDate, endDate, notes } = req.body;

        // Times को objects के array में convert करना ताकि status track हो सके
        const formattedTimes = times.map(t => ({ time: t, isTakenToday: false }));

        const pill = await PillReminder.create({
            userId: req.user.id,
            medicineName,
            dosage,
            times: formattedTimes,
            frequency,
            daysOfWeek,
            startDate,
            endDate,
            notes
        });

        res.status(201).json({ success: true, message: "Medication reminder set successfully", data: pill });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**
 * 2. GET TODAY'S PILL SCHEDULE (Figma: Home/Pill Screen)
 * Isme sirf wahi dawai aayengi jo aaj ke din ke liye scheduled hain.
 * endpoint: GET /user/doctor/pills/today
 */
const getTodaySchedule = async (req, res) => {
    try {
        const today = moment().startOf('day');
        const dayNum = today.day(); // 0-6

        // Find pills that are active and match today's day/frequency
        const pills = await PillReminder.find({
            userId: req.user.id,
            status: 'Active',
            isReminderOn: true,
            startDate: { $lte: today.toDate() },
            $or: [
                { frequency: 'Daily' },
                { daysOfWeek: dayNum }
            ]
        });

        res.json({ success: true, count: pills.length, data: pills });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**
 * 3. MARK PILL AS TAKEN / SKIPPED (Figma: Taken Button)
 * endpoint: PATCH /user/doctor/pills/action/:pillId
 */
const recordPillAction = async (req, res) => {
    try {
        const { pillId } = req.params;
        const { time, action } = req.body; // action: 'Taken', 'Skipped', 'Snoozed'

        const pill = await PillReminder.findOne({ _id: pillId, userId: req.user.id });
        if (!pill) return res.status(404).json({ message: "Pill not found" });

        // History में record add करना
        pill.history.push({
            date: new Date(),
            time: time,
            action: action
        });

        // Agar Action 'Taken' hai, toh current schedule me update karein
        if(action === 'Taken') {
            const timeIndex = pill.times.findIndex(t => t.time === time);
            if(timeIndex !== -1) pill.times[timeIndex].isTakenToday = true;
        }

        await pill.save();
        res.json({ success: true, message: `Medication marked as ${action}`, data: pill });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**
 * 4. TOGGLE REMINDER (ON/OFF)
 * endpoint: PATCH /user/doctor/pills/toggle/:id
 */
const toggleReminder = async (req, res) => {
    try {
        const pill = await PillReminder.findOne({ _id: req.params.id, userId: req.user.id });
        pill.isReminderOn = !pill.isReminderOn;
        await pill.save();
        res.json({ success: true, message: `Reminder turned ${pill.isReminderOn ? 'ON' : 'OFF'}` });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**
 * 5. GET ALL ACTIVE MEDICATIONS (List View)
 * endpoint: GET /user/doctor/pills/my-pills
 */
const getMyPills = async (req, res) => {
    try {
        const pills = await PillReminder.find({ userId: req.user.id }).sort({ createdAt: -1 });
        res.json({ success: true, data: pills });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**
 * 6. UPDATE PILL
 */
const updatePill = async (req, res) => {
    try {
        const pill = await PillReminder.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            { $set: req.body },
            { new: true }
        );
        res.json({ success: true, message: "Updated", data: pill });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**
 * 7. DELETE PILL
 */
const deletePill = async (req, res) => {
    try {
        await PillReminder.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
        res.json({ success: true, message: "Deleted" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    addPill, 
    getTodaySchedule, 
    recordPillAction, 
    toggleReminder, 
    getMyPills, 
    updatePill, 
    deletePill 
};