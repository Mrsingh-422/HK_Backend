// controllers/admin/Dashboard/Dashboard.js

const LabBooking = require('../../../models/LabBooking');
const PharmacyBooking = require('../../../models/PharmacyBooking');
const NurseBooking = require('../../../models/NurseBooking');
const Appointment = require('../../../models/Appointment'); // Hospital bookings
const AmbulanceBooking = require('../../../models/AmbulanceBooking');
const mongoose = require('mongoose');

// --- 1. GET DASHBOARD CARDS SUMMARY STATS ---
// Endpoint: GET /admin/dashboard/order-stats
const getDashboardOrderStats = async (req, res) => {
    try {
        // Parallel queries to fetch counts for better performance
        const [
            // Lab Counts
            labPending, labCompleted, labCancelled,
            // Pharmacy Counts
            pharmacyPending, pharmacyCompleted, pharmacyCancelled,
            // Nurse Counts
            nursePending, nurseCompleted, nurseCancelled,
            // Hospital (Appointment/Admission) Counts
            hospitalPending, hospitalCompleted, hospitalCancelled,
            // Ambulance Counts
            ambulancePending, ambulanceCompleted, ambulanceCancelled
        ] = await Promise.all([
            // Labs status mapping
            LabBooking.countDocuments({ status: { $nin: ['Completed', 'Cancelled'] } }),
            LabBooking.countDocuments({ status: 'Completed' }),
            LabBooking.countDocuments({ status: 'Cancelled' }),

            // Pharmacy status mapping
            PharmacyBooking.countDocuments({ status: { $nin: ['Delivered', 'Cancelled'] } }),
            PharmacyBooking.countDocuments({ status: 'Delivered' }),
            PharmacyBooking.countDocuments({ status: 'Cancelled' }),

            // Nurse status mapping
            NurseBooking.countDocuments({ status: { $nin: ['Completed', 'Cancelled'] } }),
            NurseBooking.countDocuments({ status: 'Completed' }),
            NurseBooking.countDocuments({ status: 'Cancelled' }),

            // Hospital status mapping
            Appointment.countDocuments({ status: { $nin: ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital'] } }),
            Appointment.countDocuments({ status: 'Completed' }),
            Appointment.countDocuments({ status: { $in: ['Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital'] } }),

            // Ambulance status mapping
            AmbulanceBooking.countDocuments({ status: { $nin: ['Delivered', 'Cancelled'] } }),
            AmbulanceBooking.countDocuments({ status: 'Delivered' }),
            AmbulanceBooking.countDocuments({ status: 'Cancelled' })
        ]);

        res.json({
            success: true,
            data: {
                lab: { pending: labPending, completed: labCompleted, cancelled: labCancelled },
                pharmacy: { pending: pharmacyPending, completed: pharmacyCompleted, cancelled: pharmacyCancelled },
                nurse: { pending: nursePending, completed: nurseCompleted, cancelled: nurseCancelled },
                hospital: { pending: hospitalPending, completed: hospitalCompleted, cancelled: hospitalCancelled },
                ambulance: { pending: ambulancePending, completed: ambulanceCompleted, cancelled: ambulanceCancelled }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 2. GET LIVE ORDERS FEED (Combined & Sorted Tunnels) ---
// Endpoint: GET /admin/dashboard/live-feed?page=1&limit=10
const getLiveOrdersFeed = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 25;
        const skip = (page - 1) * limit;

        // Fetching latest 50 items from each category to perform in-memory sort for live feed
        const [labs, pharmacies, nurses, hospitals, ambulances] = await Promise.all([
            LabBooking.find().populate('userId', 'name').sort({ createdAt: -1 }).limit(50).lean(),
            PharmacyBooking.find().populate('userId', 'name').sort({ createdAt: -1 }).limit(50).lean(),
            NurseBooking.find().populate('userId', 'name').sort({ createdAt: -1 }).limit(50).lean(),
            Appointment.find().populate('userId', 'name').sort({ createdAt: -1 }).limit(50).lean(),
            AmbulanceBooking.find().populate('userId', 'name').sort({ createdAt: -1 }).limit(50).lean()
        ]);

        // Map and unify data structure for Feed Table
        const mappedLabs = labs.map(item => ({
            id: item._id,
            orderId: item.bookingId || "N/A",
            vendor: 'Lab',
            customer: item.userId?.name || 'Guest User',
            service: item.items?.tests?.[0]?.name || item.items?.packages?.[0]?.name || 'Lab Test',
            status: item.status,
            amount: item.billSummary?.totalAmount || 0,
            createdAt: item.createdAt
        }));

        const mappedPharmacies = pharmacies.map(item => ({
            id: item._id,
            orderId: item.orderId || "N/A",
            vendor: 'Pharmacy',
            customer: item.userId?.name || 'Guest User',
            service: item.items?.[0]?.name || 'Medicine Delivery',
            status: item.status,
            amount: item.billSummary?.totalAmount || 0,
            createdAt: item.createdAt
        }));

        const mappedNurses = nurses.map(item => ({
            id: item._id,
            orderId: item.bookingId || "N/A",
            vendor: 'Nurse',
            customer: item.userId?.name || 'Guest User',
            service: item.serviceDetails?.title || 'Nurse Care',
            status: item.status,
            amount: item.totalPrice || 0,
            createdAt: item.createdAt
        }));

        const mappedHospitals = hospitals.map(item => ({
            id: item._id,
            orderId: item.bookingId || "N/A",
            vendor: 'Hospital',
            customer: item.userId?.name || 'Guest User',
            service: item.bookingType === 'Admission' ? 'IPD Booking' : 'Doctor Appointment',
            status: item.status,
            amount: item.totalAmount || 0,
            createdAt: item.createdAt
        }));

        const mappedAmbulances = ambulances.map(item => ({
            id: item._id,
            orderId: item.bookingId || "N/A",
            vendor: 'Ambulance',
            customer: item.userId?.name || 'Guest User',
            service: item.serviceType || 'Emergency Service',
            status: item.status,
            amount: item.pricing?.total || 0,
            createdAt: item.createdAt
        }));

        // Combine arrays and sort chronologically (Latest first)
        let combinedFeed = [
            ...mappedLabs,
            ...mappedPharmacies,
            ...mappedNurses,
            ...mappedHospitals,
            ...mappedAmbulances
        ];

        combinedFeed.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Get absolute total order count across database
        const [totalLabs, totalPharmacies, totalNurses, totalHospitals, totalAmbulances] = await Promise.all([
            LabBooking.countDocuments(),
            PharmacyBooking.countDocuments(),
            NurseBooking.countDocuments(),
            Appointment.countDocuments(),
            AmbulanceBooking.countDocuments()
        ]);
        const totalOrders = totalLabs + totalPharmacies + totalNurses + totalHospitals + totalAmbulances;

        // Paginate local combined feed
        const paginatedFeed = combinedFeed.slice(skip, skip + limit);

        res.json({
            success: true,
            totalOrders, // Total order count for badge (e.g. "Total 7 Orders")
            totalPages: Math.ceil(combinedFeed.length / limit),
            currentPage: page,
            data: paginatedFeed
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 3. DYNAMIC FULL DETAIL API FOR ANY ORDER ---
// Endpoint: GET /admin/dashboard/order-details/:vendor/:id
// --- 3. UPDATED FULL DETAIL API (No Vendor Required) ---
// Endpoint: GET /admin/dashboard/order-details/:id
const getOrderDetail = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ success: false, message: "Order/Booking ID is required." });
        }

        // Dynamic Query Builder: 
        // Agar passed string MongoDB ki valid ObjectId hai, toh hum '_id' se search karenge.
        // Agar direct string ID (jaise 'ORD-001') hai, toh bookingId/orderId fields par query karenge.
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

        // Detect which collection returned the data and assign vendor
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
            detectedVendor = 'Hospital';
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
            vendor: detectedVendor, // 👈 Frontend ko pata chalega ki kis vendor ka order hai
            data: detail
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
module.exports = {
    getDashboardOrderStats,
    getLiveOrdersFeed,
    getOrderDetail
};