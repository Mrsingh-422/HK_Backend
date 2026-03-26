// models/LabTest.js (Figma: Add New Tests)
const mongoose = require('mongoose');

const labTestSchema = new mongoose.Schema({
    labId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lab', required: true },
    masterTestId: { type: mongoose.Schema.Types.ObjectId, ref: 'MasterLabTest', required: true },
    
    // Inhe sync rakhenge Master se ya display ke liye easy rakhenge
    testName: { type: String }, 
    mainCategory: { type: String, enum: ['Radiology', 'Pathology'] }, 
    sampleType: { type: String },

    // Lab Specific Data
    description: { type: String }, // Lab ka apna personal description (optional)
    precaution: { type: String },  // Lab specific preparation rules
    testType: { type: String, enum: ['Home Collection', 'Walk-In', 'Both'], default: 'Both' },
    
    // Reporting Time (TAT) - Yeh har lab ki alag hoti hai
    reportTime: { type: String }, // e.g. "12 Hours", "Same Day"

    // Pricing Logic
    amount: { type: Number, required: true }, // Lab's MRP
    discountPercent: { type: Number, default: 0 }, // Percent value: 15 (matlab 15%)
    discountPrice: { type: Number }, // Calculated Price
    
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Pre-save middleware: Jab bhi lab test save ho, final price automatically calculate ho jaye
// labTestSchema.pre('save', function(next) {
//     if (this.amount) {
//         const discount = this.discountPercent || 0;
//         this.discountPrice = this.amount - (this.amount * (discount / 100));
//     }
//     next();
// });

module.exports = mongoose.model('LabTest', labTestSchema);