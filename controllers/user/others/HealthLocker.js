const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs'); // Used to verify account password for PIN resets
const HealthLocker = require('../../../models/HealthLocker');
const User = require('../../../models/User');

// --- HELPER FUNCTIONS FOR DELETION ---

// Helper: Delete files from disk safely
const deletePhysicalFiles = (imagePaths) => {
    if (!imagePaths || !Array.isArray(imagePaths)) return;
    imagePaths.forEach((filePath) => {
        // Adjust the join path based on your exact directory structure
        const absolutePath = path.join(__dirname, '../../..', filePath);
        fs.unlink(absolutePath, (err) => {
            if (err) {
                console.error(`Unable to delete physical file at ${absolutePath}:`, err.message);
            }
        });
    });
};

// Helper: Recursively find and delete all nested files & folders
const recursiveDelete = async (parentId, userId) => {
    const items = await HealthLocker.find({ parentId, userId });

    for (const item of items) {
        if (item.type === 'folder') {
            // Go deeper into nested elements
            await recursiveDelete(item._id, userId);
        } else if (item.type === 'file' && item.images) {
            // Delete actual images stored on local disk
            deletePhysicalFiles(item.images);
        }
        await HealthLocker.findByIdAndDelete(item._id);
    }
};


// --- PIN MANAGEMENT ENDPOINTS ---

// 1. Check PIN Status (To determine screen routing: Setup PIN vs Enter PIN)
const checkLockerPinStatus = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('+healthLockerPin');
        const hasPin = !!user.healthLockerPin;
        res.status(200).json({ success: true, hasPin });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. Setup Initial PIN
