// utils/cronJobs.js
const cron = require('node-cron');
const NursingPrescriptionRequest = require('../models/NursingPrescriptionRequest');

const initCronJobs = () => {
    // Ye cron scheduler har ghante (at minute 0) run karega
    cron.schedule('0 * * * *', async () => {
        try {
            const now = new Date();
            
            // Un sabhi entries ko 'Expired' mark karega jinka 6 hours time nikal chuka hai
            const result = await NursingPrescriptionRequest.updateMany(
                { status: 'Broadcasted', expiresAt: { $lte: now } },
                { $set: { status: 'Expired' } }
            );
            
            if (result.modifiedCount > 0) {
                console.log(`[Cron Job]: Archived ${result.modifiedCount} expired prescription requests.`);
            }
        } catch (error) {
            console.error("[Cron Job Error]: Failed to update expired requests:", error);
        }
    });
};

module.exports = initCronJobs;