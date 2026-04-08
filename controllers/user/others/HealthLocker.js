const HealthLocker = require('../../../models/HealthLocker');
const User = require('../../../models/User');

// --- 1. UNLOCK LOCKER (Figma Screen 8/12) ---
const verifyLockerPin = async (req, res) => {
    try {
        const { pin } = req.body;
        const user = await User.findById(req.user.id).select('+healthLockerPin');
        
        if (!user.healthLockerPin || user.healthLockerPin !== pin) {
            return res.status(401).json({ success: false, message: "Invalid PIN" });
        }
        res.json({ success: true, message: "Vault Unlocked" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 2. CREATE FOLDER (Figma: Jab user + dabake folder chunega) ---
const createFolder = async (req, res) => {
    try {
        const { name, parentId } = req.body; // parentId optional hai (nesting ke liye)
        const folder = await HealthLocker.create({
            userId: req.user.id,
            type: 'folder',
            name,
            parentId: parentId || null
        });
        res.status(201).json({ success: true, data: folder });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 3. UPLOAD FILE (Figma Screen 10) ---
const uploadFile = async (req, res) => {
    try {
        const { title, parentId, doctorName, notes } = req.body;
        if (!req.files || req.files.length === 0) return res.status(400).json({ message: "No images selected" });

        const filePaths = req.files.map(f => `/uploads/locker/${f.filename}`);

        const file = await HealthLocker.create({
            userId: req.user.id,
            type: 'file',
            name: title, // File name title hi hai
            parentId: parentId || null,
            doctorName,
            notes,
            images: filePaths,
            fileCount: filePaths.length
        });
        res.status(201).json({ success: true, data: file });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 4. GET CONTENT (Root ya Kisi Folder ke andar ka data) ---
const getLockerContent = async (req, res) => {
    try {
        const { parentId } = req.query; // Agar query me parentId nahi hai to root dikhayega
        const query = { 
            userId: req.user.id, 
            parentId: parentId || null 
        };

        const items = await HealthLocker.find(query).sort({ type: 1, createdAt: -1 });
        
        // Count details for UI badges
        const formattedItems = await Promise.all(items.map(async (item) => {
            if (item.type === 'folder') {
                const childCount = await HealthLocker.countDocuments({ parentId: item._id });
                return { ...item._doc, childCount };
            }
            return item;
        }));

        res.json({ success: true, data: formattedItems });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 5. RENAME ITEM (Folder ya File) ---
const renameItem = async (req, res) => {
    try {
        const updated = await HealthLocker.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            { name: req.body.newName },
            { new: true }
        );
        res.json({ success: true, data: updated });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 6. DELETE ITEM (Recursive: Agar folder hai to andar ka sab delete) ---
const deleteItem = async (req, res) => {
    try {
        const item = await HealthLocker.findOne({ _id: req.params.id, userId: req.user.id });
        if (!item) return res.status(404).json({ message: "Not found" });

        if (item.type === 'folder') {
            // Folder ke andar ke saare nested items delete karein
            await HealthLocker.deleteMany({ parentId: item._id });
        }
        
        await HealthLocker.findByIdAndDelete(item._id);
        res.json({ success: true, message: "Deleted successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 7. ADD MORE PAGES (Figma Screen 11) ---
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
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { 
    verifyLockerPin, createFolder, uploadFile, 
    getLockerContent, renameItem, deleteItem, addMorePages 
};