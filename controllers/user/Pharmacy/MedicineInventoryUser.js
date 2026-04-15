const MedicineInventory = require('../../../models/MedicineInventory');
const Medicine = require('../../../models/Medicine');

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
const getSellersForMedicine = async (req, res) => {
    try {
        const { medicineId } = req.params;
        
        const sellers = await MedicineInventory.find({ medicineId, is_available: true })
            .populate('pharmacyId', 'name address rating profileImage city location')
            .sort({ vendor_price: 1 });

        res.json({ success: true, data: sellers });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = {
    getMedicineInventory,
    searchMedicinesUser,
    getMedicineFullDetails,
    getSellersForMedicine
};