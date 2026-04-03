const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { articleUploads } = require('../../../middleware/multer');
const { 
    createArticle, getAllArticles, updateArticle, deleteArticle 
} = require('../../../controllers/admin/others/AdminArticle');

// base URL: /admin/articles

router.post('/add', protect('admin'), articleUploads, createArticle);
router.get('/list', getAllArticles);
router.put('/update/:id', protect('admin'), articleUploads, updateArticle);
router.delete('/delete/:id', protect('admin'), deleteArticle);

module.exports = router;