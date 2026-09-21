// utils/cronJobs.js
const cron = require('node-cron');
const NursingPrescriptionRequest = require('../models/NursingPrescriptionRequest');
const UserSubscription = require('../models/UserSubscription');

const initCronJobs = () => {
    // 1. Hourly check for expired prescription requests
    cron.schedule('0 * * * *', async () => {
        try {
            const now = new Date();
            await NursingPrescriptionRequest.updateMany(
                { status: 'Broadcasted', expiresAt: { $lte: now } },
                { $set: { status: 'Expired' } }
            );
        } catch (error) {
            console.error("[Cron Job Error]:", error);
        }
    });

    // 🚀 2. Daily Midnight check: Mark ended subscriptions as 'Expired'
    cron.schedule('0 0 * * *', async () => {
        try {
            const now = new Date();
            const result = await UserSubscription.updateMany(
                { status: 'Active', endDate: { $lte: now } },
                { $set: { status: 'Expired' } }
            );
            if (result.modifiedCount > 0) {
                console.log(`\x1b[33m[Cron Job]: Archived ${result.modifiedCount} expired user subscriptions.\x1b[0m`);
            }
        } catch (error) {
            console.error("[Subscription Cron Job Error]:", error);
        }
    });
};

module.exports = initCronJobs;