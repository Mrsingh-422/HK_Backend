// routes/admin/Ambulance/AmbulanceAdminRoute.js
const express = require('express');
const router = express.Router();
const { protect, checkRoleAccess } = require('../../../middleware/authMiddleware');
const { 
    adminGetAllAmbulances,
    adminGetApprovedAmbulances,
    adminGetAmbulanceDetails,
    adminGetAmbulanceBookings,
    adminGetBookingDetails,
    toggleActiveInactiveAmbulance,
    adminGetActiveEmergencies,
    adminReassignAmbulance,
    adminGetLiveFleetMap,
    adminDispatchEmergencyCall
} = require('../../../controllers/admin/Ambulance/AmbulanceAdmin');

// Base URL: /admin/ambulance

// 1. Fleet Management & KYC
router.get('/ambulance-lists', protect('admin'), checkRoleAccess(39), adminGetAllAmbulances); // All fleet list with filters
router.get('/approved-list', protect('admin'), checkRoleAccess(5), adminGetApprovedAmbulances); // Approved vendors only
router.get('/details/:id', protect('admin'), checkRoleAccess(39), adminGetAmbulanceDetails); // Single Ambulance KYC & Documents
router.patch('/status/active-inactive/:ambulanceId', protect('admin'), checkRoleAccess(39), toggleActiveInactiveAmbulance); // Suspend / Activate

// 2. Bookings Audit & Details
router.get('/bookings', protect('admin'), checkRoleAccess(39), adminGetAmbulanceBookings); // All bookings with filters
router.get('/booking-details/:id', protect('admin'), checkRoleAccess(39), adminGetBookingDetails); // Single booking full audit

// 3. 🚨 Command Center & SOS Dispatch Operations
router.get('/live-fleet', protect('admin'), checkRoleAccess(39), adminGetLiveFleetMap); // Live Map of all ambulances
router.get('/active-emergencies', protect('admin'), checkRoleAccess(39), adminGetActiveEmergencies); // Active cases & breakdowns
router.patch('/reassign-booking/:bookingId', protect('admin'), checkRoleAccess(39), adminReassignAmbulance); // Force Re-assignment API
router.post('/dispatch-call', protect('admin'), checkRoleAccess(39), adminDispatchEmergencyCall); // 108 Call Center Manual Dispatch

module.exports = router;