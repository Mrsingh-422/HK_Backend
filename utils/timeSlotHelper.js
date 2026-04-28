// utils/timeSlotHelper.js
const moment = require('moment');
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

const generateNurseSlots = (config, bookingType) => {
    const { startTime, endTime, slotDuration, unavailableSlots, morningSlots, afternoonSlots, eveningSlots, premiumSlots } = config;
    if (!startTime || !endTime) return [];

    let slots = [];
    // Figma Hourly logic: Agar 'hourly' hai toh interval 60 min, warna regular slotDuration
    let interval = (bookingType === 'Acc. To Per/Hours') ? 60 : (slotDuration || 30);

    let start = moment(startTime, "HH:mm");
    let end = moment(endTime, "HH:mm");

    while (start.isBefore(end)) {
        let timeString = start.format("HH:mm");
        if (!unavailableSlots?.includes(timeString)) {
            const hour = start.hour();
            
            // Category check
            let category = (hour >= 5 && hour < 12) ? "Morning" : (hour >= 12 && hour < 17) ? "Afternoon" : "Evening";
            const isEnabled = (category === "Morning" && morningSlots) || 
                              (category === "Afternoon" && afternoonSlots) || 
                              (category === "Evening" && eveningSlots);

            if (isEnabled) {
                const premiumInfo = premiumSlots?.find(ps => ps.time === timeString);
                slots.push({
                    time: timeString,
                    displayTime: start.format("hh:mm A"),
                    category,
                    extraFee: premiumInfo ? premiumInfo.extraFee : 0
                });
            }
        }
        start.add(interval, 'minutes');
    }
    return slots;
};

module.exports = { generateTimeSlots, generateNurseSlots };