const SubscriptionPlan = require('../../../models/SubscriptionPlan');
const UserSubscription = require('../../../models/UserSubscription');
const User = require('../../../models/User');

// --- 1. CREATE PLAN ---
const createSubscriptionPlanByAdmin = async (req, res) => {
    try {
        const { 
            planType, name, diseaseType, validityInDays, price, 
            description, features, benefits, termsAndConditions 
        } = req.body;

        if (!planType || !name || !validityInDays || price === undefined) {
            return res.status(400).json({ success: false, message: "Required fields are missing." });
        }

        const newPlan = await SubscriptionPlan.create({
            planType,
            name,
            diseaseType: planType === 'Condition Management' ? diseaseType : null,
            validityInDays: Number(validityInDays),
            price: Number(price),
            description,
            termsAndConditions: termsAndConditions || "",
            features: Array.isArray(features) ? features : (features ? features.split(',').map(f => f.trim()) : []),
            benefits: {
                freeDoctorAppointmentsCount: Number(benefits?.freeDoctorAppointmentsCount || 0),
                freeNurseVisitsCount: Number(benefits?.freeNurseVisitsCount || 0),
                freeLabDeliveriesCount: Number(benefits?.freeLabDeliveriesCount || 0),
                freeNurseDeliveriesCount: Number(benefits?.freeNurseDeliveriesCount || 0),
                freePharmacyDeliveriesCount: Number(benefits?.freePharmacyDeliveriesCount || 0),
                freeAmbulanceTripsCount: Number(benefits?.freeAmbulanceTripsCount || 0)
            }
        });

        res.status(201).json({ success: true, message: "Subscription plan created.", data: newPlan });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. UPDATE PLAN ---
const updateSubscriptionPlanByAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { planType, name, diseaseType, validityInDays, price, description, features, benefits, isActive, termsAndConditions } = req.body;

        const updateData = {};
        if (planType) updateData.planType = planType;
        if (name) updateData.name = name;
        updateData.diseaseType = planType === 'Condition Management' ? diseaseType : null;
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
                freeDoctorAppointmentsCount: Number(benefits.freeDoctorAppointmentsCount ?? 0),
                freeNurseVisitsCount: Number(benefits.freeNurseVisitsCount ?? 0),
                freeLabDeliveriesCount: Number(benefits.freeLabDeliveriesCount ?? 0),
                freeNurseDeliveriesCount: Number(benefits.freeNurseDeliveriesCount ?? 0),
                freePharmacyDeliveriesCount: Number(benefits.freePharmacyDeliveriesCount ?? 0),
                freeAmbulanceTripsCount: Number(benefits.freeAmbulanceTripsCount ?? 0)
            };
        }

        const updatedPlan = await SubscriptionPlan.findByIdAndUpdate(id, { $set: updateData }, { new: true });
        res.json({ success: true, message: "Subscription plan updated.", data: updatedPlan });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. DELETE PLAN ---
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

// --- 4. GET ALL SUBSCRIBED USERS LIST (NEW: For Admin Panel) ---
const getAllSubscribersForAdmin = async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 10, 
            status,       // 'Active', 'Expired', 'Pending', 'Cancelled'
            planType,     // 'Elder Care', 'Condition Management'
            diseaseType,  // 'Dementia', 'Dialysis', 'Cancer'
            search        // Search by user name, phone, email
        } = req.query;

        const query = {};

        // 1. Status Filter
        if (status) {
            query.status = status;
        }

        // 2. User Search Filter (Name, Phone, Email)
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

        // 3. Fetch Data with Population
        let subscriptions = await UserSubscription.find(query)
            .populate('userId', 'name email phone countryCode profilePic gender dob userAddress')
            .populate('planId', 'name planType diseaseType price validityInDays features benefits')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Number(limit))
            .lean();

        // 4. In-memory Filter if planType or diseaseType is passed
        if (planType || diseaseType) {
            subscriptions = subscriptions.filter(sub => {
                let match = true;
                if (planType && sub.planId?.planType !== planType) match = false;
                if (diseaseType && sub.planId?.diseaseType !== diseaseType) match = false;
                return match;
            });
        }

        const totalRecords = await UserSubscription.countDocuments(query);

        // 5. Quick Overview Stats for Admin Dashboard Top Cards
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
        console.error("Get All Subscribers Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 5. GET SINGLE SUBSCRIBER DETAIL (NEW: For Modal / View Details) ---
const getSubscriberDetailForAdmin = async (req, res) => {
    try {
        const { id } = req.params;

        const subscription = await UserSubscription.findById(id)
            .populate('userId', 'name email phone countryCode profilePic gender dob userAddress conditionStatus')
            .populate('planId');

        if (!subscription) {
            return res.status(404).json({ success: false, message: "Subscription record not found." });
        }

        res.status(200).json({
            success: true,
            data: subscription
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { 
    createSubscriptionPlanByAdmin, 
    updateSubscriptionPlanByAdmin, 
    deleteSubscriptionPlanByAdmin,
    getAllSubscribersForAdmin,
    getSubscriberDetailForAdmin
};