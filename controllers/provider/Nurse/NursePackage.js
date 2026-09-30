const NursePackage = require('../../../models/NursePackage');
const NurseService = require('../../../models/NurseService');
const MasterConsumable = require('../../../models/MasterConsumable');
const CareService = require('../../../models/CareService'); // For service selection in package creation

// GET ALL MASTER SERVICES FOR PACKAGE DROPDOWN
// Endpoint: GET /provider/nurse/package/nurse-services
const getAllMasterServicesForSelection = async (req, res) => {
    try {
        const services = await CareService.find({}).sort({ category: 1 }).lean();
        res.json({ success: true, count: services.length, data: services });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// CREATE / UPDATE NURSE PACKAGE (With Clean URLs & Photo Preservation)
// Endpoint: POST /provider/nurse/package/manage OR PUT /provider/nurse/package/manage/:id
const managePackage = async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        const nurseId = req.user.id;

        const safeParse = (val) => {
            if (!val) return [];
            return typeof val === 'string' ? JSON.parse(val) : val;
        };

        const pricingInput = data.pricing ? safeParse(data.pricing) : null;
        const consumablesInput = safeParse(data.consumablesUsed);
        const selectedServices = safeParse(data.includedServices);

        if (!pricingInput || !selectedServices || selectedServices.length === 0) {
            return res.status(400).json({ success: false, message: "Pricing and at least one included service are required." });
        }

        const calculate = (base, disc) => Math.round(Number(base) - (Number(base) * (Number(disc) / 100)));

        const pricing = {
            oneDay: { 
                base: Number(pricingInput.oneDay?.base || 0), 
                discount: Number(pricingInput.oneDay?.discount || 0), 
                final: calculate(pricingInput.oneDay?.base, pricingInput.oneDay?.discount) 
            },
            multipleDays: { 
                base: Number(pricingInput.multipleDays?.base || 0), 
                discount: Number(pricingInput.multipleDays?.discount || 0), 
                final: calculate(pricingInput.multipleDays?.base, pricingInput.multipleDays?.discount) 
            },
            hourly: { 
                base: Number(pricingInput.hourly?.base || 0), 
                discount: Number(pricingInput.hourly?.discount || 0), 
                final: calculate(pricingInput.hourly?.base, pricingInput.hourly?.discount) 
            }
        };

        let processedConsumables = [];
        for (let item of consumablesInput) {
            const targetItemId = item.masterItemId || item.consumableId;
            const master = await MasterConsumable.findById(targetItemId);
            if (master) {
                const discount = Number(item.discountPercentage || 0);
                processedConsumables.push({
                    masterItemId: master._id,
                    discountPercentage: discount,
                    finalPrice: calculate(master.mrp, discount)
                });
            }
        }

        // 🚨 CLEAN URL FORMAT FOR PACKAGE BANNER PHOTOS
        let photoUrls = undefined;
        if (req.files && req.files['photos'] && req.files['photos'].length > 0) {
            photoUrls = req.files['photos'].map(f => `/uploads/nurse_packages/${f.filename}`);
        }

        const packageData = {
            nurseId,
            packageName: data.packageName ? String(data.packageName).trim() : "Specialized Care Package",
            description: data.description || "Package bundle of comprehensive nursing services",
            includedServices: selectedServices,
            pricing,
            consumablesUsed: processedConsumables,
            prescriptionRequired: data.prescriptionRequired === 'true' || data.prescriptionRequired === true,
            status: 'Approved'
        };

        // Only overwrite photos if new ones are uploaded
        if (photoUrls) {
            packageData.photos = photoUrls;
        }

        let result;
        if (id) {
            result = await NursePackage.findOneAndUpdate(
                { _id: id, nurseId }, 
                { $set: packageData }, 
                { new: true }
            );
            if (!result) return res.status(404).json({ success: false, message: "Package not found or unauthorized." });
        } else {
            if (!packageData.photos) packageData.photos = [];
            result = await NursePackage.create(packageData);
        }

        res.status(201).json({ 
            success: true, 
            message: "Nurse package listed successfully!", 
            data: result 
        });
    } catch (error) { 
        console.error("Manage Package Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};



// GET MY PACKAGES LIST
// Endpoint: GET /provider/nurse/package/my-packages
const getMyPackages = async (req, res) => {
    try {
        const packages = await NursePackage.find({ nurseId: req.user.id })
            .populate('includedServices', 'category subCategory description procedureIncluded servicesOffered')
            .populate('consumablesUsed.masterItemId', 'itemName size mrp unitType')
            .sort({ createdAt: -1 });
            
        res.json({ success: true, count: packages.length, data: packages });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};


module.exports = { getAllMasterServicesForSelection, managePackage, getMyPackages };