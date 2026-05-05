const NurseService = require('../../../models/NurseService');
const MasterConsumable = require('../../../models/MasterConsumable');

// 1. ADD OR UPDATE SERVICE (Figma Screen 42 - Triple Pricing & Individual Consumable Discount)
const addOrUpdateService = async (req, res) => {
    try {
        const { id } = req.params;
        const nurseId = req.user.id;

        let { 
            careCategoryId, careSubCategoryId, title, type, description,
            oneDayBase, oneDayDiscount,
            multiDayBase, multiDayDiscount,
            hourlyBase, hourlyDiscount,
            consumablesUsed, 
            procedureIncluded, servicesOffered, prescriptionRequired 
        } = req.body;

        // Helper function for price calculation
        const calcFinal = (base, disc) => {
            const b = Number(base) || 0;
            const d = Number(disc) || 0;
            return Math.round(b - (b * (d / 100)));
        };

        // Pricing Structure for the 3 types
        const pricing = {
            oneDay: {
                basePrice: Number(oneDayBase),
                discountPercentage: Number(oneDayDiscount),
                finalPrice: calcFinal(oneDayBase, oneDayDiscount)
            },
            multipleDays: {
                basePrice: Number(multiDayBase),
                discountPercentage: Number(multiDayDiscount),
                finalPrice: calcFinal(multiDayBase, multiDayDiscount)
            },
            hourly: {
                basePrice: Number(hourlyBase),
                discountPercentage: Number(hourlyDiscount),
                finalPrice: calcFinal(hourlyBase, hourlyDiscount)
            }
        };

        // Consumables Processing (Calculating individual nurse prices from Master MRP)
        let processedConsumables = [];
        if (consumablesUsed) {
            const items = typeof consumablesUsed === 'string' ? JSON.parse(consumablesUsed) : consumablesUsed;
            for (let item of items) {
                const master = await MasterConsumable.findById(item.consumableId);
                if (master) {
                    processedConsumables.push({
                        consumableId: item.consumableId,
                        discountPercentage: Number(item.discountPercentage),
                        nurseFinalPrice: calcFinal(master.mrp, item.discountPercentage)
                    });
                }
            }
        }

        const photos = req.files && req.files['photos'] ? req.files['photos'].map(f => f.path) : undefined;

        const serviceData = {
            nurseId, careCategoryId, careSubCategoryId, title, type,
            description, pricing, procedureIncluded, servicesOffered,
            consumablesUsed: processedConsumables,
            prescriptionRequired: prescriptionRequired === 'true',
            ...(photos && { photos })
        };

        let service;
        if (id) {
            service = await NurseService.findOneAndUpdate({ _id: id, nurseId }, serviceData, { new: true });
        } else {
            service = await NurseService.create(serviceData);
        }

        res.status(201).json({ success: true, message: "Service Saved Successfully", data: service });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. GET MY SERVICES (Figma Screen 37: My Services with Tabs)
const getMyServices = async (req, res) => {
    try {
        const { status } = req.query; // Approved, Pending, Rejected
        const query = { nurseId: req.user.id };
        if (status) query.status = status;

        const services = await NurseService.find(query)
            .populate('consumablesUsed.consumableId') // Correct population
            .populate('careSubCategoryId')
            .sort({ createdAt: -1 });

        res.json({ success: true, data: services });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. DELETE SERVICE (Figma Screen 40/41)
const deleteService = async (req, res) => {
    try {
        const deleted = await NurseService.findOneAndDelete({ _id: req.params.id, nurseId: req.user.id });
        if (!deleted) return res.status(404).json({ message: "Service not found" });
        res.json({ success: true, message: "Service removed" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { addOrUpdateService, getMyServices, deleteService };