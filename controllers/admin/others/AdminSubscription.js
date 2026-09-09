const SubscriptionCategory = require('../../../models/SubscriptionCategory');
const SubscriptionDisease = require('../../../models/SubscriptionDisease');
const SubscriptionPlan = require('../../../models/SubscriptionPlan');
const UserSubscription = require('../../../models/UserSubscription');
const User = require('../../../models/User');

// =========================================================================
// 📂 1. CATEGORY MANAGEMENT
// =========================================================================

const createCategory = async (req, res) => {
    try {
        const { name, description, iconImage, isDiseaseSpecific, displayOrder } = req.body;

        if (!name || name.trim() === "") {
            return res.status(400).json({ success: false, message: "Category name is required." });
        }

        const existing = await SubscriptionCategory.findOne({ name: name.trim() });
        if (existing) {
            return res.status(400).json({ success: false, message: "Category with this name already exists." });
        }

        const category = await SubscriptionCategory.create({
            name: name.trim(),
            description: description || "",
            iconImage: iconImage || null,
            isDiseaseSpecific: isDiseaseSpecific === 'true' || isDiseaseSpecific === true,
            displayOrder: Number(displayOrder) || 0
        });

        res.status(201).json({ success: true, message: "Category created.", data: category });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getCategories = async (req, res) => {
    try {
        const { search, isActive } = req.query;
        const query = {};

        if (isActive !== undefined && isActive !== 'All') {
            query.isActive = (isActive === 'true' || isActive === true);
        }
        if (search && search.trim() !== '') {
            query.name = { $regex: search.trim(), $options: 'i' };
        }

        const categories = await SubscriptionCategory.find(query).sort({ displayOrder: 1, createdAt: -1 }).lean();

        const data = await Promise.all(categories.map(async (cat) => {
            const totalDiseases = await SubscriptionDisease.countDocuments({ categoryId: cat._id });
            const totalPlans = await SubscriptionPlan.countDocuments({ categoryId: cat._id });
            return {
                ...cat,
                totalDiseases,
                totalPlans
            };
        }));

        res.status(200).json({ success: true, count: data.length, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, iconImage, isDiseaseSpecific, displayOrder, isActive } = req.body;

        const updateData = {};
        if (name) {
            updateData.name = name.trim();
            updateData.slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
        }
        if (description !== undefined) updateData.description = description;
        if (iconImage !== undefined) updateData.iconImage = iconImage;
        if (isDiseaseSpecific !== undefined) updateData.isDiseaseSpecific = isDiseaseSpecific;
        if (displayOrder !== undefined) updateData.displayOrder = Number(displayOrder);
        if (isActive !== undefined) updateData.isActive = isActive;

        const updated = await SubscriptionCategory.findByIdAndUpdate(id, { $set: updateData }, { new: true });
        if (!updated) return res.status(404).json({ success: false, message: "Category not found." });

        res.status(200).json({ success: true, message: "Category updated.", data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteCategory = async (req, res) => {
    try {
        const { id } = req.params;

        const planCount = await SubscriptionPlan.countDocuments({ categoryId: id });
        if (planCount > 0) {
            return res.status(400).json({ 
                success: false, 
                message: `Cannot delete category. ${planCount} plan(s) are currently linked to it.` 
            });
        }

        await SubscriptionDisease.deleteMany({ categoryId: id });
        await SubscriptionCategory.findByIdAndDelete(id);

        res.status(200).json({ success: true, message: "Category deleted successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 🩺 2. DISEASE MANAGEMENT
// =========================================================================

const createDisease = async (req, res) => {
    try {
        const { categoryId, name, description, iconImage } = req.body;

        if (!categoryId || !name) {
            return res.status(400).json({ success: false, message: "categoryId and disease name are required." });
        }

        const category = await SubscriptionCategory.findById(categoryId);
        if (!category) return res.status(404).json({ success: false, message: "Parent category not found." });

        const existing = await SubscriptionDisease.findOne({ categoryId, name: name.trim() });
        if (existing) {
            return res.status(400).json({ success: false, message: "Disease already exists under this category." });
        }

        const disease = await SubscriptionDisease.create({
            categoryId,
            name: name.trim(),
            description: description || "",
            iconImage: iconImage || null
        });

        res.status(201).json({ success: true, message: "Disease added successfully.", data: disease });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getDiseases = async (req, res) => {
    try {
        const { categoryId, search, isActive } = req.query;
        const query = {};

        if (categoryId) query.categoryId = categoryId;
        if (isActive !== undefined && isActive !== 'All') {
            query.isActive = (isActive === 'true' || isActive === true);
        }
        if (search && search.trim() !== '') {
            query.name = { $regex: search.trim(), $options: 'i' };
        }

        const diseases = await SubscriptionDisease.find(query)
            .populate('categoryId', 'name slug isDiseaseSpecific')
            .sort({ createdAt: -1 })
            .lean();

        res.status(200).json({ success: true, count: diseases.length, data: diseases });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateDisease = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, iconImage, categoryId, isActive } = req.body;

        const updateData = {};
        if (name) {
            updateData.name = name.trim();
            updateData.slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
        }
        if (description !== undefined) updateData.description = description;
        if (iconImage !== undefined) updateData.iconImage = iconImage;
        if (categoryId) updateData.categoryId = categoryId;
        if (isActive !== undefined) updateData.isActive = isActive;

        const updated = await SubscriptionDisease.findByIdAndUpdate(id, { $set: updateData }, { new: true });
        if (!updated) return res.status(404).json({ success: false, message: "Disease not found." });

        res.status(200).json({ success: true, message: "Disease updated.", data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteDisease = async (req, res) => {
    try {
        const { id } = req.params;

        const planCount = await SubscriptionPlan.countDocuments({ diseaseIds: id });
        if (planCount > 0) {
            return res.status(400).json({ 
                success: false, 
                message: `Cannot delete disease. ${planCount} plan(s) are currently linked to it.` 
            });
        }

        await SubscriptionDisease.findByIdAndDelete(id);
        res.status(200).json({ success: true, message: "Disease deleted successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 📦 3. PLAN MANAGEMENT (With Multi-Disease & COD Always Open Guarantee)
// =========================================================================

const createSubscriptionPlanByAdmin = async (req, res) => {
    try {
        const { 
            categoryId, 
            diseaseIds, // 👈 Array of disease IDs or single ID
            name, 
            validityInDays, 
            price, 
            description, 
            features, 
            benefits, 
            termsAndConditions 
        } = req.body;

        if (!categoryId || !name || !validityInDays || price === undefined) {
            return res.status(400).json({ 
                success: false, 
                message: "categoryId, name, validityInDays, and price are required." 
            });
        }

        const category = await SubscriptionCategory.findById(categoryId);
        if (!category) {
            return res.status(404).json({ success: false, message: "Selected category not found." });
        }

        // Format disease IDs array
        let parsedDiseaseIds = [];
        if (diseaseIds) {
            parsedDiseaseIds = Array.isArray(diseaseIds) ? diseaseIds : [diseaseIds];
        }

        if (category.isDiseaseSpecific && parsedDiseaseIds.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: `Category '${category.name}' requires selecting at least 1 Disease / Condition.` 
            });
        }

        // Auto-include COD guarantee in features list if not already there
        let planFeatures = Array.isArray(features) ? features : (features ? features.split(',').map(f => f.trim()) : []);
        const codFeatureText = "Unlimited Cash on Delivery (COD) Access on All Bookings";
        if (!planFeatures.includes(codFeatureText)) {
            planFeatures.unshift(codFeatureText);
        }

        const newPlan = await SubscriptionPlan.create({
            categoryId,
            diseaseIds: category.isDiseaseSpecific ? parsedDiseaseIds : [],
            name: name.trim(),
            validityInDays: Number(validityInDays),
            price: Number(price),
            description: description || "",
            termsAndConditions: termsAndConditions || "",
            features: planFeatures,
            benefits: {
                unlimitedCodAccess: true, // 👈 Always guaranteed
                freeDoctorAppointmentsCount: Number(benefits?.freeDoctorAppointmentsCount || 0),
                freeNurseVisitsCount: Number(benefits?.freeNurseVisitsCount || 0),
                freeLabDeliveriesCount: Number(benefits?.freeLabDeliveriesCount || 0),
                freeNurseDeliveriesCount: Number(benefits?.freeNurseDeliveriesCount || 0),
                freePharmacyDeliveriesCount: Number(benefits?.freePharmacyDeliveriesCount || 0),
                freeAmbulanceTripsCount: Number(benefits?.freeAmbulanceTripsCount || 0)
            }
        });

        const populated = await SubscriptionPlan.findById(newPlan._id)
            .populate('categoryId', 'name slug isDiseaseSpecific')
            .populate('diseaseIds', 'name slug');

        res.status(201).json({ success: true, message: "Subscription plan created successfully.", data: populated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getAllSubscriptionPlansByAdmin = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = "", categoryId, diseaseId, isActive } = req.query;
        const query = {};

        if (categoryId && categoryId !== 'All') query.categoryId = categoryId;
        if (diseaseId && diseaseId !== 'All') query.diseaseIds = diseaseId;
        if (isActive !== undefined && isActive !== 'All') {
            query.isActive = (isActive === 'true' || isActive === true);
        }
        if (search.trim() !== "") {
            query.name = { $regex: search.trim(), $options: 'i' };
        }

        const skip = (Number(page) - 1) * Number(limit);

        const [plans, total] = await Promise.all([
            SubscriptionPlan.find(query)
                .populate('categoryId', 'name slug isDiseaseSpecific')
                .populate('diseaseIds', 'name slug')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit))
                .lean(),
            SubscriptionPlan.countDocuments(query)
        ]);

        const plansWithStats = await Promise.all(plans.map(async (plan) => {
            const activeSubscribers = await UserSubscription.countDocuments({
                planId: plan._id,
                status: 'Active'
            });
            return {
                ...plan,
                activeSubscribersCount: activeSubscribers
            };
        }));

        res.status(200).json({
            success: true,
            totalRecords: total,
            totalPages: Math.ceil(total / Number(limit)),
            currentPage: Number(page),
            count: plansWithStats.length,
            data: plansWithStats
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getSubscriptionPlanByIdByAdmin = async (req, res) => {
    try {
        const { id } = req.params;

        const plan = await SubscriptionPlan.findById(id)
            .populate('categoryId', 'name slug isDiseaseSpecific')
            .populate('diseaseIds', 'name slug');

        if (!plan) return res.status(404).json({ success: false, message: "Subscription plan not found." });

        const activeSubscribers = await UserSubscription.countDocuments({ planId: plan._id, status: 'Active' });

        res.status(200).json({
            success: true,
            data: {
                ...plan._doc,
                activeSubscribersCount: activeSubscribers
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateSubscriptionPlanByAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            categoryId, diseaseIds, name, validityInDays, price, 
            description, features, benefits, isActive, termsAndConditions 
        } = req.body;

        const updateData = {};
        if (categoryId) updateData.categoryId = categoryId;
        if (diseaseIds !== undefined) {
            updateData.diseaseIds = Array.isArray(diseaseIds) ? diseaseIds : (diseaseIds ? [diseaseIds] : []);
        }
        if (name) updateData.name = name.trim();
        if (validityInDays !== undefined) updateData.validityInDays = Number(validityInDays);
        if (price !== undefined) updateData.price = Number(price);
        if (description !== undefined) updateData.description = description;
        if (termsAndConditions !== undefined) updateData.termsAndConditions = termsAndConditions;
        if (isActive !== undefined) updateData.isActive = isActive;
        
        if (features) {
            updateData.features = Array.isArray(features) ? features : features.split(',').map(f => f.trim());
        }

        if (benefits) {
            updateData.benefits = {
                unlimitedCodAccess: true,
                freeDoctorAppointmentsCount: Number(benefits.freeDoctorAppointmentsCount ?? 0),
                freeNurseVisitsCount: Number(benefits.freeNurseVisitsCount ?? 0),
                freeLabDeliveriesCount: Number(benefits.freeLabDeliveriesCount ?? 0),
                freeNurseDeliveriesCount: Number(benefits.freeNurseDeliveriesCount ?? 0),
                freePharmacyDeliveriesCount: Number(benefits.freePharmacyDeliveriesCount ?? 0),
                freeAmbulanceTripsCount: Number(benefits.freeAmbulanceTripsCount ?? 0)
            };
        }

        const updatedPlan = await SubscriptionPlan.findByIdAndUpdate(id, { $set: updateData }, { new: true })
            .populate('categoryId', 'name slug isDiseaseSpecific')
            .populate('diseaseIds', 'name slug');

        if (!updatedPlan) return res.status(404).json({ success: false, message: "Subscription plan not found." });

        res.json({ success: true, message: "Subscription plan updated successfully.", data: updatedPlan });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteSubscriptionPlanByAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const deletedPlan = await SubscriptionPlan.findByIdAndDelete(id);
        if (!deletedPlan) return res.status(404).json({ success: false, message: "Plan not found." });
        res.json({ success: true, message: "Plan deleted successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 👥 4. SUBSCRIBERS LIST
// =========================================================================

const getAllSubscribersForAdmin = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, categoryId, diseaseId, search } = req.query;
        const query = {};

        if (status) query.status = status;

        if (search) {
            const matchedUsers = await User.find({
                $or: [
                    { name: { $regex: search, $options: 'i' } },
                    { phone: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } }
                ]
            }).select('_id');
            const userIds = matchedUsers.map(u => u._id);
            query.userId = { $in: userIds };
        }

        const skip = (Number(page) - 1) * Number(limit);

        let subscriptions = await UserSubscription.find(query)
            .populate('userId', 'name email phone countryCode profilePic gender dob userAddress')
            .populate({
                path: 'planId',
                populate: [
                    { path: 'categoryId', select: 'name slug' },
                    { path: 'diseaseIds', select: 'name slug' }
                ]
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Number(limit))
            .lean();

        if (categoryId || diseaseId) {
            subscriptions = subscriptions.filter(sub => {
                let match = true;
                if (categoryId && String(sub.planId?.categoryId?._id) !== String(categoryId)) match = false;
                if (diseaseId && !sub.planId?.diseaseIds?.some(d => String(d._id) === String(diseaseId))) match = false;
                return match;
            });
        }

        const totalRecords = await UserSubscription.countDocuments(query);
        const totalActive = await UserSubscription.countDocuments({ status: 'Active' });
        const totalExpired = await UserSubscription.countDocuments({ status: 'Expired' });
        const totalPaid = await UserSubscription.countDocuments({ paymentStatus: 'Paid' });

        res.status(200).json({
            success: true,
            count: subscriptions.length,
            totalRecords,
            totalPages: Math.ceil(totalRecords / Number(limit)),
            currentPage: Number(page),
            overview: {
                totalActiveSubscribers: totalActive,
                totalExpiredSubscribers: totalExpired,
                totalPaidSubscriptions: totalPaid
            },
            data: subscriptions
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createCategory,
    getCategories,
    updateCategory,
    deleteCategory,
    createDisease,
    getDiseases,
    updateDisease,
    deleteDisease,
    createSubscriptionPlanByAdmin,
    getAllSubscriptionPlansByAdmin,
    getSubscriptionPlanByIdByAdmin,
    updateSubscriptionPlanByAdmin,
    deleteSubscriptionPlanByAdmin,
    getAllSubscribersForAdmin
};