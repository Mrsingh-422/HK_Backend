const Nurse = require('../../../models/Nurse');
const NurseBooking = require('../../../models/NurseBooking');
const NurseService = require('../../../models/NurseService');
const NursePackage = require('../../../models/NursePackage');

// --- 1. ADMIN: GET APPROVED NURSES LIST (Limit: 25) ---
// Endpoint: GET /admin/nurse/approved-list?page=1
const adminGetApprovedNurses = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25;
        const skip = (page - 1) * limit;

        const query = { profileStatus: 'Approved' };

        const nurses = await Nurse.find(query)
            .select('name email phone speciality profileImage profileStatus')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Nurse.countDocuments(query);

        res.json({
            success: true,
            count: nurses.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: nurses
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Admin: Get Nurse Bookings with Complete Logistics, Staff & Venue Audit
// @route   GET /admin/nurse/bookings
// @access  Private (Admin)
const adminGetNurseBookings = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25;
        const skip = (page - 1) * limit;
        const { status, userId, nurseId, search } = req.query;

        const query = {};
        if (status && status !== 'All') query.status = status;
        if (userId) query.userId = userId;
        if (nurseId) query.nurseId = nurseId;

        if (search && search.trim() !== '') {
            query.$or = [
                { bookingId: { $regex: search.trim(), $options: 'i' } },
                { 'address.phone': { $regex: search.trim(), $options: 'i' } },
                { 'patients.name': { $regex: search.trim(), $options: 'i' } }
            ];
        }

        const total = await NurseBooking.countDocuments(query);

        const bookings = await NurseBooking.find(query)
            .populate('userId', 'name phone email profilePic')
            .populate('nurseId', 'name profileImage speciality phone email city')
            .populate('assignedStaffId', 'name phone vehicleNumber vehicleType status location profilePic')
            .populate('serviceId', 'title description procedureIncluded servicesOffered')
            .populate('packageId', 'packageName description')
            .populate('selectedConsumables.consumableId', 'itemName size mrp unitType')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        // Enriched Admin Response
        const formattedData = bookings.map(b => {
            const rawMethod = String(b.paymentMethod || '').trim().toUpperCase();
            const isCod = rawMethod === 'COD' || rawMethod.includes('CASH') || rawMethod === 'PAY ON VISIT';
            const isHospital = b.assessmentLocation === 'At Hospital';

            return {
                ...b,
                paymentMethod: isCod ? 'COD' : 'Online',
                paymentStatus: b.paymentStatus || 'Pending',
                isCod,
                isPaid: b.paymentStatus === 'Paid' || b.paymentStatus === 'Done',
                assessmentLocation: b.assessmentLocation || 'At Home',
                hospitalDetails: isHospital ? b.hospitalDetails : null,
                completedSessionsCount: Array.isArray(b.dailySessions) ? b.dailySessions.length : 0,
                assignedStaff: b.assignedStaffId ? {
                    name: b.assignedStaffId.name,
                    phone: b.assignedStaffId.phone,
                    vehicleNumber: b.assignedStaffId.vehicleNumber,
                    status: b.assignedStaffId.status
                } : null
            };
        });

        res.status(200).json({ 
            success: true, 
            count: formattedData.length, 
            totalItems: total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: formattedData 
        });
    } catch (error) { 
        console.error("Admin Get Nurse Bookings Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// --- 3. ADMIN: TOGGLE NURSE ACTIVE/INACTIVE STATUS ---
// Endpoint: PATCH /admin/nurse/status/:nurseId
const toggleActiveInactiveNurse = async (req, res) => {
    try {
        const { nurseId } = req.params;
        const nurse = await Nurse.findById(nurseId);
 
        if (!nurse) {
            return res.status(404).json({ success: false, message: "Nurse not found." });
        }
 
        nurse.isActive = !nurse.isActive;
        await nurse.save();
 
        return res.json({
            success: true,
            message: `Nurse status updated to ${nurse.isActive ? 'Active' : 'Inactive'}.`,
            data: { nurseId: nurse._id,
                   isActive: nurse.isActive
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }  
};
 

// =========================================================================
// 4. ADMIN: GET ALL NURSE SERVICES (Daily Care & Package Types)
// =========================================================================
// Endpoint: GET /admin/nurse/services?page=1&limit=25&type=Daily Care&status=Approved
const adminGetNurseServices = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const skip = (page - 1) * limit;
        const { status, type, nurseId, search } = req.query;

        const query = {};
        if (status && status !== 'All') query.status = status; // 'Approved', 'Pending', 'Rejected'
        if (type && type !== 'All') query.type = type;         // 'Daily Care' or 'Package'
        if (nurseId) query.nurseId = nurseId;
        if (search && search.trim() !== '') {
            query.title = { $regex: search.trim(), $options: 'i' };
        }

        const total = await NurseService.countDocuments(query);

        const services = await NurseService.find(query)
            .populate('nurseId', 'name profileImage email phone city speciality profileStatus isActive')
            .populate('careSubCategoryId', 'category subCategory description')
            .populate('consumablesUsed.masterItemId', 'itemName size mrp unitType')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        res.json({
            success: true,
            count: services.length,
            totalItems: total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: services
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 5. ADMIN: GET ALL NURSE PACKAGES (Standalone Bundle Packages)
// =========================================================================
// Endpoint: GET /admin/nurse/packages?page=1&limit=25&status=Approved
const adminGetNursePackages = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const skip = (page - 1) * limit;
        const { status, nurseId, isActive, search } = req.query;

        const query = {};
        if (status && status !== 'All') query.status = status; // 'Approved', 'Pending', 'Rejected'
        if (nurseId) query.nurseId = nurseId;
        if (isActive !== undefined && isActive !== 'All') {
            query.isActive = (isActive === 'true' || isActive === true);
        }
        if (search && search.trim() !== '') {
            query.packageName = { $regex: search.trim(), $options: 'i' };
        }

        const total = await NursePackage.countDocuments(query);

        const packages = await NursePackage.find(query)
            .populate('nurseId', 'name profileImage email phone city speciality profileStatus isActive')
            .populate('includedServices', 'category subCategory description procedureIncluded servicesOffered')
            .populate('consumablesUsed.masterItemId', 'itemName size mrp unitType')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        res.json({
            success: true,
            count: packages.length,
            totalItems: total,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: packages
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 6. ADMIN: APPROVE / REJECT NURSE SERVICE
// =========================================================================
// Endpoint: PATCH /admin/nurse/services/status/:id
const adminUpdateNurseServiceStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, rejectionReason } = req.body;

        if (!['Approved', 'Rejected', 'Pending'].includes(status)) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid status. Allowed values: 'Approved', 'Rejected', 'Pending'." 
            });
        }

        const updatedService = await NurseService.findByIdAndUpdate(
            id,
            { 
                $set: { 
                    status, 
                    rejectionReason: status === 'Rejected' ? (rejectionReason || "Rejected by Admin") : null 
                } 
            },
            { new: true }
        ).populate('nurseId', 'name email phone');

        if (!updatedService) {
            return res.status(404).json({ success: false, message: "Nurse service not found." });
        }

        res.json({
            success: true,
            message: `Nurse service status updated to ${status}.`,
            data: updatedService
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =========================================================================
// 7. ADMIN: APPROVE / REJECT / TOGGLE NURSE PACKAGE
// =========================================================================
// Endpoint: PATCH /admin/nurse/packages/status/:id
const adminUpdateNursePackageStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, isActive } = req.body;

        const updateData = {};
        if (status) updateData.status = status;
        if (isActive !== undefined) updateData.isActive = (isActive === 'true' || isActive === true);

        const updatedPackage = await NursePackage.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true }
        ).populate('nurseId', 'name email phone');

        if (!updatedPackage) {
            return res.status(404).json({ success: false, message: "Nurse package not found." });
        }

        res.json({
            success: true,
            message: "Nurse package updated successfully.",
            data: updatedPackage
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {adminGetApprovedNurses, adminGetNurseBookings , toggleActiveInactiveNurse, adminUpdateNurseServiceStatus, adminUpdateNursePackageStatus,
    adminGetNursePackages, adminGetNurseServices
};