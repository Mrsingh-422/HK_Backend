const TeamMember = require('../../../../models/TeamMember');
const Faq = require('../../../../models/Faq');
const Article = require('../../../../models/Article');
const Affiliate = require('../../../../models/Affiliate');

// =========================================================
// 1. DOCTORS TEAM CONTROLLER
// =========================================================

// @desc    Add Doctor
const addDoctor = async (req, res) => {
    try {
        const { specialization, description, facebook, twitter, phone } = req.body;
        
        let image = '';
        if (req.files && req.files.length > 0) {
            image = `/uploads/homepage/${req.files[0].filename}`;
        }

        const doctor = await TeamMember.create({
            specialization, description, facebook, twitter, phone, image
        });
        res.status(201).json({ success: true, message: 'Doctor added', data: doctor });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// @desc    Update Doctor
const updateDoctor = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        if (req.files && req.files.length > 0) {
            updates.image = `/uploads/homepage/${req.files[0].filename}`;
        }

        const doctor = await TeamMember.findByIdAndUpdate(id, updates, { new: true });
        res.status(200).json({ success: true, message: 'Doctor updated', data: doctor });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// @desc    Get All Doctors
const getDoctors = async (req, res) => {
    try {
        const doctors = await TeamMember.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: doctors });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// @desc    Delete Doctor
const deleteDoctor = async (req, res) => {
    try {
        await TeamMember.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: 'Doctor deleted' });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// =========================================================
// 2. FAQ CONTROLLER
// =========================================================

const addFaq = async (req, res) => {
    try {
        const { question, answer } = req.body;
        const faq = await Faq.create({ question, answer });
        res.status(201).json({ success: true, message: 'FAQ added', data: faq });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const updateFaq = async (req, res) => {
    try {
        const { id } = req.params;
        const faq = await Faq.findByIdAndUpdate(id, req.body, { new: true });
        res.status(200).json({ success: true, message: 'FAQ updated', data: faq });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getFaqs = async (req, res) => {
    try {
        const faqs = await Faq.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: faqs });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const deleteFaq = async (req, res) => {
    try {
        await Faq.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: 'FAQ deleted' });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// =========================================================
// 3. ARTICLES CONTROLLER
// =========================================================

const addArticle = async (req, res) => {
    try {
        const { title, description } = req.body;
        let image = '';
        if (req.files && req.files.length > 0) {
            image = `/uploads/homepage/${req.files[0].filename}`;
        }
        const article = await Article.create({ title, description, image });
        res.status(201).json({ success: true, message: 'Article added', data: article });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const updateArticle = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        if (req.files && req.files.length > 0) {
            updates.image = `/uploads/homepage/${req.files[0].filename}`;
        }

        const article = await Article.findByIdAndUpdate(id, updates, { new: true });
        res.status(200).json({ success: true, message: 'Article updated', data: article });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getArticles = async (req, res) => {
    try {
        const articles = await Article.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: articles });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const deleteArticle = async (req, res) => {
    try {
        await Article.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: 'Article deleted' });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// =========================================================
// 4. AFFILIATES / SERVICE PARTNERS CONTROLLER
// =========================================================

const addAffiliate = async (req, res) => {
    try {
        const { title, description, facebook, twitter, phone } = req.body;
        
        let image = '';
        if (req.files && req.files.length > 0) {
            image = `/uploads/homepage/${req.files[0].filename}`;
        }

        const affiliate = await Affiliate.create({
            title, description, facebook, twitter, phone, image
        });
        res.status(201).json({ success: true, message: 'Affiliate added', data: affiliate });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const updateAffiliate = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        if (req.files && req.files.length > 0) {
            updates.image = `/uploads/homepage/${req.files[0].filename}`;
        }

        const affiliate = await Affiliate.findByIdAndUpdate(id, updates, { new: true });
        res.status(200).json({ success: true, message: 'Affiliate updated', data: affiliate });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getAffiliates = async (req, res) => {
    try {
        const affiliates = await Affiliate.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: affiliates }); // React expects array directly or inside data
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const deleteAffiliate = async (req, res) => {
    try {
        await Affiliate.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: 'Affiliate deleted' });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = {
    addDoctor, updateDoctor, getDoctors, deleteDoctor,
    addFaq, updateFaq, getFaqs, deleteFaq,
    addArticle, updateArticle, getArticles, deleteArticle,
    addAffiliate, updateAffiliate, getAffiliates, deleteAffiliate
};