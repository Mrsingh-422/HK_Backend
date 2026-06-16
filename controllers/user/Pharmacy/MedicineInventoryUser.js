const MedicineInventory = require('../../../models/MedicineInventory');
const Medicine = require('../../../models/Medicine');
const PharmacyComboOffer = require('../../../models/PharmacyComboOffer');

const getMedicineInventory = async (req, res) => {
    const { medicineId } = req.params;
    
    // Sabse pehle Master Data uthao
    const masterData = await Medicine.findById(medicineId);

    // Phir check karo kaun-kaun se vendors ise bech rahe hain
    const offers = await MedicineInventory.find({ medicineId, is_available: true })
        .populate('pharmacyId', 'name address rating location') // Shop details
        .sort({ vendor_price: 1 }); // Sasta price sabse pehle

    res.json({
        medicine: masterData,
        available_at: offers
    });
};
// --- 1. SEARCH MEDICINES (Homepage/List View) ---
// Isme hum dikhayenge master data + uska sabse sasta wala vendor price
const searchMedicinesUser = async (req, res) => {
    try {
        const { query, category, page = 1 } = req.body;
        const limit = 20;
        const skip = (page - 1) * limit;

        let filter = {};
        if (query) {
            filter.$or = [
                { name: { $regex: query, $options: 'i' } },
                { salt_composition: { $regex: query, $options: 'i' } }
            ];
        }
        if (category && category !== 'All') filter.category = category;

        const medicines = await Medicine.find(filter).skip(skip).limit(limit).lean();

        // Har medicine ke liye sabse sasta offer nikalein
        const dataWithOffers = await Promise.all(medicines.map(async (med) => {
            const bestOffer = await MedicineInventory.findOne({ medicineId: med._id, is_available: true })
                .sort({ vendor_price: 1 }) // Sabse sasta pehle
                .populate('pharmacyId', 'name rating');
            
            return {
                ...med,
                best_vendor_price: bestOffer ? bestOffer.vendor_price : null,
                vendor_id: bestOffer ? bestOffer.pharmacyId._id : null,
                pharmacy_name: bestOffer ? bestOffer.pharmacyId.name : null
            };
        }));

        res.json({ success: true, data: dataWithOffers });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 2. MEDICINE DETAILS (Figma Screen: Detailed View) ---
const getMedicineFullDetails = async (req, res) => {
    try {
        const { medicineId } = req.params;
        const medicine = await Medicine.findById(medicineId).lean();
        if (!medicine) return res.status(404).json({ message: "Not found" });

        // 1. Substitutes (Salt match)
        const substitutes = await Medicine.find({ 
            salt_composition: medicine.salt_composition, 
            _id: { $ne: medicineId } 
        }).limit(3);

        // 2. Popular/Frequently bought together logic
        const frequentlyBought = await Medicine.find({ 
            category: medicine.category, 
            _id: { $ne: medicineId } 
        }).limit(4);

        res.json({
            success: true,
            data: {
                details: medicine, // Isme safety_advise, side_effect, how_to_use fields hain
                frequentlyBought,
                substitutes
            }
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 3. COMPARE SELLERS (Figma Screen: Choose Pharmacy) ---
// --- 2. POPULATE COMBO OFFERS IN SELLERS COMPARISON SCREEN ---
const getSellersForMedicine = async (req, res) => {
    try {
        const { medicineId } = req.params;
        const today = new Date();
        
        const sellers = await MedicineInventory.find({ medicineId, is_available: true })
            .populate('pharmacyId', 'name address rating profileImage city location')
            .sort({ vendor_price: 1 })
            .lean();

        // Enforce active BOGO tags on each seller row so the patient can choose the store with best combo deal [1]
        const sellersWithOffers = await Promise.all(sellers.map(async (seller) => {
            if (!seller.pharmacyId) return null;

            const activePromo = await PharmacyComboOffer.findOne({
                pharmacyId: seller.pharmacyId._id,
                medicineId: seller.medicineId,
                isActive: true,
                startDate: { $lte: today },
                expiryDate: { $gte: today }
            }).lean();

            return {
                ...seller,
                comboOffer: activePromo ? {
                    offerId: activePromo._id,
                    campaignDisplayName: activePromo.campaignDisplayName,
                    buyQty: activePromo.buyQty,
                    getFreeQty: activePromo.getFreeQty,
                    images: activePromo.images || []
                } : null
            };
        }));

        res.json({ 
            success: true, 
            data: sellersWithOffers.filter(s => s !== null) 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};
// --- 1. POPULATE ACTIVE BOGO OFFERS IN STORE'S MEDICINE CATALOGUE ---
const getPharmacySpecificMedicines = async (req, res) => {
    try {
        const { pharmacyId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = 20; 
        const skip = (page - 1) * limit;
        const today = new Date();

        const total = await MedicineInventory.countDocuments({ 
            pharmacyId, 
            is_available: true 
        });

        const inventory = await MedicineInventory.find({ 
            pharmacyId, 
            is_available: true 
        })
        .populate({
            path: 'medicineId',
            select: 'name mrp packaging image_url prescription_required salt'
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

        // Har item ke liye check karenge ki kya koi Active Combo BOGO Offer chal raha hai
        const formattedMedicines = await Promise.all(inventory.map(async (item) => {
            const med = item.medicineId;
            if (!med) return null;

            const activePromo = await PharmacyComboOffer.findOne({
                pharmacyId,
                medicineId: med._id,
                isActive: true,
                startDate: { $lte: today },
                expiryDate: { $gte: today }
            }).lean();

            return {
                inventoryId: item._id,
                medicineId: med._id,
                name: med.name,
                salt: med.salt,
                image: med.image_url && med.image_url.length > 0 ? med.image_url[0] : null,
                mrp: med.mrp,
                vendorPrice: item.vendor_price,
                discountPercentage: med.mrp > item.vendor_price 
                    ? Math.round(((med.mrp - item.vendor_price) / med.mrp) * 100) 
                    : 0,
                stock: item.stock_quantity,
                packaging: med.packaging,
                prescriptionRequired: med.prescription_required,
                isAvailable: item.is_available,
                
                // Added live combo details inside catalog items so UI can render "Buy 2 Get 1" badge immediately [1]
                comboOffer: activePromo ? {
                    offerId: activePromo._id,
                    campaignDisplayName: activePromo.campaignDisplayName,
                    buyQty: activePromo.buyQty,
                    getFreeQty: activePromo.getFreeQty,
                    images: activePromo.images || []
                } : null
            };
        }));

        res.json({
            success: true,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            data: formattedMedicines.filter(m => m !== null)
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};



module.exports = {
    getMedicineInventory,
    searchMedicinesUser,
    getMedicineFullDetails,
    getSellersForMedicine,
    getPharmacySpecificMedicines
};