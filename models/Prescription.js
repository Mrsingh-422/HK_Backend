const mongoose = require('mongoose');

const prescriptionSchema = new mongoose.Schema({
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    
    // For manual patient uploads
    prescriptionImages: [{ type: String }], 
    isManualUpload: { type: Boolean, default: false },

    // Core Medical Sections from Image
    chiefComplaints: { type: String, default: "" },
    diagnosis: [{ type: String }], 

    // Table Data Mapping
    medicines: [{
    name: { type: String, required: true },               // Required only if a medicine is entered
    dose: { type: String, default: "" },                  // Optional (e.g., "1 - 0 - 1")
    time: { type: String, default: "" },                  // Optional (e.g., "Morning - Evening")
    duration: { type: String, default: "" },              // Optional (e.g., "5 Days")
    instructions: { type: String, default: "" },           // Optional extra guidelines
    frequency: { type: String, default: "" }, 
    dosage: { type: String, default: "" },
                }],
    vitals: {
    bp: { type: String, default: "" },      // Blood Pressure (e.g. 120/80)
    pulse: { type: String, default: "" },   // Pulse Rate (e.g. 72 bpm)
    temp: { type: String, default: "" },    // Temperature (e.g. 98.6 °F)
    spo2: { type: String, default: "" }     // SpO2 Saturation (e.g. 99%)
        },

    // Advised & Remarks Sections at bottom of Image
    advisedInvestigations: { type: String, default: "None" }, // e.g. "CBC, HbA1c" or "XXX"
    adviceGiven: { type: String, default: "" },                 // General guidelines or advice
    specialInstructions: { type: String, default: "" },         // Special notes or instructions
    nextAppointment: { type: String, default: "" },             // Next scheduled date/time string

    // Final Compiled PDF Path (Uploaded by Frontend)
    pdfUrl: { type: String, default: null },
    dietPlanPdf: { type: String, default: null },
    
    additionalNotes: { type: String, default: "" }
}, { timestamps: true });

module.exports = mongoose.model('Prescription', prescriptionSchema);