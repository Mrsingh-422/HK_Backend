const NurseService = require('../../../models/NurseService');
const MasterConsumable = require('../../../models/MasterConsumable');

// 1. ADD OR UPDATE NURSE SERVICE (Fixed Pricing Schema Keys & Photo URLs)
// Endpoint: POST /provider/nurse/service/manage OR PUT /provider/nurse/service/manage/:id
const addOrUpdateService = async (req, res) => {
    try {
        const { id } = req.params;
        const nurseId = req.user.id;

        let { 
            careCategoryId, careSubCategoryId, title, type, description,
            oneDayBase, oneDayDiscount,
            multiDayBase, multiDayDiscount,
            hourlyBase, hourlyDiscount,
            pricing: pricingJson,
            consumablesUsed, 
            procedureIncluded, servicesOffered, prescriptionRequired 
        } = req.body;

        const calcFinal = (base, disc) => {
            const b = Number(base) || 0;
            const d = Number(disc) || 0;
            return Math.round(b - (b * (d / 100)));
        };

        // 🚨 SCHEMA ALIGNMENT FIX: Keys must strictly be 'base', 'discount', 'final'
        let pricing = {};
        if (pricingJson) {
            const parsedPricing = typeof pricingJson === 'string' ? JSON.parse(pricingJson) : pricingJson;
            pricing = {
                oneDay: {
                    base: Number(parsedPricing.oneDay?.base || 0),
                    discount: Number(parsedPricing.oneDay?.discount || 0),
                    final: calcFinal(parsedPricing.oneDay?.base, parsedPricing.oneDay?.discount)
                },
                multipleDays: {
                    base: Number(parsedPricing.multipleDays?.base || 0),
                    discount: Number(parsedPricing.multipleDays?.discount || 0),
                    final: calcFinal(parsedPricing.multipleDays?.base, parsedPricing.multipleDays?.discount)
                },
                hourly: {
                    base: Number(parsedPricing.hourly?.base || 0),
                    discount: Number(parsedPricing.hourly?.discount || 0),
                    final: calcFinal(parsedPricing.hourly?.base, parsedPricing.hourly?.discount)
                }
            };
        } else {
            pricing = {
                oneDay: {
                    base: Number(oneDayBase || 0),
                    discount: Number(oneDayDiscount || 0),
                    final: calcFinal(oneDayBase, oneDayDiscount)
                },
                multipleDays: {
                    base: Number(multiDayBase || 0),
                    discount: Number(multiDayDiscount || 0),
                    final: calcFinal(multiDayBase, multiDayDiscount)
                },
                hourly: {
                    base: Number(hourlyBase || 0),
                    discount: Number(hourlyDiscount || 0),
                    final: calcFinal(hourlyBase, hourlyDiscount)
                }
            };
        }

        // Process Consumables with final price calculation
        let processedConsumables = [];
        if (consumablesUsed) {
            const items = typeof consumablesUsed === 'string' ? JSON.parse(consumablesUsed) : consumablesUsed;
            for (let item of items) {
                const targetItemId = item.masterItemId || item.consumableId;
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

        // 🚨 CLEAN WEB URL PATHS FOR PHOTOS
        let photoUrls = undefined;
        if (req.files && req.files['photos'] && req.files['photos'].length > 0) {
            photoUrls = req.files['photos'].map(f => `/uploads/nurse_services/${f.filename}`);
        }

        const serviceData = {
            nurseId, 
            careCategoryId, 
            careSubCategoryId, 
            title: title ? String(title).trim() : "Nursing Care Service", 
            type: type || 'Daily Care',
            description: description || "", 
            pricing, 
            procedureIncluded: procedureIncluded || "", 
            servicesOffered: servicesOffered || "NURSING CARE",
            consumablesUsed: processedConsumables,
            prescriptionRequired: prescriptionRequired === 'true' || prescriptionRequired === true,
            status: 'Approved' // Pre-approved for active bureau
        };

        if (photoUrls) {
            serviceData.photos = photoUrls;
        }

        let service;
        if (id) {
            service = await NurseService.findOneAndUpdate(
                { _id: id, nurseId }, 
                { $set: serviceData }, 
                { new: true }
            );
            if (!service) return res.status(404).json({ success: false, message: "Service not found or unauthorized." });
        } else {
            service = await NurseService.create(serviceData);
        }

        res.status(201).json({ 
            success: true, 
            message: "Nurse Service saved successfully with synchronized pricing!", 
            data: service 
        });
    } catch (error) { 
        console.error("Save Nurse Service Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. GET MY SERVICES (With Populated Consumables & Categories)
// Endpoint: GET /provider/nurse/service/list
const getMyServices = async (req, res) => {
    try {
        const { status } = req.query; // Approved, Pending, Rejected
        const query = { nurseId: req.user.id };
        if (status) query.status = status;

        const services = await NurseService.find(query)
            .populate('consumablesUsed.masterItemId', 'itemName size mrp unitType')
            .populate('careSubCategoryId', 'category subCategory description')
            .sort({ createdAt: -1 });

        res.json({ success: true, count: services.length, data: services });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 3. DELETE NURSE SERVICE
// Endpoint: DELETE /provider/nurse/service/delete/:id
const deleteService = async (req, res) => {
    try {
        const deleted = await NurseService.findOneAndDelete({ _id: req.params.id, nurseId: req.user.id });
        if (!deleted) return res.status(404).json({ success: false, message: "Service not found or unauthorized." });
        res.json({ success: true, message: "Service removed successfully." });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};


module.exports = { addOrUpdateService, getMyServices, deleteService };