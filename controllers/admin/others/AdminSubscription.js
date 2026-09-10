const SubscriptionCategory = require('../../../models/SubscriptionCategory');
const SubscriptionDisease = require('../../../models/SubscriptionDisease');
const SubscriptionPlan = require('../../../models/SubscriptionPlan');
const UserSubscription = require('../../../models/UserSubscription');
const User = require('../../../models/User');
const mongoose = require('mongoose');

// =========================================================================
// 📂 1. CATEGORY MANAGEMENT
// =========================================================================

const createCategory = async (req, res) => {
    try {
        const { name, description, iconImage, isDiseaseSpecific, displayOrder } = req.body;

        if (!name || String(name).trim() === "") {
            return res.status(400).json({ success: false, message: "Category name is required." });
        }

        const cleanName = String(name).trim();
        const autoSlug = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

        const existing = await SubscriptionCategory.findOne({
            $or: [
                { name: { $regex: new RegExp(`^${cleanName}$`, 'i') } },
                { slug: autoSlug }
            ]
        });

        if (existing) {
            return res.status(400).json({ success: false, message: `Category '${cleanName}' already exists.` });
        }

        const category = await SubscriptionCategory.create({
            name: cleanName,
            slug: autoSlug,
            description: description || "",
            iconImage: iconImage || null,
            isDiseaseSpecific: isDiseaseSpecific === 'true' || isDiseaseSpecific === true,
            displayOrder: Number(displayOrder) || 0,
            isActive: true
        });

        return res.status(201).json({ 
            success: true, 
            message: "Category created successfully.", 
            data: category 
        });
    } catch (error) {
        console.error("❌ [CREATE CATEGORY ERROR]:", error);
        return res.status(500).json({ success: false, message: error.message || "Failed to create category" });
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
            updateData.slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
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
// 🩺 2. DISEASE MANAGEMENT (Fixed: 500 Error Crash-Proof & Smart Lookup)
// =========================================================================

const createDisease = async (req, res) => {
    try {
        const { categoryId, name, description, iconImage } = req.body;

        if (!categoryId || !name || String(name).trim() === "") {
            return res.status(400).json({ 
                success: false, 
                message: "categoryId and disease name are required." 
            });
        }

        // 🔍 Smart Category Lookup (Supports ObjectId, Slug, or Name!)
        let category = null;
        if (mongoose.isValidObjectId(categoryId)) {
            category = await SubscriptionCategory.findById(categoryId);
        } else {
            category = await SubscriptionCategory.findOne({
                $or: [
                    { slug: String(categoryId).toLowerCase().trim() },
                    { name: { $regex: new RegExp(`^${String(categoryId).trim()}$`, 'i') } }
                ]
            });
        }

        if (!category) {
            return res.status(404).json({ 
                success: false, 
                message: `Parent Category not found for '${categoryId}'. Please provide a valid category ObjectId, slug or name.` 
            });
        }

        const cleanName = String(name).trim();
        const autoSlug = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

        // Check if disease already exists under this category (case-insensitive)
        const existing = await SubscriptionDisease.findOne({ 
            categoryId: category._id, 
            name: { $regex: new RegExp(`^${cleanName}$`, 'i') } 
        });

        if (existing) {
            return res.status(400).json({ 
                success: false, 
                message: `Disease '${cleanName}' is already added under category '${category.name}'.` 
            });
        }

        const disease = await SubscriptionDisease.create({
            categoryId: category._id,
            name: cleanName,
            slug: autoSlug,
            description: description || "",
            iconImage: iconImage || null,
            isActive: true
        });

        const populated = await SubscriptionDisease.findById(disease._id).populate('categoryId', 'name slug isDiseaseSpecific');

        return res.status(201).json({ 
            success: true, 
            message: "Disease added successfully.", 
            data: populated 
        });

    } catch (error) {
        console.error("❌ [CREATE DISEASE ERROR]:", error);
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: "A disease with this name already exists under this category." });
        }
        return res.status(500).json({ success: false, message: error.message || "Failed to create disease" });
    }
};

