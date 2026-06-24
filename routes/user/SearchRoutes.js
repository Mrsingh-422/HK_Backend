// routes/user/homepageSearch.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware'); // Apne secure auth middleware ka path likhein
const { getHomepageSuggestions, searchHomepage, handleChatBotMessage,
    getUserCoupons
 } = require('../../controllers/user/SearchController');

// Base URL: /user/homepage

// 1. Suggestions API
router.get('/suggestions', getHomepageSuggestions);

// 2. Main Deep Search API
router.get('/search', searchHomepage);

// 3. New Chatbot API (Authentication protected)
router.post('/chatbot', protect('user'), handleChatBotMessage);





// 4. Get User Coupons (Authentication protected)
router.get('/coupons', getUserCoupons);

module.exports = router; 