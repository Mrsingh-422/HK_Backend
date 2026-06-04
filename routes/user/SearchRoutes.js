// routes/user/homepageSearch.js
const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/authMiddleware'); // Apne secure auth middleware ka path likhein
const { getHomepageSuggestions, searchHomepage, handleChatBotMessage } = require('../../controllers/user/SearchController');

// 1. Suggestions API
router.get('/suggestions', getHomepageSuggestions);

// 2. Main Deep Search API
router.get('/search', searchHomepage);

// 3. New Chatbot API (Authentication protected)
router.post('/chatbot', protect('user'), handleChatBotMessage);

module.exports = router; 