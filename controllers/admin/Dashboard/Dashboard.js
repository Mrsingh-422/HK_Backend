// controllers/admin/Dashboard/Dashboard.js

const LabBooking = require('../../../models/LabBooking');
const PharmacyBooking = require('../../../models/PharmacyBooking');
const NurseBooking = require('../../../models/NurseBooking');
const Appointment = require('../../../models/Appointment'); // Doctor Appointments & Hospital bed admissions
const AmbulanceBooking = require('../../../models/AmbulanceBooking');

const Doctor = require('../../../models/Doctor');
const Hospital = require('../../../models/Hospital');
const Lab = require('../../../models/Lab');
const Pharmacy = require('../../../models/Pharmacy');
const Nurse = require('../../../models/Nurse');
const Ambulance = require('../../../models/Ambulance');

const mongoose = require('mongoose');

// @desc    Admin Dashboard Counters (Accurate status grouping excluding No-Show from active pending)
// @route   GET /admin/dashboard/order-stats
// @access  Private (Admin)
const getDashboardOrderStats = async (req, res) => {
    try {
        const [
            labPending, labCompleted, labCancelled,
            pharmacyPending, pharmacyCompleted, pharmacyCancelled,
            nursePending, nurseCompleted, nurseCancelled,
            hospitalPending, hospitalCompleted, hospitalCancelled,
            doctorPending, doctorCompleted, doctorCancelled,
            ambulancePending, ambulanceCompleted, ambulanceCancelled
        ] = await Promise.all([
            LabBooking.countDocuments({ status: { $nin: ['Completed', 'Cancelled', 'No-Show'] } }),
            LabBooking.countDocuments({ status: 'Completed' }),
            LabBooking.countDocuments({ status: { $in: ['Cancelled', 'No-Show'] } }),

            PharmacyBooking.countDocuments({ status: { $nin: ['Delivered', 'Cancelled', 'No-Show'] } }),
            PharmacyBooking.countDocuments({ status: 'Delivered' }),
            PharmacyBooking.countDocuments({ status: { $in: ['Cancelled', 'No-Show'] } }),

            NurseBooking.countDocuments({ status: { $nin: ['Completed', 'Cancelled', 'No-Show'] } }),
            NurseBooking.countDocuments({ status: 'Completed' }),
            NurseBooking.countDocuments({ status: { $in: ['Cancelled', 'No-Show'] } }),

            Appointment.countDocuments({ 
                bookingType: { $in: ['Admission', 'OPD'] }, 
                status: { $nin: ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital', 'No-Show'] } 
            }),
            Appointment.countDocuments({ 
                bookingType: { $in: ['Admission', 'OPD'] }, 
                status: 'Completed' 
            }),
            Appointment.countDocuments({ 
                bookingType: { $in: ['Admission', 'OPD'] }, 
                status: { $in: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital', 'No-Show'] } 
            }),

            Appointment.countDocuments({ 
                bookingType: 'Appointment', 
                status: { $nin: ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'No-Show'] } 
            }),
            Appointment.countDocuments({ 
                bookingType: 'Appointment', 
                status: 'Completed' 
            }),
            Appointment.countDocuments({ 
                bookingType: 'Appointment', 
                status: { $in: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'No-Show'] } 
            }),

            AmbulanceBooking.countDocuments({ status: { $nin: ['Delivered', 'Cancelled'] } }),
            AmbulanceBooking.countDocuments({ status: 'Delivered' }),
            AmbulanceBooking.countDocuments({ status: 'Cancelled' })
        ]);

        res.status(200).json({
            success: true,
            data: {
                lab: { pending: labPending, completed: labCompleted, cancelled: labCancelled },
                pharmacy: { pending: pharmacyPending, completed: pharmacyCompleted, cancelled: pharmacyCancelled },
                nurse: { pending: nursePending, completed: nurseCompleted, cancelled: nurseCancelled },
                hospital: { pending: hospitalPending, completed: hospitalCompleted, cancelled: hospitalCancelled },
                doctor: { pending: doctorPending, completed: doctorCompleted, cancelled: doctorCancelled },
                ambulance: { pending: ambulancePending, completed: ambulanceCompleted, cancelled: ambulanceCancelled }
            }
        });
    } catch (error) {
        console.error("Get Dashboard Order Stats Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Admin Dashboard Live Orders Feed (Includes both OPD & Admission for Hospital Filter)
// @route   GET /admin/dashboard/live-feed
// @access  Private (Admin)
const getLiveOrdersFeed = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const skip = (page - 1) * limit;
        const { vendor, timeRange } = req.query;

        let dateFilter = null;
        if (timeRange) {
            const now = new Date();
            const cleanRange = timeRange.trim().toLowerCase();
            if (cleanRange === '6h') dateFilter = new Date(now.getTime() - 6 * 60 * 60 * 1000);
            else if (cleanRange === '12h') dateFilter = new Date(now.getTime() - 12 * 60 * 60 * 1000);
            else if (cleanRange === '24h') dateFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            else if (cleanRange === '7d') dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            else if (cleanRange === '30d') dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }

        const query = {};
        if (dateFilter) query.createdAt = { $gte: dateFilter };

        let combinedFeed = [];
        let totalOrders = 0;

        if (vendor) {
            const cleanVendor = vendor.trim().toLowerCase();

            if (cleanVendor === 'hospital') {
                // Includes BOTH Admission and OPD for Hospital
                const hospQuery = { bookingType: { $in: ['Admission', 'OPD'] }, ...query };
                const hospitalBookings = await Appointment.find(hospQuery)
                    .populate('userId', 'name')
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean();

                totalOrders = await Appointment.countDocuments(hospQuery);

                combinedFeed = hospitalBookings.map(item => ({
                    id: item._id,
                    orderId: item.bookingId || "N/A",
                    vendor: 'Hospital',
                    customer: item.userId?.name || 'Guest User',
                    service: item.bookingType === 'OPD' ? `OPD (Token #${item.tokenNumber || '1'})` : 'IPD Bed Admission',
                    status: item.status,
                    amount: item.totalAmount || 0,
                    createdAt: item.createdAt
                }));

            } else if (cleanVendor === 'doctor') {
                const docQuery = { bookingType: 'Appointment', ...query };
                const appointments = await Appointment.find(docQuery)
                    .populate('userId', 'name')
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean();

                totalOrders = await Appointment.countDocuments(docQuery);

                combinedFeed = appointments.map(item => ({
                    id: item._id,
                    orderId: item.bookingId || "N/A",
                    vendor: 'Doctor',
                    customer: item.userId?.name || 'Guest User',
                    service: 'Clinic Consultation',
                    status: item.status,
                    amount: item.totalAmount || 0,
                    createdAt: item.createdAt
                }));

            } else if (cleanVendor === 'lab') {
                const labs = await LabBooking.find(query).populate('userId', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
                totalOrders = await LabBooking.countDocuments(query);
                combinedFeed = labs.map(item => ({
                    id: item._id, orderId: item.bookingId || "N/A", vendor: 'Lab', customer: item.userId?.name || 'Guest User',
                    service: item.items?.tests?.[0]?.name || item.items?.packages?.[0]?.name || 'Lab Test', status: item.status,
                    amount: item.billSummary?.totalAmount || 0, createdAt: item.createdAt
                }));

            } else if (cleanVendor === 'pharmacy') {
                const pharmacies = await PharmacyBooking.find(query).populate('userId', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
                totalOrders = await PharmacyBooking.countDocuments(query);
                combinedFeed = pharmacies.map(item => ({
                    id: item._id, orderId: item.orderId || "N/A", vendor: 'Pharmacy', customer: item.userId?.name || 'Guest User',
                    service: item.items?.[0]?.name || 'Medicine Delivery', status: item.status,
                    amount: item.billSummary?.totalAmount || 0, createdAt: item.createdAt
                }));

            } else if (cleanVendor === 'nurse') {
                const nurses = await NurseBooking.find(query).populate('userId', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
                totalOrders = await NurseBooking.countDocuments(query);
                combinedFeed = nurses.map(item => ({
                    id: item._id, orderId: item.bookingId || "N/A", vendor: 'Nurse', customer: item.userId?.name || 'Guest User',
                    service: item.serviceDetails?.title || 'Nurse Care', status: item.status,
                    amount: item.totalPrice || 0, createdAt: item.createdAt
                }));

            } else if (cleanVendor === 'ambulance') {
                const ambulances = await AmbulanceBooking.find(query).populate('userId', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
                totalOrders = await AmbulanceBooking.countDocuments(query);
                combinedFeed = ambulances.map(item => ({
                    id: item._id, orderId: item.bookingId || "N/A", vendor: 'Ambulance', customer: item.userId?.name || 'Guest User',
                    service: item.serviceType || 'Emergency Service', status: item.status,
                    amount: item.pricing?.total || 0, createdAt: item.createdAt
                }));
            }

        } else {
            // All Vendors combined feed
            const [labs, pharmacies, nurses, hospitalAndDoc, ambulances] = await Promise.all([
                LabBooking.find(query).populate('userId', 'name').sort({ createdAt: -1 }).limit(50).lean(),
                PharmacyBooking.find(query).populate('userId', 'name').sort({ createdAt: -1 }).limit(50).lean(),
                NurseBooking.find(query).populate('userId', 'name').sort({ createdAt: -1 }).limit(50).lean(),
                Appointment.find(query).populate('userId', 'name').sort({ createdAt: -1 }).limit(50).lean(),
                AmbulanceBooking.find(query).populate('userId', 'name').sort({ createdAt: -1 }).limit(50).lean()
            ]);

            const mappedAppointments = hospitalAndDoc.map(item => ({
                id: item._id,
                orderId: item.bookingId || "N/A",
                vendor: item.bookingType === 'Admission' || item.bookingType === 'OPD' ? 'Hospital' : 'Doctor',
                customer: item.userId?.name || 'Guest User',
                service: item.bookingType === 'OPD' ? `Hospital OPD (Token #${item.tokenNumber || '1'})` : (item.bookingType === 'Admission' ? 'IPD Bed Admission' : 'Clinic Appointment'),
                status: item.status,
                amount: item.totalAmount || 0,
                createdAt: item.createdAt
            }));

            combinedFeed = [
                ...labs.map(i => ({ id: i._id, orderId: i.bookingId || "N/A", vendor: 'Lab', customer: i.userId?.name || 'Guest User', service: 'Lab Test', status: i.status, amount: i.billSummary?.totalAmount || 0, createdAt: i.createdAt })),
                ...pharmacies.map(i => ({ id: i._id, orderId: i.orderId || "N/A", vendor: 'Pharmacy', customer: i.userId?.name || 'Guest User', service: 'Medicine Order', status: i.status, amount: i.billSummary?.totalAmount || 0, createdAt: i.createdAt })),
                ...nurses.map(i => ({ id: i._id, orderId: i.bookingId || "N/A", vendor: 'Nurse', customer: i.userId?.name || 'Guest User', service: i.serviceDetails?.title || 'Nurse Care', status: i.status, amount: i.totalPrice || 0, createdAt: i.createdAt })),
                ...mappedAppointments,
                ...ambulances.map(i => ({ id: i._id, orderId: i.bookingId || "N/A", vendor: 'Ambulance', customer: i.userId?.name || 'Guest User', service: i.serviceType || 'Ambulance Ride', status: i.status, amount: i.pricing?.total || 0, createdAt: i.createdAt }))
            ];

            combinedFeed.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            totalOrders = combinedFeed.length;
            combinedFeed = combinedFeed.slice(skip, skip + limit);
        }

        res.status(200).json({
            success: true,
            totalOrders,
            totalPages: Math.ceil(totalOrders / limit),
            currentPage: page,
            data: combinedFeed
        });

    } catch (error) {
        console.error("Get Live Orders Feed Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. UPDATED FULL DETAIL API (No Vendor Required) ---
// Endpoint: GET /admin/dashboard/order-details/:id
const getOrderDetail = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ success: false, message: "Order/Booking ID is required." });
        }

        let query = {};
        if (mongoose.Types.ObjectId.isValid(id)) {
            query._id = id;
        } else {
            query.$or = [{ bookingId: id }, { orderId: id }, { caseReference: id }];
        }

        // Parallel lookups across all models
        const [lab, pharmacy, nurse, hospital, ambulance] = await Promise.all([
            LabBooking.findOne(query)
                .populate('userId', 'name phone email')
                .populate('labId', 'name city state address profileImage is24x7')
                .populate('phlebotomistId', 'name phone vehicleNumber')
                .populate('prescriptionId'),
            PharmacyBooking.findOne(query)
                .populate('userId', 'name phone email')
                .populate('pharmacyId', 'name profileImage city address phone')
                .populate('items.medicineId', 'name manufacturers packaging mrp image_url')
                .populate('driverId', 'name phone vehicleNumber'),
            NurseBooking.findOne(query)
                .populate('userId', 'name phone email')
                .populate('nurseId', 'name profileImage speciality experienceYears phone')
                .populate('assignedStaffId', 'name phone vehicleNumber')
                .populate('selectedConsumables.consumableId'),
            Appointment.findOne(query)
                .populate('userId', 'name phone email')
                .populate('hospitalId', 'name address city state hospitalImage type')
                .populate('doctorId', 'name speciality profileImage fees consultationStatus')
                .populate({
                    path: 'bedId',
                    select: 'bedNumber status pricePerDay isVentilatorAvailable wardId',
                    populate: {
                        path: 'wardId',
                        select: 'name type description'
                    }
                }),
            AmbulanceBooking.findOne(query)
                .populate('userId', 'name phone email')
                .populate('ambulanceId', 'name vehicleNumber vehicleType phone driverInfo')
                .populate('hospitalId', 'name address city state')
                .populate('pickupHospitalId', 'name address city state')
        ]);

        let detail = null;
        let detectedVendor = null;

        if (lab) {
            detail = lab;
            detectedVendor = 'Lab';
        } else if (pharmacy) {
            detail = pharmacy;
            detectedVendor = 'Pharmacy';
        } else if (nurse) {
            detail = nurse;
            detectedVendor = 'Nurse';
        } else if (hospital) {
            detail = hospital;
            // Split detail vendor dynamic labels
            detectedVendor = hospital.bookingType === 'Admission' ? 'Hospital' : 'Doctor';
        } else if (ambulance) {
            detail = ambulance;
            detectedVendor = 'Ambulance';
        }

        if (!detail) {
            return res.status(404).json({ 
                success: false, 
                message: "No order/booking found with the provided ID across any category." 
            });
        }

        res.json({
            success: true,
            vendor: detectedVendor,
            data: detail
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- HELPER FUNCTION: OPTIMIZED MONGOOSE AGGREGATION STATUS COUNTER ---
const getModelStatusCounts = async (Model) => {
    const stats = await Model.aggregate([
        {
            $group: {
                _id: "$profileStatus",
                count: { $sum: 1 }
            }
        }
    ]);

    const formattedStats = {
        total: 0,
        approved: 0,
        rejected: 0,
        pending: 0,
        incomplete: 0
    };

    stats.forEach(item => {
        const status = item._id ? item._id.toLowerCase() : 'incomplete';
        if (status === 'approved') formattedStats.approved = item.count;
        else if (status === 'rejected') formattedStats.rejected = item.count;
        else if (status === 'pending') formattedStats.pending = item.count;
        else if (status === 'incomplete') formattedStats.incomplete = item.count;
        
        formattedStats.total += item.count;
    });

    return formattedStats;
};

// --- GET ADMIN DASHBOARD VENDOR STATUS STATS ---
const getAdminDashboardStats = async (req, res) => {
    try {
        const [
            doctors,
            hospitals,
            labs,
            pharmacies,
            nurses,
            ambulances
        ] = await Promise.all([
            getModelStatusCounts(Doctor),
            getModelStatusCounts(Hospital),
            getModelStatusCounts(Lab),
            getModelStatusCounts(Pharmacy),
            getModelStatusCounts(Nurse),
            getModelStatusCounts(Ambulance)
        ]);

        res.json({
            success: true,
            message: "Dashboard vendor stats fetched successfully.",
            data: {
                doctors,
                hospitals,
                labs,
                pharmacies,
                nurses,
                ambulances
            }
        });

    } catch (error) {
        console.error("Dashboard Stats Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getDashboardOrderStats,
    getLiveOrdersFeed,
    getOrderDetail,
    getAdminDashboardStats
};