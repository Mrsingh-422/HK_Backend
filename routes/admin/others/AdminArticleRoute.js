const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { articleUploads } = require('../../../middleware/multer');
const { 
    createArticle,getAdminArticles, getAllArticles, updateArticle, deleteArticle ,getArticleEnums, getArticleById, toggleArticleStatus
} = require('../../../controllers/admin/others/AdminArticle');

// base URL: /admin/articles

router.post('/add', protect('admin'), articleUploads, createArticle);
router.get('/enums', getArticleEnums);

router.get('/list-for-admin', protect('admin'), getAdminArticles);
router.get('/list', getAllArticles);
router.get('/details/:id', getArticleById);

router.put('/update/:id', protect('admin'), articleUploads, updateArticle);
router.patch('/toggle-status/:id', protect('admin'), toggleArticleStatus);
router.delete('/delete/:id', protect('admin'), deleteArticle);

module.exports = router;