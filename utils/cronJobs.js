// utils/cronJobs.js
const cron = require('node-cron');
const NursingPrescriptionRequest = require('../models/NursingPrescriptionRequest');
const UserSubscription = require('../models/UserSubscription');
const LabPrescriptionRequest = require('../models/LabPrescriptionRequest');
const Appointment = require('../models/Appointment');
const Bed = require('../models/Bed');
const { sendPushNotification } = require('./notification');

// @desc    Initialize Background Schedulers (Nursing Expiry, Subscription Expiry, Bed Hold Auto-Release & Lab Prescription Expiry)
const initCronJobs = () => {
    // 1. Hourly check for expired nursing prescription requests (UNTOUCHED)
    cron.schedule('0 * * * *', async () => {
        try {
            const now = new Date();
            await NursingPrescriptionRequest.updateMany(
                { status: 'Broadcasted', expiresAt: { $lte: now } },
                { $set: { status: 'Expired' } }
            );
        } catch (error) {
            console.error("[Nursing Cron Job Error]:", error);
        }
    });

    // 2. Daily Midnight check: Mark ended subscriptions as 'Expired' (UNTOUCHED)
    cron.schedule('0 0 * * *', async () => {
        try {
            const now = new Date();
            const result = await UserSubscription.updateMany(
                { status: 'Active', endDate: { $lte: now } },
                { $set: { status: 'Expired' } }
            );
            if (result.modifiedCount > 0) {
                console.log(`\x1b[33m[Subscription Cron Job]: Archived ${result.modifiedCount} expired user subscriptions.\x1b[0m`);
            }
        } catch (error) {
            console.error("[Subscription Cron Job Error]:", error);
        }
    });

    // 3. Real-Time 2-Minute Cron: Release Unpaid 30-Minute Expired Bed Holds + Notify User (UNTOUCHED)
    cron.schedule('*/2 * * * *', async () => {
        try {
            const now = new Date();
            const expiredAdmissions = await Appointment.find({
                bookingType: 'Admission',
                status: 'Hospital-Pending',
                admissionHoldExpiresAt: { $lt: now, $ne: null },
                paymentStatus: 'Pending',
                bedId: { $ne: null }
            });

            for (let adm of expiredAdmissions) {
                await Bed.findByIdAndUpdate(adm.bedId, { $set: { status: 'Available' } });
                adm.admissionHoldExpiresAt = null;
                adm.status = 'Cancelled-By-Hospital';
                adm.cancellationDetails = {
                    reason: "Automated: 30-Minute admission deposit window expired. Bed released.",
                    cancelledAt: now
                };
                await adm.save();

                // Alert Patient that hold expired
                if (adm.userId) {
                    try {
                        await sendPushNotification(
                            adm.userId,
                            'user',
                            "Bed Reservation Expired",
                            `Your 30-minute reservation for Bed ${adm.bedNumber} (${adm.wardName}) has expired and the bed has been released.`,
                            { appointmentId: adm._id.toString(), type: 'bed_hold_expired' }
                        );
                    } catch (e) {}
                }
                console.log(`\x1b[31m[Auto-Release]: Bed ${adm.bedNumber} released. Admission #${adm.bookingId} cancelled.\x1b[0m`);
            }
        } catch (error) {
            console.error("[Bed Release Cron Error]:", error);
        }
    });

    // 4. Daily 1:00 AM Cron: Auto-Expire Stale Lab Prescription Requests whose appointmentDate has passed (NEW)
    cron.schedule('0 1 * * *', async () => {
        try {
            const yesterdayEnd = moment().subtract(1, 'day').endOf('day').toDate();
            const result = await LabPrescriptionRequest.updateMany(
                {
                    status: { $in: ['Pending Review', 'Reviewing', 'Bill Generated', 'Pending Payment'] },
                    appointmentDate: { $lte: yesterdayEnd }
                },
                { 
                    $set: { 
                        status: 'Expired', 
                        rejectReason: "Automated: Appointment date passed without confirmation." 
                    } 
                }
            );
            if (result.modifiedCount > 0) {
                console.log(`\x1b[33m[Lab Prescription Expiry Cron]: Auto-expired ${result.modifiedCount} stale lab prescription requests.\x1b[0m`);
            }
        } catch (error) {
            console.error("[Lab Prescription Expiry Cron Error]:", error);
        }
    });
};

module.exports = initCronJobs;