// utils/timeSlotHelper.js
const moment = require('moment');
const NurseBooking = require('../models/NurseBooking');
const generateTimeSlots = (config) => {
    const { startTime, endTime, slotDuration, unavailableSlots, morningSlots, afternoonSlots, eveningSlots, premiumSlots } = config;
    
    // Gap Fix: Infinite loop protection & missing config check
    if (!startTime || !endTime || !slotDuration || slotDuration <= 0) return [];

    let slots = [];
    let [startHour, startMin] = startTime.split(':').map(Number);
    let [endHour, endMin] = endTime.split(':').map(Number);

    let startTotalMinutes = startHour * 60 + startMin;
    let endTotalMinutes = endHour * 60 + endMin;

    for (let minutes = startTotalMinutes; minutes < endTotalMinutes; minutes += slotDuration) {
        let h = Math.floor(minutes / 60);
        let m = minutes % 60;
        let timeString = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

        if (unavailableSlots && unavailableSlots.includes(timeString)) continue;

        let category = "";
        if (h >= 5 && h < 12) category = "Morning";
        else if (h >= 12 && h < 17) category = "Afternoon";
        else if (h >= 17 && h < 23) category = "Evening";

        const isEnabled = (category === "Morning" && morningSlots) ||
                          (category === "Afternoon" && afternoonSlots) ||
                          (category === "Evening" && eveningSlots);

        if (isEnabled) {
            const premiumInfo = premiumSlots ? premiumSlots.find(ps => ps.time === timeString) : null;
            slots.push({ 
                time: timeString, 
                category, 
                extraFee: premiumInfo ? premiumInfo.extraFee : 0 
            });
        }
    }
    return slots;
};

const isNurseAvailable = async (nurseId, payload, NurseBooking, Availability) => {
    const { selectedType, startDate, endDate, startTime, endTime } = payload;

    const reqStart = moment(startDate).startOf('day');
    const reqEnd = (selectedType === 'For Multiple Days') ? moment(endDate).endOf('day') : moment(startDate).endOf('day');

    // 1. Fetch overlapping bookings
    const overlaps = await NurseBooking.find({
        nurseId,
        status: { $in: ['Pending', 'Confirmed', 'Assigned', 'On-The-Way', 'Arrived', 'Service-Started'] },
        $or: [{ "schedule.startDate": { $lte: reqEnd.toDate() }, "schedule.endDate": { $gte: reqStart.toDate() } }]
    });

    if (overlaps.length > 0) {
        // CASE: User is asking for MULTIPLE DAYS
        if (selectedType === 'For Multiple Days') {
            // Range ke beech mein agar 1 bhi booking mili toh Nurse unavailable hai
            return false;
        }

        // CASE: User is asking for ONE DAY but Nurse is booked for MULTIPLE DAYS
        for (const b of overlaps) {
            if (b.schedule.duration === 'For Multiple Days') {
                return false; // Poora din/range block hai
            }
            
            // Same day time-slot overlap check (baaki same rahega)
            if (moment(startDate).isSame(b.schedule.startDate, 'day')) {
                // ... (existing hourly/slot overlap logic)
            }
        }
    }
    
    // Capacity check
    const config = await Availability.findOne({ vendorId: nurseId });
    const maxCapacity = config ? config.maxClientsPerSlot : 1;
    return overlaps.length < maxCapacity;
};


const generateNurseSlots = (config, bookingType) => {
    const { startTime, endTime, slotDuration, unavailableSlots, morningSlots, afternoonSlots, eveningSlots, premiumSlots } = config;
    if (!startTime || !endTime) return [];

    let slots = [];
    let interval = (bookingType === 'Acc. To Per/Hours') ? 60 : (slotDuration || 30);
    let start = moment(startTime, "HH:mm");
    let end = moment(endTime, "HH:mm");

    while (start.isBefore(end)) {
        let timeString = start.format("HH:mm");
        if (!unavailableSlots?.includes(timeString)) {
            const hour = start.hour();
            let category = (hour >= 5 && hour < 12) ? "Morning" : (hour >= 12 && hour < 17) ? "Afternoon" : "Evening";
            const isEnabled = (category === "Morning" && morningSlots) || (category === "Afternoon" && afternoonSlots) || (category === "Evening" && eveningSlots);

            if (isEnabled) {
                // Check if this slot is premium
                const premium = premiumSlots?.find(p => p.time === timeString);
                
                slots.push({
                    time: timeString,
                    displayTime: start.format("hh:mm A"),
                    category,
                    // FIX: Agar premium nahi hai toh 0 dikhao, 79 nahi
                    extraFee: premium ? premium.extraFee : 0 
                });
            }
        }
        start.add(interval, 'minutes');
    }
    return slots;
};




module.exports = { generateTimeSlots, generateNurseSlots, isNurseAvailable };