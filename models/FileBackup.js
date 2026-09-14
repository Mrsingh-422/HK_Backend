const mongoose = require('mongoose');

const fileBackupSchema = new mongoose.Schema({
    filePath: { 
        type: String, 
        required: true, 
        unique: true, 
        index: true 
    }, // e.g. "/uploads/doctors/doc-1725700.jpg"
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    fileData: { type: Buffer, required: true }, // Binary file data
    size: { type: Number }
}, { timestamps: true });

module.exports = mongoose.model('FileBackup', fileBackupSchema);