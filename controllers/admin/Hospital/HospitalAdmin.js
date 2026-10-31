// controllers/admin/Hospital/HospitalAdmin.js
const BedRescheduleLimit = require("../../../models/BedRescheduleLimit");
const Appointment = require("../../../models/Appointment");
const Hospital = require("../../../models/Hospital");
const HospitalService = require("../../../models/HospitalService");
const Ambulance = require("../../../models/Ambulance");  
const mongoose = require("mongoose");

// 1. UPDATE GLOBAL LIMIT (patch API)
const updateHospitalRescheduleLimit = async (req, res) => {
    try {
        const { limit } = req.body; 

        if (!limit || isNaN(Number(limit))) {
            return res.status(400).json({ success: false, message: "Valid limit number is required." });
        }

        // Global check: Agar pehle se document hai toh update hoga, nahi toh create hoga
        let config = await BedRescheduleLimit.findOne();
        if (config) {
            config.maxLimit = Number(limit);
            config.updatedBy = req.user.id;
            await config.save();
        } else {
            config = await BedRescheduleLimit.create({
                maxLimit: Number(limit),
                updatedBy: req.user.id
            });
        }

        res.json({ 
            success: true, 
            message: `Global reschedule limit successfully updated to ${limit} times for all hospitals.`, 
            data: config.maxLimit 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. GET CURRENT GLOBAL LIMIT (GET API)
const getHospitalRescheduleLimit = async (req, res) => {
    try {
        const config = await BedRescheduleLimit.findOne();
        
        // Agar DB me config document pehle se na bana ho toh safely default 2 return hoga
        const currentLimit = config ? config.maxLimit : 2;

        res.json({
            success: true,
            data: {
                maxRescheduleLimit: currentLimit
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- 1. ADMIN: GET APPROVED HOSPITALS LIST (Limit: 25) ---
// Endpoint: GET /admin/hospital/approved-list?page=1
const adminGetApprovedHospitals = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 25;
        const skip = (page - 1) * limit;

        const query = { profileStatus: 'Approved' };

        const hospitals = await Hospital.find(query)
            .select('name address city state hospitalImage type profileStatus')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Hospital.countDocuments(query);

        res.json({
            success: true,
            count: hospitals.length,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            data: hospitals
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Admin: Get Hospital Bookings (With Doctor, Bed, Special Services & Insurance)
// @route   GET /admin/hospital/appointments
// @access  Private (Admin)
const adminGetHospitalBookings = async (req, res) => {
    try {
        const { tab, page = 1, status, userId, hospitalId, bookingType, search } = req.query;
        const limit = 25;
        const skip = (parseInt(page) - 1) * limit;
        
        let query = {};

        if (bookingType && bookingType !== 'All') {
            query.bookingType = bookingType;
        } else {
            query.bookingType = { $in: ['Admission', 'OPD'] };
        }

        if (userId) query.userId = userId;
        if (hospitalId) query.hospitalId = hospitalId;

        if (status && status !== 'All') {
            query.status = status;
        } else if (tab === 'Upcoming') {
            query.status = { $in: ['Confirmed', 'In-Progress'] };
        } else if (tab === 'Pending') {
            query.status = { $in: ['Pending', 'Hospital-Pending'] };
        } else if (tab === 'History') {
            query.status = { $in: ['Completed', 'Cancelled-By-User', 'Cancelled-By-Doctor', 'Cancelled-By-Hospital', 'No-Show'] };
        }

        if (search && search.trim() !== '') {
            query.$or = [
                { bookingId: { $regex: search.trim(), $options: 'i' } },
                { 'patients.patientName': { $regex: search.trim(), $options: 'i' } }
            ];
        }

        const totalCount = await Appointment.countDocuments(query);

        // 🚨 Populated Doctor, Special Services, Ambulance & Bed
        const data = await Appointment.find(query)
            .populate('userId', 'name phone email')
            .populate('hospitalId', 'name address hospitalImage city isInsuranceAccepted')
            .populate('doctorId', 'name speciality profileImage department fees qualification phone')
            .populate({
                path: 'bedId',
                select: 'bedNumber status pricePerDay isVentilatorAvailable wardId',
                populate: { path: 'wardId', select: 'name type' }
            })
            .populate('ambulanceId', 'name vehicleNumber vehicleType phone')
            .populate('specialServices.serviceId', 'serviceName price image description')
            .sort(bookingType === 'OPD' ? { tokenNumber: 1, createdAt: -1 } : { createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const formatted = data.map(item => {
            const formattedServices = (item.specialServices || []).map(srv => ({
                serviceId: srv.serviceId?._id || srv.serviceId || null,
                serviceName: srv.serviceId?.serviceName || srv.serviceName || "Special Service",
                price: Number(srv.price || srv.serviceId?.price || 0)
            }));

            return {
                ...item,
                isOpd: item.bookingType === 'OPD',
                isIpd: item.bookingType === 'Admission',
                doctor: item.doctorId ? {
                    _id: item.doctorId._id,
                    name: item.doctorId.name,
                    speciality: item.doctorId.speciality,
                    department: item.doctorId.department?.roomNumber || "Cabin",
                    profileImage: item.doctorId.profileImage || null
                } : null,
                specialServices: formattedServices,
                totalSpecialServicesCharges: formattedServices.reduce((sum, s) => sum + s.price, 0),
                displaySubtitle: item.bookingType === 'OPD' 
                    ? `OPD Token #${item.tokenNumber || '1'} - Dr. ${item.doctorId?.name || 'Doctor'}`
                    : `Bed: ${item.bedNumber || 'Unassigned'} (${item.wardName || 'Ward'})`,
                hasInsurance: Boolean(item.insuranceDetails?.hasInsurance),
                insuranceClaimStatus: item.insuranceDetails?.hasInsurance 
                    ? (item.insuranceDetails?.approvalStatus || 'Pending') 
                    : 'Self-Pay (No Insurance)'
            };
        });

        return res.status(200).json({ 
            success: true, 
            count: formatted.length, 
            pagination: {
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
                currentPage: parseInt(page),
                limit
            },
            data: formatted 
        });
    } catch (error) { 
        console.error("Admin Get Hospital Bookings Error:", error);
        return res.status(500).json({ success: false, message: error.message }); 
    }
};
const toggleStatusActiveInactive = async (req, res) => {
    try {
        const { hospitalId } = req.params;
        const hospital = await Hospital.findById(hospitalId);
 
        if (!hospital) {
            return res.status(404).json({ success: false, message: "Hospital not found." });
        }
 
        hospital.isActive = !hospital.isActive;
        await hospital.save();
 
        return res.json({
            success: true,
            message: `Hospital status updated to ${hospital.isActive ? 'Active' : 'Inactive'}.`,
            data: { hospitalId: hospital._id,
                   isActive: hospital.isActive
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }  
};
 

module.exports = { 
    updateHospitalRescheduleLimit, 
    getHospitalRescheduleLimit ,
    adminGetApprovedHospitals,
    adminGetHospitalBookings,
    toggleStatusActiveInactive
};