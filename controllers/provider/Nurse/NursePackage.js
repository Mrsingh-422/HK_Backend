const NursePackage = require('../../../models/NursePackage');
const NurseService = require('../../../models/NurseService');
const MasterConsumable = require('../../../models/MasterConsumable');
const CareService = require('../../../models/CareService'); // For service selection in package creation
const { deleteFile } = require('../../../utils/fileHandler');
const mongoose = require('mongoose');

// @desc    Get Master Care Services for Package Dropdown (With Pagination, Search & Category Filter)
// @route   GET /provider/nurse/package/nurse-services
// @access  Private (Nurse Bureau)
const getAllMasterServicesForSelection = async (req, res) => {
    try {
        const { search, category, page = 1, limit = 20 } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 20);
        const skip = (pageNum - 1) * limitNum;

        let query = {};

        if (category && category !== 'All' && category.trim() !== '') {
            query.category = { $regex: new RegExp("^" + category.trim() + "$", "i") };
        }

        if (search && search.trim() !== '') {
            const cleanSearch = search.trim();
            query.$or = [
                { category: { $regex: cleanSearch, $options: 'i' } },
                { subCategory: { $regex: cleanSearch, $options: 'i' } },
                { servicesOffered: { $regex: cleanSearch, $options: 'i' } }
            ];
        }

        const [totalItems, services] = await Promise.all([
            CareService.countDocuments(query),
            CareService.find(query)
                .sort({ category: 1, subCategory: 1 })
                .skip(skip)
                .limit(limitNum)
                .lean()
        ]);

        const totalPages = Math.ceil(totalItems / limitNum) || 1;

        res.status(200).json({
            success: true,
            count: services.length,
            pagination: {
                totalItems,
                totalPages,
                currentPage: pageNum,
                limit: limitNum,
                hasNextPage: pageNum < totalPages,
                hasPrevPage: pageNum > 1
            },
            data: services
        });
    } catch (error) { 
        console.error("Get All Master Services Selection Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// @desc    Create or Update Nurse Package (With Auto-Sum Price Fallback & Key Compatibility)
// @route   POST /provider/nurse/package/manage OR PUT /provider/nurse/package/manage/:id
// @access  Private (Nurse Bureau)
const managePackage = async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        const nurseId = req.user.id;

        const safeParse = (val) => {
            if (!val) return null;
            if (typeof val === 'object') return val;
            try { return JSON.parse(val); } catch (e) { return null; }
        };

        const safeArrayParse = (val) => {
            if (!val) return [];
            if (Array.isArray(val)) return val;
            try {
                const parsed = JSON.parse(val);
                return Array.isArray(parsed) ? parsed : [parsed];
            } catch (e) {
                return typeof val === 'string' ? val.split(',').map(s => s.trim()) : [];
            }
        };

        const selectedServices = safeArrayParse(data.includedServices);
        const consumablesInput = safeArrayParse(data.consumablesUsed);

        if (!selectedServices || selectedServices.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: "At least one included service is required to build a package." 
            });
        }

        // 1. Fetch Selected CareServices to compute dynamic auto-sum prices if 0 or missing
        const dbServices = await CareService.find({ _id: { $in: selectedServices } }).lean();

        let autoSumOneDay = 0;
        let autoSumMultipleDays = 0;
        let autoSumHourly = 0;

        dbServices.forEach(s => {
            autoSumOneDay += Number(s.oneDayOneTimePrice || 0);
            autoSumMultipleDays += Number(s.forMultipleDaysPrice || s.oneDayOneTimePrice || 0);
            autoSumHourly += Number(s.pricePerHour || 0);
        });

        // 2. Parse Incoming Pricing (Supports both Nested JSON and Flat Form-Data Keys)
        const pricingInput = safeParse(data.pricing) || {};

        // Helper to extract base price from all possible frontend key variants
        const resolveBase = (nestedVal, flatKey1, flatKey2, fallbackAutoSum) => {
            let val = Number(nestedVal ?? data[flatKey1] ?? data[flatKey2] ?? 0);
            if (isNaN(val) || val <= 0) {
                val = fallbackAutoSum; // Fallback to sum of selected services
            }
            return Math.max(0, val);
        };

        // Helper to extract discount percent
        const resolveDiscount = (nestedVal, flatKey1, flatKey2) => {
            const val = Number(nestedVal ?? data[flatKey1] ?? data[flatKey2] ?? 0);
            return isNaN(val) ? 0 : Math.min(100, Math.max(0, val));
        };

        const oneDayBase = resolveBase(pricingInput.oneDay?.base, 'oneDayBase', 'oneDayPrice', autoSumOneDay);
        const oneDayDisc = resolveDiscount(pricingInput.oneDay?.discount, 'oneDayDiscount', 'discountOneDay');

        const multiDayBase = resolveBase(pricingInput.multipleDays?.base, 'multipleDaysBase', 'multiDayPrice', autoSumMultipleDays);
        const multiDayDisc = resolveDiscount(pricingInput.multipleDays?.discount, 'multipleDaysDiscount', 'discountMultipleDays');

        const hourlyBase = resolveBase(pricingInput.hourly?.base, 'hourlyBase', 'hourlyPrice', autoSumHourly);
        const hourlyDisc = resolveDiscount(pricingInput.hourly?.discount, 'hourlyDiscount', 'discountHourly');

        const calcFinal = (base, disc) => Math.max(0, Math.round(base - (base * (disc / 100))));

        const finalPricing = {
            oneDay: { 
                base: oneDayBase, 
                discount: oneDayDisc, 
                final: calcFinal(oneDayBase, oneDayDisc) 
            },
            multipleDays: { 
                base: multiDayBase, 
                discount: multiDayDisc, 
                final: calcFinal(multiDayBase, multiDayDisc) 
            },
            hourly: { 
                base: hourlyBase, 
                discount: hourlyDisc, 
                final: calcFinal(hourlyBase, hourlyDisc) 
            }
        };

        // 3. Process Consumables with calculated final prices
        let processedConsumables = [];
        for (let item of consumablesInput) {
            const targetItemId = item.masterItemId || item.consumableId || item._id;
            if (targetItemId && mongoose.isValidObjectId(targetItemId)) {
                const master = await MasterConsumable.findById(targetItemId);
                if (master) {
                    const discount = Number(item.discountPercentage || 0);
                    processedConsumables.push({
                        masterItemId: master._id,
                        discountPercentage: discount,
                        finalPrice: calcFinal(master.mrp, discount)
                    });
                }
            }
        }

        // 4. Handle Clean Web-Accessible Photo URLs
        let photoUrls = undefined;
        if (req.files && req.files['photos'] && req.files['photos'].length > 0) {
            photoUrls = req.files['photos'].map(f => `/uploads/nurse_packages/${f.filename}`);
        }

        const packageData = {
            nurseId,
            packageName: data.packageName ? String(data.packageName).trim() : "Specialized Care Package",
            description: data.description ? String(data.description).trim() : "Comprehensive nursing care package bundle.",
            includedServices: selectedServices,
            pricing: finalPricing,
            consumablesUsed: processedConsumables,
            prescriptionRequired: data.prescriptionRequired === 'true' || data.prescriptionRequired === true,
            status: 'Approved',
            isActive: data.isActive !== undefined ? (data.isActive === 'true' || data.isActive === true) : true
        };

        if (photoUrls) {
            packageData.photos = photoUrls;
        }

        let result;
        if (id) {
            result = await NursePackage.findOneAndUpdate(
                { _id: id, nurseId }, 
                { $set: packageData }, 
                { new: true }
            ).populate('includedServices', 'category subCategory description')
             .populate('consumablesUsed.masterItemId', 'itemName size mrp unitType');

            if (!result) {
                return res.status(404).json({ success: false, message: "Package not found or unauthorized access." });
            }
        } else {
            if (!packageData.photos) packageData.photos = [];
            result = await NursePackage.create(packageData);
        }

        res.status(id ? 200 : 201).json({ 
            success: true, 
            message: id ? "Nurse package updated successfully!" : "Nurse package created successfully!", 
            data: result 
        });

    } catch (error) { 
        console.error("Manage Package Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// @desc    Get Active Master Consumables List for Package Creation/Edit (With Search & Pagination)
// @route   GET /provider/nurse/package/consumables
// @access  Private (Nurse Bureau)
const getConsumablesForPackage = async (req, res) => {
    try {
        const { search, category, page = 1, limit = 20 } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 20);
        const skip = (pageNum - 1) * limitNum;

        let query = { isActive: true };

        if (category && category !== 'All' && category.trim() !== '') {
            query.category = { $regex: new RegExp("^" + category.trim() + "$", "i") };
        }

        if (search && search.trim() !== '') {
            const cleanSearch = search.trim();
            query.$or = [
                { itemName: { $regex: cleanSearch, $options: 'i' } },
                { size: { $regex: cleanSearch, $options: 'i' } },
                { category: { $regex: cleanSearch, $options: 'i' } }
            ];
        }

        const [totalItems, consumables] = await Promise.all([
            MasterConsumable.countDocuments(query),
            MasterConsumable.find(query)
                .sort({ itemName: 1 })
                .skip(skip)
                .limit(limitNum)
                .lean()
        ]);

        const totalPages = Math.ceil(totalItems / limitNum) || 1;

        res.status(200).json({
            success: true,
            count: consumables.length,
            pagination: {
                totalItems,
                totalPages,
                currentPage: pageNum,
                limit: limitNum,
                hasNextPage: pageNum < totalPages,
                hasPrevPage: pageNum > 1
            },
            data: consumables
        });

    } catch (error) {
        console.error("Get Consumables For Package Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// @desc    Get Nurse Bureau's Own Created Packages (With Pagination & Search)
// @route   GET /provider/nurse/package/my-packages
// @access  Private (Nurse Bureau)
const getMyPackages = async (req, res) => {
    try {
        const nurseId = req.user.id;
        const { search, page = 1, limit = 10 } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, parseInt(limit) || 10);
        const skip = (pageNum - 1) * limitNum;

        let query = { nurseId };

        if (search && search.trim() !== '') {
            query.packageName = { $regex: search.trim(), $options: 'i' };
        }

        const [totalItems, packages] = await Promise.all([
            NursePackage.countDocuments(query),
            NursePackage.find(query)
                .populate('includedServices', 'category subCategory description procedureIncluded servicesOffered')
                .populate('consumablesUsed.masterItemId', 'itemName size mrp unitType')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean()
        ]);

        const totalPages = Math.ceil(totalItems / limitNum) || 1;

        res.status(200).json({ 
            success: true, 
            count: packages.length,
            pagination: {
                totalItems,
                totalPages,
                currentPage: pageNum,
                limit: limitNum,
                hasNextPage: pageNum < totalPages,
                hasPrevPage: pageNum > 1
            },
            data: packages 
        });
    } catch (error) { 
        console.error("Get My Packages Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// @desc    Get Single Package Details by ID for Bureau Editing Screen
// @route   GET /provider/nurse/package/details/:id
// @access  Private (Nurse Bureau)
const getPackageDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const nurseId = req.user.id;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ success: false, message: "Invalid Package ID format." });
        }

        const nursePackage = await NursePackage.findOne({ _id: id, nurseId })
            .populate('includedServices', 'category subCategory description procedureIncluded servicesOffered')
            .populate('consumablesUsed.masterItemId', 'itemName size mrp unitType category')
            .lean();

        if (!nursePackage) {
            return res.status(404).json({ success: false, message: "Package not found or unauthorized access." });
        }

        res.status(200).json({
            success: true,
            data: nursePackage
        });

    } catch (error) {
        console.error("Get Package Details Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Delete Nurse Package by Bureau (Cleans up Disk Photos)
// @route   DELETE /provider/nurse/package/delete/:id
// @access  Private (Nurse Bureau)
const deletePackage = async (req, res) => {
    try {
        const { id } = req.params;
        const nurseId = req.user.id;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ success: false, message: "Invalid Package ID format." });
        }

        const targetPackage = await NursePackage.findOne({ _id: id, nurseId });
        if (!targetPackage) {
            return res.status(404).json({ success: false, message: "Package not found or unauthorized access." });
        }

        // Delete uploaded banner photos from server storage
        if (targetPackage.photos && Array.isArray(targetPackage.photos)) {
            targetPackage.photos.forEach(imgUrl => {
                deleteFile(imgUrl);
            });
        }

        await NursePackage.findByIdAndDelete(id);

        res.status(200).json({
            success: true,
            message: "Nurse package deleted successfully from catalog."
        });

    } catch (error) {
        console.error("Delete Package Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getAllMasterServicesForSelection, managePackage, getConsumablesForPackage, getMyPackages , getPackageDetails, deletePackage};