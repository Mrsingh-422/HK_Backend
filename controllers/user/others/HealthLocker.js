const HealthLocker = require('../../../models/HealthLocker');
const mongoose = require('mongoose');

const uploadToLocker = async (req, res) => {
    try {
        const { folderName, title, doctorName, notes } = req.body;
        if (!req.files || req.files.length === 0) return res.status(400).json({ message: "Upload at least one image" });

        const filePaths = req.files.map(f => `/uploads/locker/${f.filename}`);

        const file = await HealthLocker.create({
            userId: req.user.id,
            folderName, // User jo bhi name dega wahi folder ban jayega
            title,
            doctorName,
            notes,
            images: filePaths,
            fileCount: filePaths.length
        });
        res.status(201).json({ success: true, data: file });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. GET FOLDERS SUMMARY (Dashboard)
const getLockerSummary = async (req, res) => {
    try {
        const summary = await HealthLocker.aggregate([
            { $match: { userId: new mongoose.Types.ObjectId(req.user.id) } },
            { $group: { 
                _id: "$folderName", 
                totalRecords: { $sum: 1 }, // Folder ke andar kitne reports hain
                totalImages: { $sum: "$fileCount" }, // Total kitne pages hain
                lastUpdated: { $max: "$updatedAt" }
            }},
            { $sort: { lastUpdated: -1 } }
        ]);
        res.json({ success: true, data: summary });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. RENAME FOLDER (Bulk update all records in that folder)
const renameFolder = async (req, res) => {
    try {
        const { oldName, newName } = req.body;
        await HealthLocker.updateMany(
            { userId: req.user.id, folderName: oldName },
            { $set: { folderName: newName } }
        );
        res.json({ success: true, message: "Folder renamed successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. ADD MORE PAGES TO EXISTING RECORD (Figma Screen 11)
const addMorePages = async (req, res) => {
    try {
        const { recordId } = req.params;
        const newImages = req.files.map(f => `/uploads/locker/${f.filename}`);

        const updated = await HealthLocker.findByIdAndUpdate(
            recordId,
            { 
                $push: { images: { $each: newImages } },
                $inc: { fileCount: newImages.length }
            },
            { new: true }
        );
        res.json({ success: true, data: updated });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 5. GET FILES BY FOLDER
const getFilesByFolder = async (req, res) => {
    try {
        const files = await HealthLocker.find({ 
            userId: req.user.id, 
            folderName: req.params.folderName 
        }).sort({ createdAt: -1 });
        res.json({ success: true, data: files });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 6. DELETE RECORD
const deleteRecord = async (req, res) => {
    try {
        await HealthLocker.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
        res.json({ success: true, message: "Record deleted" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { 
    uploadToLocker, getLockerSummary, getFilesByFolder, 
    deleteRecord, renameFolder, addMorePages 
};