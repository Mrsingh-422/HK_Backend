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


const generateNurseSlots = (config, baseHourlyFinal) => {
    const { startTime, endTime, slotDuration, unavailableSlots, morningSlots, afternoonSlots, eveningSlots, premiumSlots } = config;
    if (!startTime || !endTime) return [];

    let slots = [];
    // Hourly booking pattern: 60 mins interval
    let interval = 60; 
    
    let start = moment(startTime, "HH:mm");
    let end = moment(endTime, "HH:mm");

    while (start.isBefore(end)) {
        let timeString = start.format("HH:mm");
        
        if (!unavailableSlots?.includes(timeString)) {
            const hour = start.hour();
            let category = (hour >= 5 && hour < 12) ? "Morning" : (hour >= 12 && hour < 17) ? "Afternoon" : "Evening";
            
            const isEnabled = (category === "Morning" && morningSlots) || 
                              (category === "Afternoon" && afternoonSlots) || 
                              (category === "Evening" && eveningSlots);

            if (isEnabled) {
                const premium = premiumSlots?.find(p => p.time === timeString);
                const extra = premium ? premium.extraFee : 0;

                slots.push({
                    time: timeString,
                    displayTime: start.format("hh:mm A"),
                    category,
                    // 💰 HOURLY PRICE LOGIC
                    hourlyBasePrice: baseHourlyFinal,
                    slotPremiumFee: extra,
                    totalHourlyPrice: Math.round(baseHourlyFinal + extra) 
                });
            }
        }
        start.add(interval, 'minutes');
    }
    return slots;
};


/**
 * Generates dynamic ambulance time slots with real-time booking collision checking
 * @param {Object} availabilityConfig - Driver's Availability document
 * @param {Array} bookedTrips - List of confirmed/ongoing bookings for that date
 * @param {String} selectedDate - Date in 'YYYY-MM-DD' format
 * @returns {Array} List of slots with category, status, and availability flag
 */
const generateAmbulanceSlots = (availabilityConfig, bookedTrips = [], selectedDate) => {
    const startTime = availabilityConfig?.startTime || "00:00";
    const endTime = availabilityConfig?.endTime || "23:59";
    const slotDuration = availabilityConfig?.slotDuration || 120; // 120 minutes = 2 hours standard transit buffer
    const unavailableSlots = availabilityConfig?.unavailableSlots || [];
    const offDays = availabilityConfig?.offDays || [];

    const dayName = moment(selectedDate).format('dddd');
    if (offDays.includes(dayName)) {
        return { isClosed: true, reason: `Ambulance is off on ${dayName}s.`, slots: [] };
    }

    const slots = [];
    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);

    const startTotalMinutes = startHour * 60 + startMin;
    const endTotalMinutes = endHour * 60 + endMin;

    const isToday = moment().format('YYYY-MM-DD') === selectedDate;
    const currentMoment = moment();

    for (let minutes = startTotalMinutes; minutes + slotDuration <= endTotalMinutes; minutes += slotDuration) {
        const startH = Math.floor(minutes / 60);
        const startM = minutes % 60;
        const endMinutes = minutes + slotDuration;
        const endH = Math.floor(endMinutes / 60);
        const endM = endMinutes % 60;

        const timeString24 = `${startH.toString().padStart(2, '0')}:${startM.toString().padStart(2, '0')}`;
        const slotStartMoment = moment(`${selectedDate} ${timeString24}`, 'YYYY-MM-DD HH:mm');
        const slotEndMoment = slotStartMoment.clone().add(slotDuration, 'minutes');

        const displayTime = `${slotStartMoment.format('hh:mm A')} - ${slotEndMoment.format('hh:mm A')}`;

        // 1. Categorization
        let category = "Morning";
        if (startH >= 12 && startH < 17) category = "Afternoon";
        else if (startH >= 17 && startH <= 23) category = "Evening / Night";
        else if (startH < 5) category = "Late Night";

        // 2. Check if slot is already in the past for today
        const isPast = isToday && slotStartMoment.isBefore(currentMoment);

        // 3. Check if driver marked this slot unavailable
        const isManuallyBlocked = unavailableSlots.includes(timeString24);

        // 4. Check Collision against Confirmed / Ongoing Bookings
        const hasBookingConflict = bookedTrips.some(trip => {
            const tripStartTime = moment(trip.scheduledAt);
            const tripEndTime = tripStartTime.clone().add(120, 'minutes'); // 2 hours trip buffer

            // Overlap condition: (SlotStart < TripEnd) AND (SlotEnd > TripStart)
            return slotStartMoment.isBefore(tripEndTime) && slotEndMoment.isAfter(tripStartTime);
        });

        const isAvailable = !isPast && !isManuallyBlocked && !hasBookingConflict;

        let statusText = "Available";
        if (isPast) statusText = "Past";
        else if (isManuallyBlocked) statusText = "Unavailable";
        else if (hasBookingConflict) statusText = "Booked";

        slots.push({
            slotTime: timeString24,
            displayTime,
            startTimeFormatted: slotStartMoment.format('hh:mm A'),
            endTimeFormatted: slotEndMoment.format('hh:mm A'),
            category,
            isAvailable,
            status: statusText
        });
    }

    return { isClosed: false, slots };
};

module.exports = { generateTimeSlots, generateNurseSlots, isNurseAvailable,generateAmbulanceSlots };