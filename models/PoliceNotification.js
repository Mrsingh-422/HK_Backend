const mongoose = require('mongoose');
 
const notificationSchema = new mongoose.Schema({
    // Jisko notification bhejni hai uski ID (HQ, Station ya Staff ki ObjectId)
    recipientId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
   
    // Recipient ka Role taaki filter karne me asani ho
    recipientRole: {
        type: String,
        enum: ['Police-HQ', 'Police-Station', 'Police-Staff'],
        required: true
    },
   
    // Type of notification (Figma me alag-alag icons/colors iske basis pe show honge)
    type: {
        type: String,
        enum: ['Emergency', 'Case Update', 'Leave Request', 'System', 'General'],
        default: 'General'
    },
   
    // Notification ki Main Heading
    title: {
        type: String,
        required: true
    },
   
    // Notification ki puri detail
    message: {
        type: String,
        required: true
    },
   
    // (Optional) Agar notification par click karke kisi case ya leave request par jana ho
    relatedItemId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
    },
   
    // Read / Unread Status
    isRead: {
        type: Boolean,
        default: false
    }
}, { timestamps: true }); // timestamps automatically createdAt (2 mins ago, yesterday) handle karega
 
// Index lagaya hai taaki notification fetch karne ki speed fast rahe
notificationSchema.index({ recipientId: 1, isRead: 1 });
 
module.exports = mongoose.model('PoliceNotification', notificationSchema);
 