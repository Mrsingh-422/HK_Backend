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
        name: { type: String, required: true },                     // e.g. "ACTIBILE 300 TABLET"
        isCustomGeneric: { type: Boolean, default: false },         // True if doctor clicked "Write Custom Generic Drug"
        genericComposition: { type: String, default: "" },          // Active pharmaceutical salt / generic formula
        strength: { type: String, default: "" },                    // e.g. "500 mg", "250 mg/5ml"
        frequency: { type: String, default: "" },                   // Latin Sig e.g. "q.d.", "b.i.d.", "t.i.d.", "q.i.d."
        doseInterval: { type: String, default: "" },                // Manual Interval e.g. "1-0-0", "1-0-1", "1-1-1"
        duration: { type: String, default: "" },                    // e.g. "5 days", "10 days"
        dispenseQuantity: { type: String, default: "" },            // e.g. "10 Tablets", "1 Bottle"
        administrationTiming: { type: String, default: "" },        // e.g. "p.c. (After meals)", "a.c.", "h.s.", "prn", "stat"
        instructions: { type: String, default: "" },                // Additional patient instructions
        dose: { type: String, default: "" },                        // Backward compatibility key
        time: { type: String, default: "" },                        // Backward compatibility key
        dosage: { type: String, default: "" }                       // Backward compatibility key
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