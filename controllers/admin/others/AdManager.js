const AdManager = require('../../../models/AdManager');
const fs = require('fs');
const path = require('path');

// 1. CREATE AD
const createAd = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: "At least one image is required" });
        }

        const imagePaths = req.files.map(file => `/uploads/ads/${file.filename}`);

        const ad = await AdManager.create({
            ...req.body,
            images: imagePaths,
            createdBy: req.user.id
        });
        res.status(201).json({ success: true, message: "Advertisement published", data: ad });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. LIST ALL ADS (Admin)
const getAllAds = async (req, res) => {
    try {
        const ads = await AdManager.find().sort({ createdAt: -1 });
        res.json({ success: true, data: ads });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. UPDATE AD
const updateAd = async (req, res) => {
    try {
        const ad = await AdManager.findById(req.params.id);
        if (!ad) return res.status(404).json({ message: "Ad not found" });

        let updateData = { ...req.body };

        if (req.files && req.files.length > 0) {
            // Delete old images
            ad.images.forEach(img => {
                const oldPath = path.join(__dirname, '../../../public', img);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            });
            updateData.images = req.files.map(file => `/uploads/ads/${file.filename}`);
        }

        const updatedAd = await AdManager.findByIdAndUpdate(req.params.id, updateData, { new: true });
        res.json({ success: true, message: "Ad updated", data: updatedAd });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. DELETE AD
const deleteAd = async (req, res) => {
    try {
        const ad = await AdManager.findById(req.params.id);
        if (ad) {
            ad.images.forEach(img => {
                const imgPath = path.join(__dirname, '../../../public', img);
                if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
            });
            await AdManager.findByIdAndDelete(req.params.id);
        }
        res.json({ success: true, message: "Ad deleted successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 5. GET ADS BY PAGE (For App Display)
const getAdsByPage = async (req, res) => {
    try {
        const { page } = req.query; // e.g. Medicine Store
        const ads = await AdManager.find({ page: page, status: 'Active' });
        res.json({ success: true, data: ads });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { createAd, getAllAds, updateAd, deleteAd, getAdsByPage };