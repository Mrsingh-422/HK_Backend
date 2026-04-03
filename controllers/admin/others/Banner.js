const Banner = require('../../../models/Banner');
const path = require('path');
const fs = require('fs');


// 1. ADMIN: CREATE BANNER (Multiple Images)
const createBanner = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: "At least one banner image is required" });
        }

        // Sabhi files ke paths ka array banayein
        const imagePaths = req.files.map(file => `/uploads/banners/${file.filename}`);

        const banner = await Banner.create({
            ...req.body,
            image: imagePaths, // Array save hoga
            createdBy: req.user.id
        });

        res.status(201).json({ success: true, message: "Banners published", data: banner });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 2. ADMIN: UPDATE BANNER
const updateBanner = async (req, res) => {
    try {
        const banner = await Banner.findById(req.params.id);
        if (!banner) return res.status(404).json({ message: "Banner not found" });

        let updateData = { ...req.body };

        // Agar nayi images upload hui hain toh purani delete karke nayi save karein
        if (req.files && req.files.length > 0) {
            // Purani sabhi images delete karein disk se
            banner.image.forEach(img => {
                const oldPath = path.join(__dirname, '../../../public', img);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            });

            // Nayi images ka array banayein
            updateData.image = req.files.map(file => `/uploads/banners/${file.filename}`);
        }

        const updatedBanner = await Banner.findByIdAndUpdate(
            req.params.id,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        res.json({ success: true, message: "Banner updated successfully", data: updatedBanner });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. ADMIN: DELETE BANNER
const deleteBanner = async (req, res) => {
    try {
        const banner = await Banner.findById(req.params.id);
        if (!banner) return res.status(404).json({ message: "Banner not found" });

        // Disk se saari images delete karein
        banner.image.forEach(img => {
            const filePath = path.join(__dirname, '../../../public', img);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        });

        await Banner.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Banner and images deleted successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// 3. ADMIN: GET ALL BANNERS (For Dashboard List)
const getAllBanners = async (req, res) => {
    try {
        const banners = await Banner.find().sort({ createdAt: -1 });
        res.json({ success: true, data: banners });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// 5. APP/USER: GET BANNERS BY CATEGORY (Home, Medicine, etc.)
// Endpoint: GET /api/banners/display?category=Medicine
const getAppBanners = async (req, res) => {
    try {
        const { category } = req.query;
        const query = { status: 'Active' };
        
        if (category) {
            query.category = category;
        }

        const banners = await Banner.find(query).sort({ priority: 1 });
        res.json({ success: true, data: banners });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { createBanner, getAllBanners, updateBanner, deleteBanner, getAppBanners };