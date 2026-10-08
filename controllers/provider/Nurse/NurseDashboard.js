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

// @desc    Get Provider Bureau Dashboard Summary (Fail-Safe Revenue & Active Task Counters)
// @route   GET /provider/nurse/dash/dashboard-stats
// @access  Private (Nurse Bureau)
const getProviderDashboard = async (req, res) => {
    try {
        const nurseBureauId = req.user._id;

        const stats = await NurseBooking.aggregate([
            { $match: { nurseId: new mongoose.Types.ObjectId(nurseBureauId) } },
            { 
                $group: {
                    _id: null,
                    pendingRequests: { 
                        $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] } 
                    },
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
                    activeJobs: { 
                        $sum: { 
                            $cond: [
                                { $in: ["$status", ["Confirmed", "Assigned", "On-The-Way", "Arrived", "Service-Started"]] }, 
                                1, 
                                0
                            ] 
                        } 
                    },
                    completedJobs: { 
                        $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } 
                    },
                    // Fail-Safe Sum: Handles both root totalPrice and nested priceBreakdown.totalPrice
                    totalEarnings: { 
                        $sum: { 
                            $cond: [
                                { $eq: ["$status", "Completed"] }, 
                                { $ifNull: ["$totalPrice", "$priceBreakdown.totalPrice", 0] }, 
                                0
                            ] 
                        } 
                    }
                }
            }
        ]);
        
        const summary = stats[0] || { 
            pendingRequests: 0, 
            priorityRequests: 0, 
            activeJobs: 0, 
            completedJobs: 0, 
            totalEarnings: 0 
        };

        res.status(200).json({ 
            success: true, 
            data: {
                ...summary,
                totalEarnings: Math.round(summary.totalEarnings)
            } 
        });

    } catch (error) { 
        console.error("Get Provider Dashboard Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
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
 
// @desc    Create or Update Nurse Service from Bureau Dashboard (Crash-Proof Pricing & Clean Photo URLs)
// @route   POST or PUT /provider/nurse/dash/service/manage
// @access  Private (Nurse Bureau)
const manageNurseService = async (req, res) => {
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

        // Parse nested or flat pricing structures safely without crashing
        const pricingInput = safeParse(data.pricing) || {};

        const resolveBase = (nestedVal, flatKey1, flatKey2) => {
            const val = Number(nestedVal ?? data[flatKey1] ?? data[flatKey2] ?? 0);
            return isNaN(val) ? 0 : Math.max(0, val);
        };

        const resolveDiscount = (nestedVal, flatKey1, flatKey2) => {
            const val = Number(nestedVal ?? data[flatKey1] ?? data[flatKey2] ?? 0);
            return isNaN(val) ? 0 : Math.min(100, Math.max(0, val));
        };

        const oneDayBase = resolveBase(pricingInput.oneDay?.base, 'oneDayBase', 'oneDayPrice');
        const oneDayDisc = resolveDiscount(pricingInput.oneDay?.discount, 'oneDayDiscount', 'discountOneDay');

        const multiDayBase = resolveBase(pricingInput.multipleDays?.base, 'multipleDaysBase', 'multiDayPrice') || oneDayBase;
        const multiDayDisc = resolveDiscount(pricingInput.multipleDays?.discount, 'multipleDaysDiscount', 'discountMultipleDays');

        const hourlyBase = resolveBase(pricingInput.hourly?.base, 'hourlyBase', 'hourlyPrice');
        const hourlyDisc = resolveDiscount(pricingInput.hourly?.discount, 'hourlyDiscount', 'discountHourly');

        const calculate = (base, disc) => Math.max(0, Math.round(base - (base * (disc / 100))));

        const pricing = {
            oneDay: { 
                base: oneDayBase, 
                discount: oneDayDisc, 
                final: calculate(oneDayBase, oneDayDisc) 
            },
            multipleDays: { 
                base: multiDayBase, 
                discount: multiDayDisc, 
                final: calculate(multiDayBase, multiDayDisc) 
            },
            hourly: { 
                base: hourlyBase, 
                discount: hourlyDisc, 
                final: calculate(hourlyBase, hourlyDisc) 
            }
        };

        // Process Consumables properly
        const consumablesInput = safeArrayParse(data.consumablesUsed);
        let processedConsumables = [];
        if (consumablesInput.length > 0) {
            for (let item of consumablesInput) {
                const targetId = item.masterItemId || item.consumableId || item._id;
                if (targetId && mongoose.isValidObjectId(targetId)) {
                    const master = await MasterConsumable.findById(targetId);
                    if (master) {
                        const disc = Number(item.discountPercentage || 0);
                        processedConsumables.push({
                            masterItemId: master._id,
                            discountPercentage: disc,
                            finalPrice: calculate(master.mrp, disc)
                        });
                    }
                }
            }
        }

        // Clean Web URLs for photos
        let photoUrls = undefined;
        if (req.files) {
            const filesArray = Array.isArray(req.files) ? req.files : (req.files.photos || []);
            if (filesArray.length > 0) {
                photoUrls = filesArray.map(f => `/uploads/nurse_services/${f.filename}`);
            }
        }

        const serviceData = {
            nurseId,
            careCategoryId: data.careCategoryId || undefined,
            careSubCategoryId: data.careSubCategoryId || undefined,
            title: data.title ? String(data.title).trim() : "Nursing Care Service",
            description: data.description ? String(data.description).trim() : "",
            type: data.type || 'Daily Care',
            procedureIncluded: data.procedureIncluded || "",
            servicesOffered: data.servicesOffered || "NURSING CARE",
            pricing,
            consumablesUsed: processedConsumables,
            prescriptionRequired: data.prescriptionRequired === 'true' || data.prescriptionRequired === true,
            status: 'Approved'
        };

        if (photoUrls && photoUrls.length > 0) {
            serviceData.photos = photoUrls;
        }

        let result;
        if (id && mongoose.isValidObjectId(id)) {
            result = await NurseService.findOneAndUpdate(
                { _id: id, nurseId }, 
                { $set: serviceData }, 
                { new: true }
            ).populate('consumablesUsed.masterItemId');

            if (!result) {
                return res.status(404).json({ success: false, message: "Service not found or unauthorized access." });
            }
        } else {
            result = await NurseService.create(serviceData);
        }

        res.status(id ? 200 : 201).json({ 
            success: true, 
            message: id ? "Service updated successfully." : "Service listed successfully.", 
            data: result 
        });

    } catch (error) { 
        console.error("Manage Nurse Service Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
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

// @desc    Get Booking Requests for Nurse Bureau (Includes Accurate Pricing, Consumables & COD/Online Details)
// @route   GET /provider/nurse/dash/bookings
// @access  Private (Nurse Bureau)
const getBookingRequests = async (req, res) => {
    try {
        const { status, isPriority, page = 1, limit = 20 } = req.query;
        const nurseId = req.user.id;

        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 20; 
        const skip = (pageNum - 1) * limitNum;

        let query = { nurseId };
        
        if (status && status !== 'All') {
            query.status = status;
        }

        if (isPriority === 'true') {
            query['priceBreakdown.fasterServiceCharge'] = { $gt: 0 };
        } else if (isPriority === 'false') {
            query['priceBreakdown.fasterServiceCharge'] = { $eq: 0 };
        }

        const total = await NurseBooking.countDocuments(query);

        const bookings = await NurseBooking.find(query)
            .populate('userId', 'name phone email profilePic gender dob')
            .populate('assignedStaffId', 'name phone profilePic status location vehicleNumber vehicleType')
            .populate('selectedConsumables.consumableId', 'itemName size mrp unitType')
            .populate('serviceId', 'title description procedureIncluded servicesOffered')
            .populate('packageId', 'packageName description')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean();

        const enrichedBookings = bookings.map(b => {
            const rawMethod = String(b.paymentMethod || '').trim().toUpperCase();
            const isCod = rawMethod === 'COD' || rawMethod.includes('CASH') || rawMethod === 'PAY ON VISIT';
            const isPaid = b.paymentStatus === 'Paid' || b.paymentStatus === 'Done';

            const travelDeliveryFee = Number(
                b.priceBreakdown?.travelFee !== undefined 
                    ? b.priceBreakdown.travelFee 
                    : (b.priceBreakdown?.deliveryCharge || 0)
            );

            const isHospital = b.assessmentLocation === 'At Hospital';
            let destinationLabel = "Home Address";
            if (isHospital && b.hospitalDetails) {
                destinationLabel = `${b.hospitalDetails.hospitalName || 'Hospital'} (${b.hospitalDetails.wardName || 'Ward'} - Bed: ${b.hospitalDetails.bedNumber || 'Bed'})`;
            } else if (b.address && b.address.houseNo) {
                destinationLabel = `${b.address.houseNo}, ${b.address.city || ''} - ${b.address.pincode || ''}`.replace(/^, |, $/g, '');
            }

            const primaryPatient = (Array.isArray(b.patients) && b.patients.length > 0)
                ? b.patients[0]
                : { name: b.userId?.name || "Patient", relation: "Self" };

            let formattedScheduleDate = "";
            if (b.schedule?.startDate) {
                const sDate = moment(b.schedule.startDate).format("DD MMM YYYY");
                if (b.schedule.duration === 'For Multiple Days' && b.schedule.endDate && !moment(b.schedule.startDate).isSame(b.schedule.endDate, 'day')) {
                    const eDate = moment(b.schedule.endDate).format("DD MMM YYYY");
                    formattedScheduleDate = `${sDate} - ${eDate}`;
                } else {
                    formattedScheduleDate = sDate;
                }
            }

            return {
                ...b,
                paymentMethod: isCod ? 'COD' : 'Online',
                paymentStatus: b.paymentStatus || 'Pending',
                isCod,
                isPaid,
                paymentDisplayLabel: isCod ? "Cash on Delivery (COD)" : (isPaid ? "Paid Online" : "Online (Pending)"),
                
                deliveryCharge: travelDeliveryFee,
                travelFee: travelDeliveryFee,
                priceBreakdown: {
                    ...b.priceBreakdown,
                    travelFee: travelDeliveryFee,
                    deliveryCharge: travelDeliveryFee,
                    originalTravelFee: Number(b.priceBreakdown?.originalTravelFee || travelDeliveryFee || 45)
                },
                
                primaryPatientName: primaryPatient.name || primaryPatient.patientName || "Patient",
                primaryPatientRelation: primaryPatient.relation || "Self",
                patientCount: Array.isArray(b.patients) ? b.patients.length : 1,
                destinationLabel,
                formattedScheduleDate,
                formattedScheduleTime: b.schedule?.startTime ? moment(b.schedule.startTime, ["HH:mm", "hh:mm A"]).format("hh:mm A") : "09:00 AM",
                totalAmount: Number(b.totalPrice || b.priceBreakdown?.totalPrice || 0),
                isFasterService: Number(b.priceBreakdown?.fasterServiceCharge || 0) > 0
            };
        });

        res.status(200).json({ 
            success: true, 
            count: enrichedBookings.length, 
            totalItems: total,
            totalPages: Math.ceil(total / limitNum),
            currentPage: pageNum,
            data: enrichedBookings 
        });

    } catch (error) { 
        console.error("Get Bureau Booking Requests Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// @desc    Accept or Reject Patient Booking Request by Bureau (With Auto-Refund, Benefit Restore & Staff Release)
// @route   POST /provider/nurse/dash/booking/action
// @access  Private (Nurse Bureau)
const handleBookingAction = async (req, res) => {
    try {
        const { bookingId, action, reason } = req.body;
        const nurseId = req.user.id;

        if (!bookingId || !action || !['Accept', 'Reject'].includes(action)) {
            return res.status(400).json({ 
                success: false, 
                message: "bookingId and action ('Accept' or 'Reject') are required." 
            });
        }

        const booking = await NurseBooking.findOne({ _id: bookingId, nurseId });
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found or access denied." });
        }

        // 1. ACCEPT ACTION
        if (action === 'Accept') {
            booking.status = 'Confirmed';
            await booking.save();

            try {
                await sendPushNotification(
                    booking.userId,
                    'user',
                    "Nursing Booking Confirmed! 👩‍⚕️",
                    "The Nurse Provider has accepted your booking. A staff nurse will be assigned shortly.",
                    { bookingId: booking._id.toString(), type: 'nurse_booking_confirmed' }
                );
            } catch (e) {}

            return res.status(200).json({ 
                success: true, 
                message: "Booking accepted successfully.", 
                data: booking 
            });
        }

        // 2. REJECT ACTION
        if (action === 'Reject') {
            booking.status = 'Cancelled';
            booking.cancelReason = reason || "Provider unavailable at requested slot.";

            // If an assigned staff nurse was allocated, release them back to Available
            if (booking.assignedStaffId) {
                await Driver.findByIdAndUpdate(booking.assignedStaffId, {
                    $set: { status: 'Available', isOnline: true }
                });
            }

            // Queue payment refund if already paid online
            if (booking.paymentStatus === 'Paid') {
                booking.paymentStatus = 'Refund-Initiated';
            }

            // Restore subscription benefit quota if applied
            if (booking.subscriptionDetails?.isSubscriptionApplied) {
                const { refundBenefitCount } = require('../../../utils/subscriptionBenefitHelper');
                await refundBenefitCount(booking.userId, 'freeNurseVisitsCount');
            }

            await booking.save();

            try {
                await sendPushNotification(
                    booking.userId,
                    'user',
                    "Booking Declined by Nurse Bureau",
                    `Your nurse booking was declined (${reason || 'Slot Full'}). Any paid amount has been initiated for refund.`,
                    { bookingId: booking._id.toString(), type: 'nurse_booking_declined' }
                );
            } catch (e) {}

            return res.status(200).json({ 
                success: true, 
                message: "Booking rejected. Staff driver released and online refund initiated.", 
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


// @desc    Get Completed / Cancelled Order History for Nurse Bureau (With Complete Financial Breakdown)
// @route   GET /provider/nurse/dash/orders/history
// @access  Private (Nurse Bureau)
const getOrderHistory = async (req, res) => {
    try {
        const nurseId = req.user.id;
        const { status, startDate, endDate, page = 1, limit = 20 } = req.query;

        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 20;
        const skip = (pageNum - 1) * limitNum;

        let query = { 
            nurseId, 
            status: { $in: ['Completed', 'Cancelled', 'No-Show'] } 
        };

        if (status && status !== 'All') {
            query.status = status;
        }

        if (startDate && endDate) {
            query.createdAt = { 
                $gte: moment(startDate).startOf('day').toDate(), 
                $lte: moment(endDate).endOf('day').toDate() 
            };
        }

        const total = await NurseBooking.countDocuments(query);

        const history = await NurseBooking.find(query)
            .populate('userId', 'name phone profilePic email')
            .populate('assignedStaffId', 'name phone vehicleNumber profilePic')
            .populate('serviceId', 'title')
            .populate('packageId', 'packageName')
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean();

        const formattedHistory = history.map(b => {
            const rawMethod = String(b.paymentMethod || '').trim().toUpperCase();
            const isCod = rawMethod === 'COD' || rawMethod.includes('CASH') || rawMethod === 'PAY ON VISIT';
            const isPaid = b.paymentStatus === 'Paid' || b.paymentStatus === 'Done';

            const travelDeliveryFee = Number(
                b.priceBreakdown?.travelFee !== undefined 
                    ? b.priceBreakdown.travelFee 
                    : (b.priceBreakdown?.deliveryCharge || 0)
            );

            const isHospital = b.assessmentLocation === 'At Hospital';
            let locationDisplay = "N/A";
            if (isHospital && b.hospitalDetails) {
                locationDisplay = `${b.hospitalDetails.hospitalName || 'Hospital'} (${b.hospitalDetails.wardName || 'Ward'})`;
            } else if (b.address && b.address.houseNo) {
                locationDisplay = `${b.address.houseNo}, ${b.address.sector || ''}, ${b.address.city || ''}`.replace(/^, |, $/g, '');
            }

            return {
                ...b,
                paymentMethod: isCod ? 'COD' : 'Online',
                paymentStatus: b.paymentStatus || 'Pending',
                isCod,
                isPaid,
                paymentDisplayLabel: isCod ? "Cash on Delivery (COD)" : (isPaid ? "Paid Online" : "Online (Pending)"),
                locationDisplay,
                deliveryCharge: travelDeliveryFee,
                travelFee: travelDeliveryFee,
                totalAmount: Number(b.totalPrice || b.priceBreakdown?.totalPrice || 0)
            };
        });

        res.status(200).json({ 
            success: true, 
            count: formattedHistory.length,
            totalItems: total,
            totalPages: Math.ceil(total / limitNum),
            currentPage: pageNum,
            data: formattedHistory 
        });

    } catch (error) { 
        console.error("Get Bureau Order History Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// @desc    Track Nurse Live Progress & Active Job for Bureau Provider (Includes dailySessions)
// @route   GET /provider/nurse/dash/track/:bookingId
// @access  Private (Nurse Bureau)
const trackNurse = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const nurseId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(bookingId);
        const query = {
            nurseId,
            $or: [
                ...(isObjectId ? [{ _id: new mongoose.Types.ObjectId(bookingId) }] : []),
                { bookingId: String(bookingId).trim() }
            ]
        };

        const activeBooking = await NurseBooking.findOne(query)
            .populate('userId', 'name phone profilePic gender dob email')
            .populate('assignedStaffId', 'name phone profilePic status location vehicleNumber vehicleType')
            .populate('selectedConsumables.consumableId', 'itemName size mrp unitType')
            .populate('serviceId', 'title description procedureIncluded servicesOffered')
            .populate('packageId', 'packageName description')
            .lean();

        if (!activeBooking) {
            return res.status(404).json({ success: false, message: "Active booking record not found." });
        }

        const rawMethod = String(activeBooking.paymentMethod || '').trim().toUpperCase();
        const isCod = rawMethod === 'COD' || rawMethod.includes('CASH') || rawMethod === 'PAY ON VISIT';
        const isPaid = activeBooking.paymentStatus === 'Paid' || activeBooking.paymentStatus === 'Done';

        const travelDeliveryFee = Number(
            activeBooking.priceBreakdown?.travelFee !== undefined 
                ? activeBooking.priceBreakdown.travelFee 
                : (activeBooking.priceBreakdown?.deliveryCharge || 0)
        );

        const isHospital = activeBooking.assessmentLocation === 'At Hospital';
        let destinationLabel = "Home Address";
        if (isHospital && activeBooking.hospitalDetails) {
            destinationLabel = `${activeBooking.hospitalDetails.hospitalName || 'Hospital'} (${activeBooking.hospitalDetails.wardName || 'Ward'} - Bed: ${activeBooking.hospitalDetails.bedNumber || 'Bed'})`;
        } else if (activeBooking.address && activeBooking.address.houseNo) {
            destinationLabel = `${activeBooking.address.houseNo}, ${activeBooking.address.city || ''} - ${activeBooking.address.pincode || ''}`.replace(/^, |, $/g, '');
        }

        let staffDetails = null;
        if (activeBooking.assignedStaffId) {
            staffDetails = {
                staffId: activeBooking.assignedStaffId._id,
                staffName: activeBooking.assignedStaffId.name || "Not Available",
                staffPhone: activeBooking.assignedStaffId.phone || "Not Available",
                staffProfilePic: activeBooking.assignedStaffId.profilePic || null,
                vehicleNumber: activeBooking.assignedStaffId.vehicleNumber || null,
                vehicleType: activeBooking.assignedStaffId.vehicleType || null,
                staffStatus: activeBooking.assignedStaffId.status || "Busy",
                staffLocation: activeBooking.assignedStaffId.location || { lat: 0, lng: 0 }
            };
        }

        res.status(200).json({ 
            success: true, 
            data: {
                bookingId: activeBooking._id,
                bookingIdCustom: activeBooking.bookingId,
                bookingStatus: activeBooking.status,
                bookingType: activeBooking.bookingType || "Regular",
                
                // Payment Status
                paymentMethod: isCod ? 'COD' : 'Online',
                paymentStatus: activeBooking.paymentStatus || 'Pending',
                isCod,
                isPaid,
                paymentDisplayLabel: isCod ? "Cash on Delivery (COD)" : (isPaid ? "Paid Online" : "Online (Pending)"),

                // Venue & Locations
                assessmentLocation: activeBooking.assessmentLocation || "At Home",
                hospitalDetails: activeBooking.hospitalDetails || null,
                destinationLabel,
                address: activeBooking.address,

                // Personnel & Patients
                assignedStaff: staffDetails, 
                patientDetails: {
                    userId: activeBooking.userId ? activeBooking.userId._id : null,
                    patientName: activeBooking.userId ? activeBooking.userId.name : "Guest",
                    patientPhone: activeBooking.userId ? activeBooking.userId.phone : "N/A",
                    patientProfilePic: activeBooking.userId ? activeBooking.userId.profilePic : null,
                    patientsList: activeBooking.patients || []
                },

                // Service & Pricing
                serviceDetails: activeBooking.serviceDetails,
                priceBreakdown: {
                    ...activeBooking.priceBreakdown,
                    travelFee: travelDeliveryFee,
                    deliveryCharge: travelDeliveryFee,
                    originalTravelFee: Number(activeBooking.priceBreakdown?.originalTravelFee || travelDeliveryFee || 45)
                },
                totalPrice: Number(activeBooking.totalPrice || 0),
                schedule: activeBooking.schedule,
                selectedConsumables: activeBooking.selectedConsumables || [],

                // Attendance OTPs
                serviceOTP: activeBooking.serviceOTP,
                completionOTP: activeBooking.completionOTP,

                // 🗓️ Multi-Day Sessions Log (Day 1, Day 2 History)
                dailySessions: activeBooking.dailySessions || [],

                // Live Timeline Progress
                progress: {
                    isAssigned: activeBooking.status === 'Assigned',
                    isOnWay: activeBooking.status === 'On-The-Way',
                    isArrived: activeBooking.status === 'Arrived',
                    isStarted: activeBooking.status === 'Service-Started',
                    isCompleted: activeBooking.status === 'Completed'
                },

                startedAt: activeBooking.startedAt,
                completedAt: activeBooking.completedAt,
                serviceNotes: activeBooking.serviceNotes,
                progressPhotos: activeBooking.progressPhotos || []
            } 
        });

    } catch (error) { 
        console.error("Track Nurse Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
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