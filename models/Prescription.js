const mongoose = require('mongoose');

const prescriptionSchema = new mongoose.Schema({
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    
    diagnosis: [{ type: String }], // Figma: Mild Hypertension, Headache, Fatigue
    medicines: [{
        name: String,   // Telmisartan 40mg
        dosage: String, // 1 Tablet
        frequency: String, // Twice daily
        duration: String, // 5 days
        instructions: String // After Food
    }],
    additionalNotes: String, // Figma: Avoid spicy food, drink water...
    pdfUrl: String // Generated PDF link (optional)
}, { timestamps: true });

module.exports = mongoose.model('Prescription', prescriptionSchema);