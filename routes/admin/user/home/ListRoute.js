const express = require('express');
const router = express.Router();
const { protect } = require('../../../../middleware/authMiddleware');
const { contentUploads } = require('../../../../middleware/multer');

const {
    addDoctor, updateDoctor, getDoctors, deleteDoctor,
    addFaq, updateFaq, getFaqs, deleteFaq,
    addArticle, updateArticle, getArticles, deleteArticle,
    addAffiliate, updateAffiliate, getAffiliates, deleteAffiliate
} = require('../../../../controllers/admin/user/Home/ListController');

// endpoints base URL: /api/homepage/list (defined in server.js)

// ==================================================
// 1. DOCTORS TEAM
// ==================================================
router.get('/doctors', getDoctors); // Public
router.post('/doctors', protect('admin'), contentUploads, addDoctor); // Admin
router.put('/doctors/:id', protect('admin'), contentUploads, updateDoctor); // Admin
router.delete('/doctors/:id', protect('admin'), deleteDoctor); // Admin

// ==================================================
// 2. FAQs
// ==================================================
router.get('/faqs', getFaqs); // Public
router.post('/faqs', protect('admin'), addFaq); // Admin
router.put('/faqs/:id', protect('admin'), updateFaq); // Admin
router.delete('/faqs/:id', protect('admin'), deleteFaq); // Admin

// ==================================================
// 3. ARTICLES
// ==================================================
router.get('/articles', getArticles); // Public
router.post('/articles', protect('admin'), contentUploads, addArticle); // Admin
router.put('/articles/:id', protect('admin'), contentUploads, updateArticle); // Admin
router.delete('/articles/:id', protect('admin'), deleteArticle); // Admin

// ==================================================
// 4. AFFILIATES / SERVICE PARTNERS
// ==================================================
router.get('/affiliates', getAffiliates); // Public
router.post('/affiliates', protect('admin'), contentUploads, addAffiliate); // Admin
router.put('/affiliates/:id', protect('admin'), contentUploads, updateAffiliate); // Admin
router.delete('/affiliates/:id', protect('admin'), deleteAffiliate); // Admin

module.exports = router;