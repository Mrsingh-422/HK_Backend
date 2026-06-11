const express = require('express');
const router = express.Router();
const { protect } = require('../../../middleware/authMiddleware');
const { comboOfferUploads } = require('../../../middleware/multer');

const { 
    createComboOffer,
    getMyComboOffers,
    toggleComboOfferStatus,
    updateComboOffer,
    deleteComboOffer
} = require('../../../controllers/provider/Pharmacy/ComboOffers');

// Base URL: /provider/pharmacy/combo-offers

// 1. Create new BOGO/Combo Offer
router.post('/', protect('pharmacy'), comboOfferUploads, createComboOffer);

// 2. Get all my combo offers (Campaign Registry)
router.get('/my-offers', protect('pharmacy'), getMyComboOffers);

// 3. Toggle offer status (Active/Inactive)
router.patch('/:offerId/toggle', protect('pharmacy'), toggleComboOfferStatus);

// 4. Update existing combo offer details
router.put('/:offerId', protect('pharmacy'), comboOfferUploads, updateComboOffer);

// 5. Delete a combo offer
router.delete('/:offerId', protect('pharmacy'), deleteComboOffer);

module.exports = router;