const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { articleUploads } = require('../../../middleware/multer');
const { 
    createArticle,getAdminArticles, getAllArticles, updateArticle, deleteArticle ,getArticleEnums, getArticleById, toggleArticleStatus
} = require('../../../controllers/admin/others/AdminArticle');

// base URL: /admin/articles

router.post('/add', protect('admin'), checkRoleAccess(14),articleUploads, createArticle);
router.get('/enums', getArticleEnums);

router.get('/list-for-admin', protect('admin'), checkRoleAccess(14), getAdminArticles);
router.get('/list', getAllArticles);
router.get('/details/:id', getArticleById);

router.put('/update/:id', protect('admin'), checkRoleAccess(14), articleUploads, updateArticle);
router.patch('/toggle-status/:id', protect('admin'), checkRoleAccess(14), toggleArticleStatus);
router.delete('/delete/:id', protect('admin'), checkRoleAccess(14), deleteArticle);

module.exports = router;