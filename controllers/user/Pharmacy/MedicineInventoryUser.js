const MedicineInventory = require('../../../models/MedicineInventory');
const Medicine = require('../../../models/Medicine');
const PharmacyComboOffer = require('../../../models/PharmacyComboOffer');

const getMedicineInventory = async (req, res) => {
    try {
        const { medicineId } = req.params;
        
        const masterData = await Medicine.findById(medicineId).lean();
        if (!masterData) return res.status(404).json({ success: false, message: "Medicine not found" });

        const offers = await MedicineInventory.find({ medicineId, is_available: true, stock_quantity: { $gt: 0 } })
            .populate('pharmacyId', 'name address rating location profileImage isHomeDeliveryAvailable is24x7')
            .sort({ vendor_price: 1 })
            .lean();

        // 🚨 OVERWRITE master medicine mrp and discount based on cheapest available store batch [cite: 1.1.2]
        if (offers.length > 0) {
            const bestOffer = offers[0];
            masterData.mrp = (bestOffer.mrp || masterData.mrp).toString();
            masterData.best_price = bestOffer.vendor_price.toString();
            const mrpNum = Number(masterData.mrp || 0);
            if (mrpNum > 0) {
                masterData.discont_percent = `${Math.round(((mrpNum - bestOffer.vendor_price) / mrpNum) * 100)}%`;
            }
        }

        res.json({
            success: true,
            medicine: masterData,
            available_at: offers.map(o => ({
                ...o,
                mrp: o.mrp || Number(masterData.mrp || 0) // Overwrite each offer mrp with its own batch mrp safely [cite: 1.1.2]
            }))
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
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

        // Overwrite static values inside loop with real-time minimum stock prices & batch MRP [cite: 1.1.2]
        const dataWithOffers = await Promise.all(medicines.map(async (med) => {
            const bestOffer = await MedicineInventory.findOne({ medicineId: med._id, is_available: true, stock_quantity: { $gt: 0 } })
                .sort({ vendor_price: 1 }) // sasta vendor pehle [cite: 1.1.2]
                .populate('pharmacyId', 'name rating');
            
            const lowestPrice = bestOffer ? bestOffer.vendor_price : null;
            const batchMrp = bestOffer ? Number(bestOffer.mrp || 0) : Number(med.mrp || 0); // 👈 Fetch batch MRP [cite: 1.1.2]

            // Dynamic fields overwrites [cite: 1.1.2]
            if (lowestPrice !== null) {
                med.mrp = batchMrp.toString(); // Overwrite master MRP with batch MRP [cite: 1.1.2]
                med.best_price = lowestPrice.toString();
                med.discont_percent = `${Math.round(((batchMrp - lowestPrice) / batchMrp) * 100)}%`;
            }

            return {
                ...med,
                best_vendor_price: lowestPrice,
                vendor_id: bestOffer ? bestOffer.pharmacyId._id : null,
                pharmacy_name: bestOffer ? bestOffer.pharmacyId.name : null,
                isAvailable: lowestPrice !== null
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

        const availableInPharmacies = [];
        const pharmacyMap = new Map(); // Track unique pharmacies & consolidate duplicate batches [1]

        for (let item of sellers) {
            if (!item.pharmacyId) continue;

            const pharmacy = item.pharmacyId;
            const pharmacyIdStr = pharmacy._id.toString();

            // If pharmacy is already processed, keep only the cheapest active batch option [cite: 1.1.2]
            if (pharmacyMap.has(pharmacyIdStr)) {
                const existingIndex = pharmacyMap.get(pharmacyIdStr);
                const existingItem = availableInPharmacies[existingIndex];
                
                if (item.vendor_price < existingItem.price) {
                    existingItem.price = item.vendor_price;
                    existingItem.mrp = item.mrp || existingItem.mrp; // Update with cheaper batch MRP
                    existingItem.inventoryId = item._id;
                    existingItem.stock = item.stock_quantity;
                    existingItem.discount = existingItem.mrp > item.vendor_price 
                        ? Math.round(((existingItem.mrp - item.vendor_price) / existingItem.mrp) * 100) 
                        : 0;
                }
            } else {
                pharmacyMap.set(pharmacyIdStr, availableInPharmacies.length);

                const activePromo = await PharmacyComboOffer.findOne({
                    pharmacyId: pharmacy._id,
                    medicineId,
                    isActive: true,
                    startDate: { $lte: today },
                    expiryDate: { $gte: today }
                }).lean();

                availableInPharmacies.push({
                    pharmacyId: pharmacy._id,
                    name: pharmacy.name,
                    image: pharmacy.profileImage,
                    rating: pharmacy.rating,
                    totalReviews: pharmacy.totalReviews,
                    address: `${pharmacy.city}, ${pharmacy.state}`,
                    price: item.vendor_price,
                    mrp: item.mrp || 0, // Dynamic batch-specific MRP [cite: 1.1.2]
                    discount: (item.mrp || 0) > item.vendor_price ? 
                        Math.round((((item.mrp || 0) - item.vendor_price) / (item.mrp || 0)) * 100) : 0,
                    stock: item.stock_quantity,
                    isHomeDelivery: pharmacy.isHomeDeliveryAvailable,
                    isOpen: pharmacy.is24x7 ? "Open 24/7" : "Open Now",
                    inventoryId: item._id,
                    comboOffer: activePromo ? {
                        offerId: activePromo._id,
                        campaignDisplayName: activePromo.campaignDisplayName,
                        buyQty: activePromo.buyQty,
                        getFreeQty: activePromo.getFreeQty,
                        images: activePromo.images || []
                    } : null
                });
            }
        }

        res.json({ 
            success: true, 
            data: availableInPharmacies 
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

        // Fetch active inventory records sorted by earliest expiry date [cite: 1.1.2]
        const inventory = await MedicineInventory.find({ 
            pharmacyId, 
            is_available: true 
        })
        .populate({
            path: 'medicineId',
            select: 'name mrp packaging image_url prescription_required salt'
        })
        .sort({ expiry_date: 1 }) // FEFO sorting dynamically [cite: 1.1.2]
        .skip(skip)
        .limit(limit)
        .lean();

        const formattedMedicines = [];
        const medicineMap = new Map(); // Consolidates multiple batches under a single card to avoid UI clutter [1]

        for (let item of inventory) {
            const med = item.medicineId;
            if (!med) continue;

            const medIdStr = med._id.toString();

            // Keeps only the earliest expiring batch card to avoid UI duplication
            if (medicineMap.has(medIdStr)) {
                continue; 
            }

            medicineMap.set(medIdStr, formattedMedicines.length);

            const activePromo = await PharmacyComboOffer.findOne({
                pharmacyId,
                medicineId: med._id,
                isActive: true,
                startDate: { $lte: today },
                expiryDate: { $gte: today }
            }).lean();

            formattedMedicines.push({
                inventoryId: item._id,
                medicineId: med._id,
                name: med.name,
                salt: med.salt,
                image: med.image_url && med.image_url.length > 0 ? med.image_url[0] : null,
                mrp: item.mrp || Number(med.mrp || 0), // Dynamic batch-specific MRP [cite: 1.1.2]
                vendorPrice: item.vendor_price,
                discountPercentage: (item.mrp || Number(med.mrp || 0)) > item.vendor_price 
                    ? Math.round((((item.mrp || Number(med.mrp || 0)) - item.vendor_price) / (item.mrp || Number(med.mrp || 0))) * 100) 
                    : 0,
                stock: item.stock_quantity,
                packaging: med.packaging,
                prescriptionRequired: med.prescription_required,
                isAvailable: item.is_available,
                comboOffer: activePromo ? {
                    offerId: activePromo._id,
                    campaignDisplayName: activePromo.campaignDisplayName,
                    buyQty: activePromo.buyQty,
                    getFreeQty: activePromo.getFreeQty,
                    images: activePromo.images || []
                } : null
            });
        }

        res.json({
            success: true,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            data: formattedMedicines
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