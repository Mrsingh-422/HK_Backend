const Nurse = require('../../../models/Nurse');
const NurseService = require('../../../models/NurseService');
const NurseBooking = require('../../../models/NurseBooking');
const MasterConsumable = require('../../../models/MasterConsumable');
const Driver = require('../../../models/Driver');
const moment = require('moment');

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


const updateProviderProfile = async (req, res) => {
    try {
        const updateData = req.body;
        if (req.file) updateData.profileImage = req.file.path;

        const updated = await Nurse.findByIdAndUpdate(req.user.id, { $set: updateData }, { new: true });
        res.json({ success: true, message: "Profile Updated Successfully", data: updated });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 2. SERVICE MANAGEMENT (Figma: Add/Edit Service)
// ==========================================

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
        let query = { nurseId: req.user.id };
        
        if (status) query.status = status;

        // 🚀 Priority / Faster Service filter logic
        if (isPriority === 'true') {
            query['priceBreakdown.fasterServiceCharge'] = { $gt: 0 };
        } else if (isPriority === 'false') {
            // Normal bookings where express delivery is either 0 or not applied
            query['priceBreakdown.fasterServiceCharge'] = { $eq: 0 };
        }

        const bookings = await NurseBooking.find(query).sort({ createdAt: -1 });
        res.json({ success: true, count: bookings.length, data: bookings });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const handleBookingAction = async (req, res) => {
    try {
        const { bookingId, action, reason } = req.body;
        const status = (action === 'Accept') ? 'Confirmed' : 'Cancelled';
        const booking = await NurseBooking.findOneAndUpdate(
            { _id: bookingId, nurseId: req.user.id },
            { status, rejectionReason: reason },
            { new: true }
        );
        res.json({ success: true, message: `Booking ${action}ed`, data: booking });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getAvailableStaff = async (req, res) => {
    try {
        const staff = await Driver.find({ vendorId: req.user.id, vendorType: 'Nurse', status: 'Available' });
        res.json({ success: true, data: staff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const assignStaffToBooking = async (req, res) => {
    try {
        const { bookingId, staffId } = req.body;
        await NurseBooking.findByIdAndUpdate(bookingId, { assignedStaffId: staffId, status: 'Assigned' });
        await Driver.findByIdAndUpdate(staffId, { status: 'Busy' });
        res.json({ success: true, message: "Staff Assigned Successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
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

// ==========================================
// 4. CONSUMABLES (Master List Search)
// ==========================================

const searchMasterConsumables = async (req, res) => {
    try {
        const { search } = req.query;
        let query = {};
        if (search) query.itemName = { $regex: search, $options: 'i' };
        const items = await MasterConsumable.find(query);
        res.json({ success: true, data: items });
    } catch (error) { res.status(500).json({ message: error.message }); }
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

        // Aisa order dhoondo jo active ho (On-The-Way, Arrived, etc.)
        const activeBooking = await NurseBooking.findOne({ 
            _id: bookingId, 
            nurseId 
        })
        .populate('userId', 'name phone address location')
        .populate('assignedStaffId', 'name phone profilePic status'); // Assigned Driver info

        if (!activeBooking) {
            return res.status(404).json({ success: false, message: "Active booking not found" });
        }

        // Response format for Flutter (Map View)
        res.json({ 
            success: true, 
            data: {
                bookingStatus: activeBooking.status,
                nurseDetails: activeBooking.assignedStaffId,
                userDetails: activeBooking.userId,
                address: activeBooking.address,
                // Simulation for tracking (Flutter will use lat/lng from assignedStaffId)
                progress: {
                    isOnWay: activeBooking.status === 'On-The-Way',
                    isArrived: activeBooking.status === 'Arrived',
                    isStarted: activeBooking.status === 'Service-Started'
                }
            } 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};


module.exports = { 
    getProviderDashboard, updateProviderProfile, manageNurseService, 
    getMyServices, deleteService, getBookingRequests, 
    handleBookingAction, getAvailableStaff, assignStaffToBooking, searchMasterConsumables, getStaffByStatus,
    getOrderHistory, trackNurse
};