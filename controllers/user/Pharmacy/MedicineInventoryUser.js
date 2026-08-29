// controllers/user/Pharmacy/MedicineInventoryUser.js
const MedicineInventory = require('../../../models/MedicineInventory');
const Medicine = require('../../../models/Medicine');
const PharmacyComboOffer = require('../../../models/PharmacyComboOffer');
const mongoose = require('mongoose');

// 🔒 Anti-Crash Regex Sanitizer
const escapeRegex = (string) => {
    return string.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
};

// 1. GET MEDICINE INVENTORY OFFERS
const getMedicineInventory = async (req, res) => {
    try {
        const { medicineId } = req.params;
        
        const masterData = await Medicine.findById(medicineId).lean();
        if (!masterData) return res.status(404).json({ success: false, message: "Medicine not found" });

        const offers = await MedicineInventory.find({ medicineId, is_available: true, stock_quantity: { $gt: 0 } })
            .populate('pharmacyId', 'name address rating location profileImage isHomeDeliveryAvailable is24x7')
            .sort({ vendor_price: 1 })
            .lean();

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
                mrp: o.mrp || Number(masterData.mrp || 0)
            }))
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. SEARCH MEDICINES (Anti-Crash Regex Added)
const searchMedicinesUser = async (req, res) => {
    try {
        const { query, category, page = 1 } = req.body;
        const limit = 20;
        const skip = (page - 1) * limit;

        let filter = {};
        if (query && query.trim().length > 0) {
            const safeRegex = new RegExp(escapeRegex(query.trim()), 'i');
            filter.$or = [
                { name: safeRegex },
                { salt_composition: safeRegex }
            ];
        }
        if (category && category !== 'All') filter.bread_crumb = new RegExp(`^${category}`, 'i');

        const medicines = await Medicine.find(filter).skip(skip).limit(limit).lean();

        const dataWithOffers = await Promise.all(medicines.map(async (med) => {
            const bestOffer = await MedicineInventory.findOne({ medicineId: med._id, is_available: true, stock_quantity: { $gt: 0 } })
                .sort({ vendor_price: 1 })
                .populate('pharmacyId', 'name rating');
            
            const lowestPrice = bestOffer ? bestOffer.vendor_price : null;
            const batchMrp = bestOffer ? Number(bestOffer.mrp || 0) : Number(med.mrp || 0);

            if (lowestPrice !== null) {
                med.mrp = batchMrp.toString();
                med.best_price = lowestPrice.toString();
                if (batchMrp > 0) {
                    med.discont_percent = `${Math.round(((batchMrp - lowestPrice) / batchMrp) * 100)}%`;
                }
            }

            return {
                ...med,
                best_vendor_price: lowestPrice,
                vendor_id: bestOffer ? bestOffer.pharmacyId?._id : null,
                pharmacy_name: bestOffer ? bestOffer.pharmacyId?.name : null,
                isAvailable: lowestPrice !== null
            };
        }));

        res.json({ success: true, data: dataWithOffers });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 3. MEDICINE FULL DETAILS (Dynamic Alternate Brands Synced)
const getMedicineFullDetails = async (req, res) => {
    try {
        const medicineId = req.params.id || req.params.medicineId;
        const medicine = await Medicine.findById(medicineId).lean();
        if (!medicine) return res.status(404).json({ success: false, message: "Medicine not found" });

        // Dynamic Alternate Brands Lookup
        if (medicine.salt_composition) {
            const similarMeds = await Medicine.find({
                salt_composition: medicine.salt_composition,
                _id: { $ne: medicine._id }
            }).select('name manufacturers mrp best_price discont_percent').limit(6).lean();

            if (similarMeds.length > 0) {
                const formattedAlts = similarMeds.map(med => {
                    const price = med.best_price || med.mrp || "0";
                    const discount = med.discont_percent && med.discont_percent !== "0%" 
                        ? `save ${med.discont_percent}` 
                        : "same price";
                    return `${med.name} :: ${med.manufacturers || 'N/A'} :: ${price}/Tablet :: ${discount}`;
                }).join(' | ');

                medicine.alternate_brand = formattedAlts;
            }
        }

        // Fetch cheapest active store batch
        const bestOffer = await MedicineInventory.findOne({ medicineId: medicine._id, is_available: true, stock_quantity: { $gt: 0 } })
            .sort({ vendor_price: 1 })
            .lean();

        const lowestPrice = bestOffer ? bestOffer.vendor_price : null;
        const batchMrp = bestOffer ? Number(bestOffer.mrp || 0) : Number(medicine.mrp || 0);

        if (lowestPrice !== null) {
            medicine.mrp = batchMrp.toString();
            medicine.best_price = lowestPrice.toString();
            if (batchMrp > 0) {
                medicine.discont_percent = `${Math.round(((batchMrp - lowestPrice) / batchMrp) * 100)}%`;
            }
            
            // 🚨 1. PDP RETURN & REPLACEMENT BADGE ON CHEAPEST BATCH (Crash-Proof Default)
            medicine.isReturnAllowed = Boolean(bestOffer.isReturnAllowed);
            medicine.isReplacementAllowed = Boolean(bestOffer.isReplacementAllowed);
            medicine.returnPolicyText = medicine.isReturnAllowed 
                ? "3 Days Return/Replacement Available" 
                : "Non-Returnable Product";
        } else {
            // 🚨 2. SAFE FALLBACK FOR UNSTOCKED/OLD DATA (Prevents Crashing)
            medicine.isReturnAllowed = false;
            medicine.isReplacementAllowed = false;
            medicine.returnPolicyText = "Non-Returnable Product";
        }

        const substitutes = await Medicine.find({ 
            salt_composition: medicine.salt_composition, 
            _id: { $ne: medicine._id } 
        }).limit(3).lean();

        const frequentlyBought = await Medicine.find({ 
            bread_crumb: medicine.bread_crumb, 
            _id: { $ne: medicine._id } 
        }).limit(4).lean();

        res.json({
            success: true,
            data: {
                details: medicine, 
                frequentlyBought,
                substitutes,
                isAvailable: lowestPrice !== null
            }
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 4. GET SELLERS FOR MEDICINE
const getSellersForMedicine = async (req, res) => {
    try {
        const { medicineId } = req.params;
        const today = new Date();
        
        const sellers = await MedicineInventory.find({ medicineId, is_available: true, stock_quantity: { $gt: 0 } })
            .populate('pharmacyId', 'name address rating profileImage city location isHomeDeliveryAvailable is24x7')
            .sort({ vendor_price: 1 })
            .lean();

        const availableInPharmacies = [];
        const pharmacyMap = new Map();

        for (let item of sellers) {
            if (!item.pharmacyId) continue;

            const pharmacy = item.pharmacyId;
            const pharmacyIdStr = pharmacy._id.toString();

            if (pharmacyMap.has(pharmacyIdStr)) {
                const existingIndex = pharmacyMap.get(pharmacyIdStr);
                const existingItem = availableInPharmacies[existingIndex];
                
                if (item.vendor_price < existingItem.price) {
                    existingItem.price = item.vendor_price;
                    existingItem.mrp = item.mrp || existingItem.mrp;
                    existingItem.inventoryId = item._id;
                    existingItem.stock = item.stock_quantity;
                    existingItem.discount = existingItem.mrp > item.vendor_price 
                        ? Math.round(((existingItem.mrp - item.vendor_price) / existingItem.mrp) * 100) 
                        : 0;
                    existingItem.isReturnAllowed = item.isReturnAllowed === true;
                    existingItem.isReplacementAllowed = item.isReplacementAllowed === true;
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
                    mrp: item.mrp || 0,
                    discount: (item.mrp || 0) > item.vendor_price ? 
                        Math.round((((item.mrp || 0) - item.vendor_price) / (item.mrp || 0)) * 100) : 0,
                    stock: item.stock_quantity,
                    isHomeDelivery: pharmacy.isHomeDeliveryAvailable,
                    isOpen: pharmacy.is24x7 ? "Open 24/7" : "Open Now",
                    inventoryId: item._id,
                    
                    // 🚨 Return Flags per Seller Option
                    isReturnAllowed: item.isReturnAllowed === true,
                    isReplacementAllowed: item.isReplacementAllowed === true,

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

// 5. GET PHARMACY SPECIFIC MEDICINES (Salt bug fixed)
const getPharmacySpecificMedicines = async (req, res) => {
    try {
        const { pharmacyId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = 20; 
        const skip = (page - 1) * limit;
        const today = new Date();

        const total = await MedicineInventory.countDocuments({ 
            pharmacyId, 
            is_available: true,
            stock_quantity: { $gt: 0 }
        });

        const inventory = await MedicineInventory.find({ 
            pharmacyId, 
            is_available: true,
            stock_quantity: { $gt: 0 }
        })
        .populate({
            path: 'medicineId',
            select: 'name mrp packaging image_url prescription_required salt_composition'
        })
        .sort({ expiry_date: 1 })
        .skip(skip)
        .limit(limit)
        .lean();

        const formattedMedicines = [];
        const medicineMap = new Map();

        for (let item of inventory) {
            const med = item.medicineId;
            if (!med) continue;

            const medIdStr = med._id.toString();
            if (medicineMap.has(medIdStr)) continue; 

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
                salt: med.salt_composition || "N/A",
                image: med.image_url && med.image_url.length > 0 ? med.image_url[0] : null,
                mrp: item.mrp || Number(med.mrp || 0),
                vendorPrice: item.vendor_price,
                discountPercentage: (item.mrp || Number(med.mrp || 0)) > item.vendor_price 
                    ? Math.round((((item.mrp || Number(med.mrp || 0)) - item.vendor_price) / (item.mrp || Number(med.mrp || 0))) * 100) 
                    : 0,
                stock: item.stock_quantity,
                packaging: med.packaging,
                prescriptionRequired: med.prescription_required,
                isAvailable: item.is_available,
                
                // 🚨 FIXED: Return & Replace permissions returned to user store browse card
                isReturnAllowed: item.isReturnAllowed === true,
                isReplacementAllowed: item.isReplacementAllowed === true,

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