const AdminArticle = require('../../../models/AdminArticle');
const fs = require('fs');
const path = require('path');

// 1. CREATE ARTICLE
const createArticle = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: "At least one image is required" });
        }

        const imagePaths = req.files.map(file => `/uploads/articles/${file.filename}`);

        const article = await AdminArticle.create({
            ...req.body,
            images: imagePaths,
            createdBy: req.user.id
        });
        res.status(201).json({ success: true, data: article });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. GET ALL ARTICLES (Admin List)
const getAllArticles = async (req, res) => {
    try {
        const articles = await AdminArticle.find().sort({ createdAt: -1 });
        res.json({ success: true, data: articles });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. UPDATE ARTICLE
const updateArticle = async (req, res) => {
    try {
        const article = await AdminArticle.findById(req.params.id);
        if (!article) return res.status(404).json({ message: "Article not found" });

        let updateData = { ...req.body };

        if (req.files && req.files.length > 0) {
            // Delete old images from disk
            article.images.forEach(img => {
                const oldPath = path.join(__dirname, '../../../public', img);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            });
            updateData.images = req.files.map(file => `/uploads/articles/${file.filename}`);
        }

        const updated = await AdminArticle.findByIdAndUpdate(req.params.id, updateData, { new: true });
        res.json({ success: true, data: updated });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. DELETE ARTICLE
const deleteArticle = async (req, res) => {
    try {
        const article = await AdminArticle.findByIdAndDelete(req.params.id);
        if (article) {
            article.images.forEach(img => {
                const imgPath = path.join(__dirname, '../../../public', img);
                if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
            });
        }
        res.json({ success: true, message: "Deleted" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { createArticle, getAllArticles, updateArticle, deleteArticle };