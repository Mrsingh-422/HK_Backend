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

// 1. ADMIN LIST (Draft + Published)
const getAdminArticles = async (req, res) => {
    try {
        const { category, status } = req.query;
        let query = {}; // Khali object yaani sab kuch
        
        if (category) query.category = category;
        if (status) query.status = status;

        const articles = await AdminArticle.find(query).sort({ createdAt: -1 });
        res.json({ success: true, count: articles.length, data: articles });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};
// 2. USER/APP LIST (Sirf Published)
const getAllArticles = async (req, res) => {
    try {
        const { category, subCategory } = req.query;
        
        // Logic: Hamesha status 'Published' hi hona chahiye
        let query = { status: 'Published' }; 

        if (category) query.category = category;
        if (subCategory) query.subCategory = subCategory;

        const articles = await AdminArticle.find(query).sort({ createdAt: -1 });
        res.json({ success: true, count: articles.length, data: articles });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
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

// 1. GET ENUMS FOR DROPDOWNS (Category & SubCategory)
const getArticleEnums = async (req, res) => {
    try {
        const categories = AdminArticle.schema.path('category').enumValues;
        const subCategories = AdminArticle.schema.path('subCategory').enumValues;

        res.json({
            success: true,
            data: { categories, subCategories }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. GET SINGLE ARTICLE DETAILS (For Edit/View)
const getArticleById = async (req, res) => {
    try {
        const article = await AdminArticle.findById(req.params.id);
        if (!article) return res.status(404).json({ message: "Article not found" });
        res.json({ success: true, data: article });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. TOGGLE STATUS (Published <-> Draft)
const toggleArticleStatus = async (req, res) => {
    try {
        const article = await AdminArticle.findById(req.params.id);
        if (!article) return res.status(404).json({ message: "Article not found" });

        article.status = article.status === 'Published' ? 'Draft' : 'Published';
        await article.save();

        res.json({ 
            success: true, 
            message: `Article is now ${article.status}`, 
            status: article.status 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { createArticle, getAdminArticles,getAllArticles, updateArticle, deleteArticle, getArticleEnums, getArticleById, toggleArticleStatus };