const setupLockerPin = async (req, res) => {
    try {
        const { pin } = req.body;
        if (!pin || pin.length < 4 || pin.length > 6) {
            return res.status(400).json({ success: false, message: "PIN must be between 4 and 6 digits" });
        }

        const user = await User.findById(req.user.id).select('+healthLockerPin');
        if (user.healthLockerPin) {
            return res.status(400).json({ success: false, message: "PIN is already setup. Use change PIN option." });
        }

        user.healthLockerPin = pin;
        await user.save();

        res.status(201).json({ success: true, message: "Vault PIN configured successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. Verify PIN to Unlock
const verifyLockerPin = async (req, res) => {
    try {
        const { pin } = req.body;
        const user = await User.findById(req.user.id).select('+healthLockerPin');
        
        if (!user.healthLockerPin || user.healthLockerPin !== pin) {
            return res.status(401).json({ success: false, message: "Invalid PIN" });
        }
        res.json({ success: true, message: "Vault Unlocked" });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 4. Change Existing PIN
const changeLockerPin = async (req, res) => {
    try {
        const { oldPin, newPin } = req.body;
        if (!oldPin || !newPin) {
            return res.status(400).json({ success: false, message: "Both old and new PIN are required" });
        }
        if (newPin.length < 4 || newPin.length > 6) {
            return res.status(400).json({ success: false, message: "New PIN must be between 4 and 6 digits" });
        }

        const user = await User.findById(req.user.id).select('+healthLockerPin');
        if (!user.healthLockerPin) {
            return res.status(400).json({ success: false, message: "No PIN setup found. Set up a new PIN first." });
        }

        if (user.healthLockerPin !== oldPin) {
            return res.status(401).json({ success: false, message: "Incorrect old PIN" });
        }

        user.healthLockerPin = newPin;
        await user.save();

        res.json({ success: true, message: "PIN updated successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 5. Reset PIN (If forgotten, uses account password to authorize the change)
const resetLockerPin = async (req, res) => {
    try {
        const { password, newPin } = req.body;
        if (!password || !newPin) {
            return res.status(400).json({ success: false, message: "Password and new PIN are required" });
        }
        if (newPin.length < 4 || newPin.length > 6) {
            return res.status(400).json({ success: false, message: "New PIN must be between 4 and 6 digits" });
        }

        const user = await User.findById(req.user.id).select('+password +healthLockerPin');
        
        // Verify account password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: "Invalid account password" });
        }

        user.healthLockerPin = newPin;
        await user.save();

        res.json({ success: true, message: "PIN reset successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// --- FOLDER & FILE CRUD OPERATIONS ---

const createFolder = async (req, res) => {
    try {
        const { name, parentId } = req.body;
        const folder = await HealthLocker.create({
            userId: req.user.id,
            type: 'folder',
            name,
            parentId: parentId || null
        });
        res.status(201).json({ success: true, data: folder });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

const uploadFile = async (req, res) => {
    try {
        const { title, parentId, doctorName, notes, date } = req.body; // 'date' extracted from frontend form
        if (!req.files || req.files.length === 0) return res.status(400).json({ message: "No images selected" });

        const filePaths = req.files.map(f => `/uploads/locker/${f.filename}`);

        const file = await HealthLocker.create({
            userId: req.user.id,
            type: 'file',
            name: title,
            parentId: parentId || null,
            doctorName,
            notes,
            images: filePaths,
            fileCount: filePaths.length,
            date: date ? new Date(date) : Date.now() // Syncs selected date or defaults to current date
        });
        res.status(201).json({ success: true, data: file });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

const getLockerContent = async (req, res) => {
    try {
        const { parentId } = req.query;
        const query = { 
            userId: req.user.id, 
            parentId: parentId || null 
        };

        const items = await HealthLocker.find(query).sort({ type: 1, createdAt: -1 });
        
        const formattedItems = await Promise.all(items.map(async (item) => {
            if (item.type === 'folder') {
                const childCount = await HealthLocker.countDocuments({ parentId: item._id });
                return { ...item._doc, childCount };
            }
            return item;
        }));

        // Breadcrumbs optimization: Ek additional check current directory name fetch karne ke liye
        let currentFolder = null;
        if (parentId) {
            const folderMeta = await HealthLocker.findOne({ _id: parentId, userId: req.user.id, type: 'folder' }).select('name');
            if (folderMeta) {
                currentFolder = { id: folderMeta._id, name: folderMeta.name };
            }
        }

        // Response formatting keeps standard 'data' array but appends optional folder tracking metadata
        res.json({ 
            success: true, 
            data: formattedItems,
            currentFolder // Non-breaking additive field
        });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

const renameItem = async (req, res) => {
    try {
        const updated = await HealthLocker.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            { name: req.body.newName },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ success: false, message: "Item not found or unauthorized" });
        }

        res.json({ success: true, data: updated });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

// Deletes item recursively (along with nested contents and actual physical files)
const deleteItem = async (req, res) => {
    try {
        const item = await HealthLocker.findOne({ _id: req.params.id, userId: req.user.id });
        if (!item) return res.status(404).json({ success: false, message: "Not found" });

        if (item.type === 'folder') {
            // Delete nested folders, subfolders, files, and physical images recursively
            await recursiveDelete(item._id, req.user.id);
        } else if (item.type === 'file' && item.images) {
            // Delete physical file from filesystem
            deletePhysicalFiles(item.images);
        }
        
        await HealthLocker.findByIdAndDelete(item._id);
        res.json({ success: true, message: "Deleted successfully" });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

const addMorePages = async (req, res) => {
    try {
        const newImages = req.files.map(f => `/uploads/locker/${f.filename}`);
        const updated = await HealthLocker.findByIdAndUpdate(
            req.params.id,
            { 
                $push: { images: { $each: newImages } },
                $inc: { fileCount: newImages.length }
            },
            { new: true }
        );
        res.json({ success: true, data: updated });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
};

// --- 1. GLOBAL SEARCH ---
const searchLocker = async (req, res) => {
    try {
        const { query } = req.query; // Search keyword (e.g., ?query=blood)
        if (!query) {
            return res.status(400).json({ success: false, message: "Search query is required" });
        }

        const items = await HealthLocker.find({
            userId: req.user.id,
            $or: [
                { name: { $regex: query, $options: 'i' } },
                { doctorName: { $regex: query, $options: 'i' } },
                { notes: { $regex: query, $options: 'i' } }
            ]
        }).sort({ type: 1, createdAt: -1 });

        res.json({ success: true, data: items });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. MOVE ITEM (Change Folder Location) ---
const moveLockerItem = async (req, res) => {
    try {
        const { itemId, targetParentId } = req.body; // targetParentId can be null for root folder

        // Guard against moving an item inside itself
        if (itemId === targetParentId) {
            return res.status(400).json({ success: false, message: "Cannot move item inside itself" });
        }

        // Target folder target exists verification
        if (targetParentId) {
            const targetFolder = await HealthLocker.findOne({ _id: targetParentId, userId: req.user.id });
            if (!targetFolder || targetFolder.type !== 'folder') {
                return res.status(400).json({ success: false, message: "Invalid target destination folder" });
            }
        }

        const updated = await HealthLocker.findOneAndUpdate(
            { _id: itemId, userId: req.user.id },
            { parentId: targetParentId || null },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ success: false, message: "Item not found" });
        }

        res.json({ success: true, message: "Item moved successfully", data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. DELETE SINGLE PAGE / IMAGE FROM A FILE ---
const deleteSinglePage = async (req, res) => {
    try {
        const { fileId, imageUrl } = req.body; // Document ID aur us specific image ka local URL path

        const fileDoc = await HealthLocker.findOne({ _id: fileId, userId: req.user.id, type: 'file' });
        if (!fileDoc) {
            return res.status(404).json({ success: false, message: "Document not found" });
        }

        // Check if image exists in document array
        if (!fileDoc.images.includes(imageUrl)) {
            return res.status(400).json({ success: false, message: "Image path not found in this document" });
        }

        // Delete physical file from server storage
        const absolutePath = path.join(__dirname, '../../..', imageUrl);
        fs.unlink(absolutePath, (err) => {
            if (err) console.error(`Error deleting file path ${absolutePath}:`, err.message);
        });

        // Update the array database metrics
        const updated = await HealthLocker.findByIdAndUpdate(
            fileId,
            {
                $pull: { images: imageUrl },
                $inc: { fileCount: -1 }
            },
            { new: true }
        );

        res.json({ success: true, message: "Page removed successfully", data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// --- ADDON 1: GET FOLDER PATH BREADCRUMBS ---
// Yeh dynamic nested folders ka path structure return karega hierarchy me navigations ke liye
const getFolderPath = async (req, res) => {
    try {
        const pathList = [];
        let currentParentId = req.params.folderId;

        // Loop chalakar hum child se root tak travel karenge
        while (currentParentId) {
            const folder = await HealthLocker.findOne({ 
                _id: currentParentId, 
                userId: req.user.id,
                type: 'folder'
            }).select('name parentId');

            if (!folder) break;

            // pathList ke start me insert karenge taaki order: Root -> Subfolder1 -> Subfolder2 rahe
            pathList.unshift({
                id: folder._id,
                name: folder.name
            });

            currentParentId = folder.parentId;
        }

        res.json({ success: true, data: pathList });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- ADDON 2: GET SINGLE FILE/FOLDER DETAILS ---
// Kisi single document ki update checking ya viewing screen ke liye
const getSingleItemDetails = async (req, res) => {
    try {
        const item = await HealthLocker.findOne({ 
            _id: req.params.id, 
            userId: req.user.id 
        });

        if (!item) {
            return res.status(404).json({ success: false, message: "Item not found" });
        }

        res.json({ success: true, data: item });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { 
    checkLockerPinStatus,
    setupLockerPin,
    verifyLockerPin, 
    changeLockerPin,
    resetLockerPin,
    createFolder, 
    uploadFile, 
    getLockerContent, 
    renameItem, 
    deleteItem, 
    addMorePages ,
    searchLocker,
    moveLockerItem,
    deleteSinglePage,
    getFolderPath,
    getSingleItemDetails
};