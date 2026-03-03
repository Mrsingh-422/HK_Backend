const express = require('express');
const router = express.Router();
const { protect } = require('../../../../middleware/authMiddleware');
const { updateFooter, getFooter } = require('../../../../controllers/admin/user/Home/FooterController');

// Base URL: /api/footer

// Public Route (For displaying footer on website)
router.get('/', getFooter);

// Admin Route (For saving settings)
router.post('/', protect('admin'), updateFooter);

module.exports = router; 