const Nurse = require('../../../models/Nurse');
const NurseService = require('../../../models/NurseService');
const NurseBooking = require('../../../models/NurseBooking');
const MasterConsumable = require('../../../models/MasterConsumable');
const Driver = require('../../../models/Driver');
const CareService = require('../../../models/CareService');
const { deleteFile } = require('../../../utils/fileHandler'); // 👈 Correct relative import
const moment = require('moment');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const ProfileUpdateRequest = require('../../../models/ProfileUpdateRequest'); // For handling profile update requests
const { sendPushNotification } = require('../../../utils/notification');

// ==========================================
// 1. PROFILE & DASHBOARD (Updated with Priority Count)
// ==========================================
const getProviderDashboard = async (req, res) => {
    try {
        const stats = await NurseBooking.aggregate([
            { $match: { nurseId: req.user._id } },
            { $group: {
                _id: null,
                pendingRequests: { $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] } },
                // 🚀 New: Count of pending requests that have faster/express service charge applied
                priorityRequests: { 
                    $sum: { 
                        $cond: [
                            { 
                                $and: [
                                    { $eq: ["$status", "Pending"] }, 
                                    { $gt: ["$priceBreakdown.fasterServiceCharge", 0] }
                                ] 
                            }, 
                            1, 
                            0
                        ] 
                    } 
                },
                activeJobs: { $sum: { $cond: [{ $in: ["$status", ["Confirmed", "Assigned", "On-The-Way", "Arrived", "Service-Started"]] }, 1, 0] } },
                completedJobs: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
                totalEarnings: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, "$totalPrice", 0] } }
            }}
        ]);
        
        res.json({ 
            success: true, 
            data: stats[0] || { pendingRequests: 0, priorityRequests: 0, activeJobs: 0, completedJobs: 0, totalEarnings: 0 } 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};


// ==========================================
// 2. SERVICE MANAGEMENT (Figma: Add/Edit Service)
// ==========================================
const updateProviderProfile = async (req, res) => {
    try {
        const nurseId = req.user.id;
        const updates = { ...req.body };
 
        // 🚨 SECURITY LOCKS
        delete updates.email;
        delete updates.phone;
        delete updates.password;
        delete updates.role;
        delete updates.profileStatus;
        delete updates.documents;
 
        if (req.files && req.files.profileImage && req.files.profileImage[0]) {
            updates.profileImage = req.files.profileImage[0].path;
        }
 
        // 🚨 DISK CLEANUP: Delete unapproved files from any existing PENDING request
        const existingPending = await ProfileUpdateRequest.findOne({ vendorId: nurseId, vendorModel: 'Nurse', status: 'Pending' });
        if (existingPending) {
            if (updates.profileImage && existingPending.updatedFields?.profileImage) {
                deleteFile(existingPending.updatedFields.profileImage);
            }
            await ProfileUpdateRequest.findByIdAndDelete(existingPending._id);
        }

        const request = await ProfileUpdateRequest.create({
            vendorId: nurseId,
            vendorModel: 'Nurse',
            updatedFields: updates,
            status: 'Pending'
        });
 
        res.json({
            success: true,
            message: "Profile changes submitted to Admin for review. Your profile will update once approved.",
            data: request
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// PATCH: Change Nurse Bureau Password
// Endpoint: PATCH /provider/nurse/dash/profile/change-password
const changeNursePassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ success: false, message: "Old password and new password are required." });
        }

        const nurse = await Nurse.findById(req.user.id).select('+password');
        if (!nurse) return res.status(404).json({ success: false, message: "Nurse Bureau not found." });

        const isMatch = await bcrypt.compare(String(oldPassword), nurse.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Old password does not match." });
        }

        nurse.password = await bcrypt.hash(String(newPassword), 10);
        await nurse.save();

        res.json({ success: true, message: "Nurse Bureau password updated successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET: Fetch latest profile update request status for logged-in Nurse Bureau
const getLatestNurseProfileRequest = async (req, res) => {
    try {
        const latestRequest = await ProfileUpdateRequest.findOne({
            vendorId: req.user.id,
            vendorModel: 'Nurse'
        })
        .sort({ createdAt: -1 })
        .lean();

        res.json({ success: true, data: latestRequest || null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
 
const manageNurseService = async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;

        // Parse JSON inputs
        const pricingInput = typeof data.pricing === 'string' ? JSON.parse(data.pricing) : data.pricing;
        const consumablesInput = typeof data.consumablesUsed === 'string' ? JSON.parse(data.consumablesUsed) : data.consumablesUsed;

        const calculate = (base, disc) => Math.round(Number(base) - (Number(base) * (Number(disc) / 100)));
        
        // Match Model Keys: base, discount, final
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

        // Process Consumables properly
        let processedConsumables = [];
        if (consumablesInput && Array.isArray(consumablesInput)) {
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
        }

        const serviceData = {
            ...data,
            nurseId: req.user.id,
            pricing,
            consumablesUsed: processedConsumables,
            status: 'Approved', // Force Approved
            photos: req.files ? req.files.map(f => f.path) : undefined
        };

        let result;
        if (id) {
            result = await NurseService.findOneAndUpdate({ _id: id, nurseId: req.user.id }, serviceData, { new: true });
        } else {
            result = await NurseService.create(serviceData);
        }

        res.status(201).json({ success: true, message: "Listed Successfully", data: result });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getMyServices = async (req, res) => {
    try {
        const { status } = req.query; // Approved, Pending, Rejected
        const query = { nurseId: req.user.id };
        if (status) query.status = status;

        const services = await NurseService.find(query).populate('consumablesUsed.masterItemId').sort({ createdAt: -1 });
        res.json({ success: true, data: services });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const deleteService = async (req, res) => {
    try {
        await NurseService.findOneAndDelete({ _id: req.params.id, nurseId: req.user.id });
        res.json({ success: true, message: "Service Deleted" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 3. BOOKING MANAGEMENT (Updated with Priority Filter)
// ==========================================
const getBookingRequests = async (req, res) => {
    try {
        const { status, isPriority } = req.query; // e.g. status=Pending
        
        // 🌟 Pagination Parameters (Strictly 20 limit as requested)
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20; 
        const skip = (page - 1) * limit;

        let query = { nurseId: req.user.id };
        
        if (status) query.status = status;

        // Priority / Faster Service filter logic
        if (isPriority === 'true') {
            query['priceBreakdown.fasterServiceCharge'] = { $gt: 0 };
        } else if (isPriority === 'false') {
            query['priceBreakdown.fasterServiceCharge'] = { $eq: 0 };
        }

        // Get total count matching query for frontend pagination UI
        const total = await NurseBooking.countDocuments(query);

        // Fetch bookings with fully populated user, staff, and consumable details
        const bookings = await NurseBooking.find(query)
            .populate('userId', 'name phone email profilePic') // 🌟 order creator/user details populated
            .populate('assignedStaffId', 'name phone profilePic status location') // staff details populated
            .populate('selectedConsumables.consumableId', 'itemName price unitType') // 🌟 consumables details populated
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.json({ 
            success: true, 
            count: bookings.length, 
            totalItems: total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: bookings 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 4. PROVIDER BOOKING ACTION (Accept / Reject with Auto-Refund & Subscription Sync)
// Endpoint: POST /provider/nurse/dash/booking/action
const handleBookingAction = async (req, res) => {
    try {
        const { bookingId, action, reason } = req.body;
        const nurseId = req.user.id;

        if (!bookingId || !action || !['Accept', 'Reject'].includes(action)) {
            return res.status(400).json({ success: false, message: "bookingId and action ('Accept' or 'Reject') are required." });
        }

        const booking = await NurseBooking.findOne({ _id: bookingId, nurseId });
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found or unauthorized." });
        }

        if (action === 'Accept') {
            booking.status = 'Confirmed';
            await booking.save();

            // Notify user
            try {
                await sendPushNotification(
                    booking.userId,
                    'user',
                    "Nursing Booking Confirmed! 👩‍⚕️",
                    "The Nurse Provider has accepted your booking. A staff nurse will be assigned shortly.",
                    { bookingId: booking._id.toString(), type: 'nurse_booking_confirmed' }
                );
            } catch (e) {}

            return res.json({ success: true, message: "Booking accepted successfully.", data: booking });
        }

        // ==========================================
        // REJECTION CASE: AUTO-REFUND & BENEFIT RESTORE
        // ==========================================
        if (action === 'Reject') {
            booking.status = 'Cancelled';
            booking.cancelReason = reason || "Provider unavailable at requested time.";

            // 🚨 1. REFUND SYNC: Move online payment to refund queue
            if (booking.paymentStatus === 'Paid') {
                booking.paymentStatus = 'Refund-Initiated';
            }

            // 🚨 2. SUBSCRIPTION SYNC: Refund benefit count back to subscriber
            if (booking.subscriptionDetails?.isSubscriptionApplied) {
                const { refundBenefitCount } = require('../../../utils/subscriptionBenefitHelper');
                await refundBenefitCount(booking.userId, 'freeNurseVisitsCount');
            }

            await booking.save();

            // Notify user
            try {
                await sendPushNotification(
                    booking.userId,
                    'user',
                    "Booking Declined by Provider",
                    `Your nurse booking was declined (${reason || 'Slot Full'}). Any paid amount has been initiated for refund.`,
                    { bookingId: booking._id.toString(), type: 'nurse_booking_declined' }
                );
            } catch (e) {}

            return res.json({ 
                success: true, 
                message: "Booking rejected. Online refund initiated and subscription benefits restored.", 
                data: booking 
            });
        }

    } catch (error) { 
        console.error("Handle Booking Action Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

const getAvailableStaff = async (req, res) => {
    try {
        const staff = await Driver.find({ vendorId: req.user.id, vendorType: 'Nurse', status: 'Available' });
        res.json({ success: true, data: staff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 1. ASSIGN STAFF TO BOOKING (With Real-Time Driver Push Notification)
// Endpoint: POST /provider/nurse/dash/staff/assign
const assignStaffToBooking = async (req, res) => {
    try {
        const { bookingId, staffId } = req.body;
        const nurseId = req.user.id;

        const booking = await NurseBooking.findOne({ _id: bookingId, nurseId });
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found or unauthorized." });
        }

        const staff = await Driver.findOne({ _id: staffId, vendorId: nurseId, vendorType: 'Nurse' });
        if (!staff || staff.status === 'Offline') {
            return res.status(400).json({ success: false, message: "Staff member is offline or not found." });
        }

        booking.assignedStaffId = staffId;
        booking.status = 'Assigned';
        await booking.save();

        await Driver.findByIdAndUpdate(staffId, { status: 'Busy' });

        // 🚨 FCM PUSH NOTIFICATION: Alert Nurse Staff on New Assignment
        await sendPushNotification(
            staffId,
            'driver',
            "New Nursing Care Task Assigned!",
            `You have been assigned booking #${booking.bookingId || booking._id}. Tap to view patient address.`,
            { bookingId: booking._id.toString(), type: 'nurse_task_assigned' }
        );

        res.json({ 
            success: true, 
            message: "Nurse Staff assigned successfully & alert sent.", 
            data: booking 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};
// 2. REASSIGN STAFF (With Real-Time Driver Push Notifications)
// Endpoint: POST /provider/nurse/dash/staff/reassign
const reassignStaffToBooking = async (req, res) => {
    try {
        const { bookingId, newStaffId } = req.body;
        const nurseId = req.user.id;

        if (!bookingId || !newStaffId) {
            return res.status(400).json({ success: false, message: "Missing bookingId or newStaffId parameter." });
        }

        const booking = await NurseBooking.findOne({ _id: bookingId, nurseId });
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found or unauthorized." });
        }

        const oldStaffId = booking.assignedStaffId;

        // 1. Release old staff back to Available
        if (oldStaffId) {
            await Driver.findByIdAndUpdate(oldStaffId, { status: 'Available' });
        }

        // 2. Set new staff to Busy
        await Driver.findByIdAndUpdate(newStaffId, { status: 'Busy' });

        // 3. Update booking
        booking.assignedStaffId = newStaffId;
        booking.status = 'Assigned';
        await booking.save();

        // 🚨 FCM PUSH NOTIFICATION: Alert newly assigned staff
        await sendPushNotification(
            newStaffId,
            'driver',
            "Reassigned Nursing Task!",
            `You have been assigned booking #${booking.bookingId || booking._id}.`,
            { bookingId: booking._id.toString(), type: 'nurse_task_assigned' }
        );

        res.json({ 
            success: true, 
            message: "Staff reassigned successfully & notified.", 
            data: {
                bookingId: booking._id,
                status: booking.status,
                assignedStaffId: newStaffId
            }
        });

    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

const getStaffByStatus = async (req, res) => {
    try {
        // Example usage: /staff/list?status=Busy,Offline
        const { status } = req.query;
        
        let query = { vendorId: req.user.id, vendorType: 'Nurse' };
        
        if (status) {
            // Split by comma if multiple statuses are passed
            const statusArray = status.split(',');
            query.status = { $in: statusArray };
        } else {
            // Default to Available if no query is provided
            query.status = 'Available';
        }

        const staff = await Driver.find(query);
        res.json({ success: true, data: staff });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};
// 🌟 NEW CONTROLLER: GET STAFF MEMBER'S CURRENT ACTIVE JOB
// endpoint: GET /provider/nurse/dash/staff/active-job/:staffId
const getStaffActiveJob = async (req, res) => {
    try {
        const { staffId } = req.params;
        const nurseId = req.user.id; // Bureau provider ID for security ownership

        if (!mongoose.Types.ObjectId.isValid(staffId)) {
            return res.status(400).json({ success: false, message: "Invalid staff ID provided." });
        }

        // Find current ongoing active booking for this specific staff nurse
        const activeBooking = await NurseBooking.findOne({
            nurseId,
            assignedStaffId: staffId,
            status: { $in: ['Assigned', 'On-The-Way', 'Arrived', 'Service-Started'] } // Active tracking states
        })
        .populate('userId', 'name phone email profilePic') // Populates patient details
        .populate('selectedConsumables.consumableId', 'itemName price unitType') // Populates consumables details
        .lean();

        // Agar staff ko abhi koi active booking assigned nahi hai
        if (!activeBooking) {
            return res.json({ 
                success: true, 
                message: "This staff member is currently not working on any active job.",
                data: null 
            });
        }

        res.json({
            success: true,
            message: "Current active job retrieved successfully.",
            data: activeBooking
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// SEARCH / LIST ALL MASTER CONSUMABLES (For Dropdowns & Add-ons)
// Endpoint: GET /provider/nurse/dash/consumables/search
const searchMasterConsumables = async (req, res) => {
    try {
        const { search } = req.query;
        let query = { isActive: true };

        if (search && search.trim() !== '') {
            query.itemName = { $regex: search.trim(), $options: 'i' };
        }

        const items = await MasterConsumable.find(query).sort({ itemName: 1 }).lean();

        res.json({ 
            success: true, 
            count: items.length, 
            data: items 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};


// ==========================================
// 5. ORDER HISTORY (Figma: Completed/Cancelled Bookings)
// ==========================================
const getOrderHistory = async (req, res) => {
    try {
        const nurseId = req.user.id;
        const { status, startDate, endDate } = req.query;

        // Sirf wahi orders jo khatam ho chuke hain ya cancel hue hain
        let query = { 
            nurseId, 
            status: { $in: ['Completed', 'Cancelled'] } 
        };

        // Optional status filter (e.g. ?status=Completed)
        if (status) query.status = status;

        // Optional Date Filter (History for specific range)
        if (startDate && endDate) {
            query.createdAt = { 
                $gte: moment(startDate).startOf('day').toDate(), 
                $lte: moment(endDate).endOf('day').toDate() 
            };
        }

        const history = await NurseBooking.find(query)
            .populate('userId', 'name phone profileImage')
            .populate('assignedStaffId', 'name phone profilePic')
            .sort({ updatedAt: -1 });

        res.json({ success: true, count: history.length, data: history });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// ==========================================
// 6. TRACK NURSE (Figma: Active Job Progress)
// ==========================================
const trackNurse = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const nurseId = req.user.id;

        // Fetching the active booking and populating User details as well as Assigned Staff (Driver) details
        const activeBooking = await NurseBooking.findOne({ 
            _id: bookingId, 
            nurseId 
        })
        .populate('userId', 'name phone profilePic gender dob')
        .populate({
            path: 'assignedStaffId',
            select: 'name phone profilePic status location' // 👈 Strictly populates name, phone, and coordinates of staff/driver
        });

        if (!activeBooking) {
            return res.status(404).json({ success: false, message: "Active booking not found." });
        }

        // --- Driver / Staff Fallback Safety checks ---
        let staffDetails = null;
        if (activeBooking.assignedStaffId) {
            staffDetails = {
                staffId: activeBooking.assignedStaffId._id,
                staffName: activeBooking.assignedStaffId.name || "Not Available", // 👈 Flat key for Driver/Staff Name
                staffPhone: activeBooking.assignedStaffId.phone || "Not Available",
                staffProfilePic: activeBooking.assignedStaffId.profilePic || null,
                staffStatus: activeBooking.assignedStaffId.status || "Busy",
                staffLocation: activeBooking.assignedStaffId.location || { lat: 0, lng: 0 } // Live location for Map View
            };
        }

        // Simulation values for ETA and distance calculations
        const eta = "25 mins"; 
        const distance = "3.2 km";

        res.json({ 
            success: true, 
            data: {
                bookingId: activeBooking._id,
                bookingIdCustom: activeBooking.bookingId, // E.g., HKN-RX-9F8E2D
                bookingStatus: activeBooking.status,      // E.g., Assigned, On-The-Way, Arrived
                bookingType: activeBooking.bookingType || "Regular",
                
                // 1. Live Assigned Staff / Driver Details
                assignedStaff: staffDetails, 
                
                // 2. Patient / User Information
                patientDetails: {
                    userId: activeBooking.userId ? activeBooking.userId._id : null,
                    patientName: activeBooking.userId ? activeBooking.userId.name : "Guest",
                    patientPhone: activeBooking.userId ? activeBooking.userId.phone : "Not Available",
                    patientProfilePic: activeBooking.userId ? activeBooking.userId.profilePic : null,
                    patientsList: activeBooking.patients || [] // Flat patients details nested inside booking
                },
                
                // 3. Service / Package Snapshot
                serviceDetails: activeBooking.serviceDetails || {
                    title: "Nursing Service",
                    type: "Home Visit"
                },

                // 4. Detailed Target Address
                address: {
                    houseNo: activeBooking.address ? activeBooking.address.houseNo : "",
                    sector: activeBooking.address ? activeBooking.address.sector : "",
                    landmark: activeBooking.address ? activeBooking.address.landmark : "",
                    city: activeBooking.address ? activeBooking.address.city : "",
                    pincode: activeBooking.address ? activeBooking.address.pincode : "",
                    state: activeBooking.address ? activeBooking.address.state : ""
                },

                // 5. Simulated Live ETA Parameters
                trackingMetrics: {
                    eta: eta,
                    distance: distance
                },

                // 6. Live Check-Points Progress
                progress: {
                    isAssigned: activeBooking.status === 'Assigned',
                    isOnWay: activeBooking.status === 'On-The-Way',
                    isArrived: activeBooking.status === 'Arrived',
                    isStarted: activeBooking.status === 'Service-Started',
                    isCompleted: activeBooking.status === 'Completed'
                }
            } 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// =========================================================================
// GET CARE TEMPLATE & PAGINATED CONSUMABLES FOR PROVIDER PANEL
// Endpoint: GET /provider/nurse/dash/care-details?category=...&subCategory=...&page=1&limit=20&search=
// =========================================================================
const getProviderCareServiceDetails = async (req, res) => {
    try {
        const { category, subCategory, search } = req.query;
        
        // Pagination Query Parameters
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20; // Default 20 items per page
        const skip = (page - 1) * limit;

        let details = null;
        let resolvedConsumables = [];

        // 1. Fetch Care Service Template if category and subCategory are provided
        if (category && subCategory) {
            details = await CareService.findOne({ 
                category: { $regex: new RegExp("^" + category.trim() + "$", "i") },
                subCategory: { $regex: new RegExp("^" + subCategory.trim() + "$", "i") }
            }).lean();

            // 2. Parse template-specific consumables from CSV string if present
            if (details && details.consumablesUsed && typeof details.consumablesUsed === 'string' && details.consumablesUsed.trim() !== '') {
                const delimiter = details.consumablesUsed.includes('||') ? '||' : ',';
                const itemStrings = details.consumablesUsed.split(delimiter).map(s => s.trim()).filter(Boolean);

                resolvedConsumables = await Promise.all(itemStrings.map(async (str) => {
                    const regex = /(.+?)\s*\[(.+?)\]/; 
                    const match = str.match(regex);

                    if (match) {
                        const itemName = match[1].trim();
                        const size = match[2].trim();

                        let found = await MasterConsumable.findOne({
                            itemName: { $regex: new RegExp("^" + itemName + "$", "i") },
                            size: { $regex: new RegExp("^" + size + "$", "i") },
                            isActive: true
                        }).lean();

                        if (!found) {
                            found = await MasterConsumable.findOne({
                                itemName: { $regex: new RegExp("^" + itemName + "$", "i") },
                                isActive: true
                            }).lean();
                        }
                        return found;
                    } else {
                        return await MasterConsumable.findOne({
                            itemName: { $regex: new RegExp("^" + str + "$", "i") },
                            isActive: true
                        }).lean();
                    }
                }));

                resolvedConsumables = resolvedConsumables.filter(Boolean);
            }
        }

        // 3. Dynamic Paginated Query for Master Consumables (with search support)
        let masterQuery = { isActive: true };
        if (search && search.trim() !== '') {
            masterQuery.itemName = { $regex: search.trim(), $options: 'i' };
        }

        const [masterList, totalMasterItems] = await Promise.all([
            MasterConsumable.find(masterQuery)
                .sort({ itemName: 1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            MasterConsumable.countDocuments(masterQuery)
        ]);

        // Priority logic: If specific template consumables exist use them, else use paginated master list
        const finalConsumables = resolvedConsumables.length > 0 ? resolvedConsumables : masterList;

        res.json({ 
            success: true, 
            data: { 
                template: details || null,
                resolvedConsumables: finalConsumables,
                allConsumables: masterList,
                // Pagination Metadata for Dropdown
                consumablesPagination: {
                    totalItems: totalMasterItems,
                    totalPages: Math.ceil(totalMasterItems / limit),
                    currentPage: page,
                    limit: limit,
                    hasNextPage: page < Math.ceil(totalMasterItems / limit),
                    hasPrevPage: page > 1
                }
            } 
        });

    } catch (error) { 
        console.error("Provider Care Details Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

module.exports = { 
    getProviderDashboard, updateProviderProfile,changeNursePassword,getLatestNurseProfileRequest, manageNurseService, 
    getMyServices, deleteService, getBookingRequests, 
    handleBookingAction, getAvailableStaff, assignStaffToBooking,reassignStaffToBooking, searchMasterConsumables, getStaffByStatus,getStaffActiveJob,
    getOrderHistory, trackNurse,getProviderCareServiceDetails
};