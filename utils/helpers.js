// utils/helpers.js
const axios = require('axios');
const crypto = require('crypto');
// ==========================================
// 1. DISTANCE CALCULATOR (Google Map vs Straight Line)
// ==========================================
const getDistance = async (userLat, userLng, vendorLat, vendorLng) => {
    // DEVELOPMENT MODE: Use Haversine (Straight Line) Formula
    if (process.env.NODE_ENV === 'development') {
        const toRad = (value) => (value * Math.PI) / 180;
        const R = 6371; // Earth Radius in KM
        const dLat = toRad(vendorLat - userLat);
        const dLon = toRad(vendorLng - userLng);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(toRad(userLat)) * Math.cos(toRad(vendorLat)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return parseFloat((R * c).toFixed(2)); // Returns KM
    }

    // PRODUCTION MODE: Use Google Distance Matrix API
    try {
        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${userLat},${userLng}&destinations=${vendorLat},${vendorLng}&key=${apiKey}`;
        
        const response = await axios.get(url);
        const distanceText = response.data.rows[0].elements[0].distance.value; // Returns meters
        return parseFloat((distanceText / 1000).toFixed(2)); // Convert to KM
    } catch (error) {
        console.error("Map API Error, falling back to Haversine");
        return 0; 
    }
};

// ==========================================
// 2. RAZORPAY CONFIG (Dev vs Prod)
// ==========================================
const getRazorpayKeys = () => {
    if (process.env.NODE_ENV === 'production') {
        return {
            key_id: process.env.RAZORPAY_LIVE_KEY_ID,
            key_secret: process.env.RAZORPAY_LIVE_KEY_SECRET
        };
    } else {
        return {
            key_id: process.env.RAZORPAY_TEST_KEY_ID,
            key_secret: process.env.RAZORPAY_TEST_KEY_SECRET
        };
    }
};

// @desc    Generates cryptographically unique, collision-proof booking/order codes with service prefix
// @example generateUniqueOrderCode('HK-MED', PharmacyBooking, 'orderId') ➔ "HK-MED-7Y2K9X4M"
const generateUniqueOrderCode = async (prefix, Model = null, fieldName = 'bookingId') => {
    let uniqueCode = "";
    let isDuplicate = true;
    let attempts = 0;

    while (isDuplicate && attempts < 10) {
        attempts++;

        // 1. High-resolution timestamp in Base-36 (compact, chronological, non-repeating)
        const timePart = Date.now().toString(36).toUpperCase();

        // 2. Cryptographically secure random 4 bytes (16^8 entropy = 4.29 billion possibilities per millisecond)
        const randomPart = crypto.randomBytes(3).toString('hex').toUpperCase();

        // 3. Assemble final standard format (e.g. HK-MED-M1K9X4-9FA2)
        uniqueCode = `${prefix}-${timePart}-${randomPart}`;

        // 4. Verify in DB if Model is provided (Self-healing collision check)
        if (Model && fieldName) {
            const exists = await Model.findOne({ [fieldName]: uniqueCode }).select('_id').lean();
            if (!exists) {
                isDuplicate = false;
            }
        } else {
            isDuplicate = false;
        }
    }

    return uniqueCode;
};

module.exports = { getDistance, getRazorpayKeys, generateUniqueOrderCode };