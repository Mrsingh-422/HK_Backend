// controllers/provider/Pharmacy/ComboOffers.js
const PharmacyComboOffer = require('../../../models/PharmacyComboOffer');
const MedicineInventory = require('../../../models/MedicineInventory');

// 1. DEPLOY BOGO OFFER (Create Campaign with Multiple Images)
const createComboOffer = async (req, res) => {
    try {
        const { campaignDisplayName, medicineId, buyQty, getFreeQty, startDate, expiryDate, projectedPromoMargin } = req.body;
        const pharmacyId = req.user.id;

        const hasInventory = await MedicineInventory.findOne({ pharmacyId, medicineId });
        if (!hasInventory) {
            return res.status(400).json({ success: false, message: "This medicine must exist in your inventory before launching promo offers." });
        }

        // Process uploaded images paths from Multer fields
        let uploadedImages = [];
        if (req.files && req.files['images']) {
            uploadedImages = req.files['images'].map(file => file.path);
        }

        const newOffer = await PharmacyComboOffer.create({
            pharmacyId,
            campaignDisplayName,
            medicineId,
            images: uploadedImages, // Save paths array
            buyQty: Number(buyQty || 2),
            getFreeQty: Number(getFreeQty || 1),
            startDate: new Date(startDate),
            expiryDate: new Date(expiryDate),
            projectedPromoMargin: Number(projectedPromoMargin || 50.0),
            isActive: true
        });

        res.status(201).json({
            success: true,
            message: "BOGO Offer deployed successfully with images!",
            data: newOffer
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. GET CAMPAIGN REGISTRY LIST (Figma Registry Table)
const getMyComboOffers = async (req, res) => {
    try {
        const pharmacyId = req.user.id;
        const offers = await PharmacyComboOffer.find({ pharmacyId })
            .populate('medicineId', 'name mrp best_price')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: offers.length,
            data: offers
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. TOGGLE CAMPAIGN STATUS (Active/Inactive Toggle)
const toggleComboOfferStatus = async (req, res) => {
    try {
        const pharmacyId = req.user.id;
        const { offerId } = req.params; // FIXED: Changed from 'id' to 'offerId' to match the router

        const offer = await PharmacyComboOffer.findOne({ _id: offerId, pharmacyId });
        if (!offer) {
            return res.status(404).json({ success: false, message: "Campaign not found" });
        }

        offer.isActive = !offer.isActive;
        await offer.save();

        res.json({
            success: true,
            message: `Campaign status updated to ${offer.isActive ? 'Active' : 'Paused'}.`,
            data: offer
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. UPDATE COMBO OFFER (Update Campaign with Optional New Images)
const updateComboOffer = async (req, res) => {
    try {
        const pharmacyId = req.user.id;
        const { offerId } = req.params;
        const { campaignDisplayName, buyQty, getFreeQty, startDate, expiryDate, isActive } = req.body;

        const updateData = {
            campaignDisplayName, 
            buyQty, 
            getFreeQty, 
            startDate: startDate ? new Date(startDate) : undefined, 
            expiryDate: expiryDate ? new Date(expiryDate) : undefined,
            isActive 
        };

        // If new images are uploaded, update the images array
        if (req.files && req.files['images']) {
            updateData.images = req.files['images'].map(file => file.path);
        }

        const updatedOffer = await PharmacyComboOffer.findOneAndUpdate(
            { _id: offerId, pharmacyId },
            updateData,
            { new: true }
        );

        if (!updatedOffer) {
            return res.status(404).json({ success: false, message: "Campaign not found or unauthorized" });
        }

        res.json({
            success: true,
            message: "Campaign offer updated successfully!",
            data: updatedOffer
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// 5. DELETE COMBO OFFER (Delete Action)
const deleteComboOffer = async (req, res) => {
    try {
        const pharmacyId = req.user.id;
        const { offerId } = req.params; // FIXED: Changed from 'id' to 'offerId' to match the router

        const deleted = await PharmacyComboOffer.findOneAndDelete({ _id: offerId, pharmacyId });
        if (!deleted) {
            return res.status(404).json({ success: false, message: "Campaign not found or unauthorized" });
        }

        res.json({
            success: true,
            message: "Campaign deleted from Registry successfully!"
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createComboOffer,
    getMyComboOffers,
    toggleComboOfferStatus,
    updateComboOffer,
    deleteComboOffer
};