const getDiseases = async (req, res) => {
    try {
        const { categoryId, search, isActive } = req.query;
        const query = {};

        if (categoryId) {
            if (mongoose.isValidObjectId(categoryId)) {
                query.categoryId = categoryId;
            } else {
                const cat = await SubscriptionCategory.findOne({
                    $or: [{ slug: categoryId.toLowerCase() }, { name: categoryId }]
                });
                if (cat) query.categoryId = cat._id;
            }
        }

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
            updateData.slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        }
        if (description !== undefined) updateData.description = description;
        if (iconImage !== undefined) updateData.iconImage = iconImage;
        if (categoryId && mongoose.isValidObjectId(categoryId)) updateData.categoryId = categoryId;
        if (isActive !== undefined) updateData.isActive = isActive;

        const updated = await SubscriptionDisease.findByIdAndUpdate(id, { $set: updateData }, { new: true })
            .populate('categoryId', 'name slug');

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
// 📦 3. MASTER PLANS MANAGEMENT
// =========================================================================

const createSubscriptionPlanByAdmin = async (req, res) => {
    try {
        const { 
            categoryId, 
            diseaseIds,        // 👈 Optional for Elder Care, Required ONLY for Condition Management
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

        // 1. Resolve Category
        let category = null;
        if (mongoose.isValidObjectId(categoryId)) {
            category = await SubscriptionCategory.findById(categoryId);
        } else {
            category = await SubscriptionCategory.findOne({
                $or: [{ slug: String(categoryId).toLowerCase() }, { name: String(categoryId) }]
            });
        }

        if (!category) {
            return res.status(404).json({ success: false, message: "Selected category not found." });
        }

        // =========================================================================
        // 🎯 2. DISEASE REQUIREMENT CHECK (Category ke flag ke hisaab se)
        // =========================================================================
        let finalDiseaseIds = [];

        if (category.isDiseaseSpecific === true) {
            // 🟢 CASE A: Condition Management Category -> At least 1 Disease is COMPULSORY
            let parsed = [];
            if (diseaseIds) {
                parsed = Array.isArray(diseaseIds) ? diseaseIds : [diseaseIds];
            }

            if (parsed.length === 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Category '${category.name}' is disease-specific. Please select at least 1 Disease / Condition for this plan.` 
                });
            }
            finalDiseaseIds = parsed;
        } else {
            // 🟢 CASE B: Elder Care / General Categories -> NO DISEASE NEEDED!
            finalDiseaseIds = []; // Always empty array for Elder Care
        }

        // 3. Auto-add Unlimited COD benefit
        let planFeatures = Array.isArray(features) ? features : (features ? features.split(',').map(f => f.trim()) : []);
        const codFeatureText = "Unlimited Cash on Delivery (COD) Access on All Bookings";
        if (!planFeatures.includes(codFeatureText)) {
            planFeatures.unshift(codFeatureText);
        }

        // 4. Create Plan
        const newPlan = await SubscriptionPlan.create({
            categoryId: category._id,
            diseaseIds: finalDiseaseIds, // Elder care me [] save hoga, Condition me [diseaseId1, diseaseId2]
            name: name.trim(),
            validityInDays: Number(validityInDays),
            price: Number(price),
            description: description || "",
            termsAndConditions: termsAndConditions || "",
            features: planFeatures,
            benefits: {
                unlimitedCodAccess: true,
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

        res.status(201).json({ 
            success: true, 
            message: `Plan '${newPlan.name}' created successfully under '${category.name}'.`, 
            data: populated 
        });

    } catch (error) {
        console.error("Create Plan Error:", error);
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
// 👥 4. SUBSCRIBERS LIST & DETAILS
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

const getSubscriberDetailForAdmin = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ success: false, message: "Invalid ID format." });
        }

        const subscription = await UserSubscription.findOne({
            $or: [
                { _id: new mongoose.Types.ObjectId(id) },
                { userId: new mongoose.Types.ObjectId(id) }
            ]
        })
        .populate('userId', 'name email phone countryCode profilePic gender dob userAddress conditionStatus')
        .populate({
            path: 'planId',
            populate: [
                { path: 'categoryId' },
                { path: 'diseaseIds' }
            ]
        });

        if (!subscription) {
            return res.status(404).json({ success: false, message: "Subscription record not found for this ID." });
        }

        res.status(200).json({ success: true, data: subscription });
    } catch (error) {
        console.error("Get Subscriber Detail Error:", error);
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
    getAllSubscribersForAdmin,
    getSubscriberDetailForAdmin
};