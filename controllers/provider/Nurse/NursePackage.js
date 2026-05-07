const NursePackage = require('../../../models/NursePackage');
const NurseService = require('../../../models/NurseService');
const MasterConsumable = require('../../../models/MasterConsumable');
const CareService = require('../../../models/CareService'); // For service selection in package creation

// 1. GET ALL MY SERVICES FOR PACKAGE SELECTION
// Nurse bureau jab package banayega, toh ye API use karega list dikhane ke liye
const getAllMasterServicesForSelection = async (req, res) => {
    try {
        // Chunki CareService template hai, hum saari services fetch karenge
        // Taaki nurse bureau inme se pick karke package bana sake
        const services = await CareService.find({}).sort({ category: 1 });
        res.json({ success: true, data: services });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 2. CREATE/UPDATE PACKAGE
const managePackage = async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;

        // Helper to safely parse JSON
        const safeParse = (val) => {
            if (!val) return [];
            return typeof val === 'string' ? JSON.parse(val) : val;
        };

        const pricingInput = data.pricing ? safeParse(data.pricing) : null;
        const consumablesInput = safeParse(data.consumablesUsed);
        const selectedServices = safeParse(data.includedServices);

        if (!pricingInput || !selectedServices.length) {
            return res.status(400).json({ success: false, message: "Pricing and Services are required" });
        }

        const calculate = (base, disc) => Math.round(Number(base) - (Number(base) * (Number(disc) / 100)));

        const pricing = {
            oneDay: { 
                base: Number(pricingInput.oneDay.base), 
                discount: Number(pricingInput.oneDay.discount), 
                final: calculate(pricingInput.oneDay.base, pricingInput.oneDay.discount) 
            },
            multipleDays: { 
                base: Number(pricingInput.multipleDays.base), 
                discount: Number(pricingInput.multipleDays.discount), 
                final: calculate(pricingInput.multipleDays.base, pricingInput.multipleDays.discount) 
            },
            hourly: { 
                base: Number(pricingInput.hourly.base), 
                discount: Number(pricingInput.hourly.discount), 
                final: calculate(pricingInput.hourly.base, pricingInput.hourly.discount) 
            }
        };

        let processedConsumables = [];
        for (let item of consumablesInput) {
            const master = await MasterConsumable.findById(item.masterItemId);
            if (master) {
                processedConsumables.push({
                    masterItemId: item.masterItemId,
                    discountPercentage: Number(item.discountPercentage),
                    finalPrice: calculate(master.mrp, item.discountPercentage)
                });
            }
        }

        const packageData = {
            nurseId: req.user.id,
            packageName: data.packageName,
            description: data.description || "Package bundle of nursing services", // Fallback description
            includedServices: selectedServices,
            pricing: pricing,
            consumablesUsed: processedConsumables,
            prescriptionRequired: data.prescriptionRequired === 'true',
            status: 'Approved',
            photos: req.files && req.files['photos'] ? req.files['photos'].map(f => f.path) : []
        };

        let result;
        if (id) {
            result = await NursePackage.findOneAndUpdate({ _id: id, nurseId: req.user.id }, packageData, { new: true });
        } else {
            result = await NursePackage.create(packageData);
        }

        res.status(201).json({ success: true, message: "Package listed successfully!", data: result });
    } catch (error) { 
        console.error("Package Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};


// 3. GET LIST OF MY PACKAGES
const getMyPackages = async (req, res) => {
    try {
        const packages = await NursePackage.find({ nurseId: req.user.id })
            .populate('includedServices', 'title pricing')
            .populate('consumablesUsed.masterItemId')
            .sort({ createdAt: -1 });
        res.json({ success: true, data: packages });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { getAllMasterServicesForSelection, managePackage, getMyPackages };