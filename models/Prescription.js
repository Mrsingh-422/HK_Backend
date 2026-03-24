const mongoose = require('mongoose');

const prescriptionSchema = new mongoose.Schema({
    // Agar app ke doctor se mili hai toh fields fill hongi, warna null (Manual upload ke case mein)
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    
    // Figma Screen 64: Manual upload ke liye
    prescriptionImages: [{ type: String }], // Array of uploaded JPG/PNG/PDF
    isManualUpload: { type: Boolean, default: false },

    diagnosis: [{ type: String }], 
    medicines: [{
        name: String,
        dosage: String,
        frequency: String,
        duration: String,
        instructions: String
    }],
    additionalNotes: String,
    pdfUrl: String 
}, { timestamps: true });

module.exports = mongoose.model('Prescription', prescriptionSchema);