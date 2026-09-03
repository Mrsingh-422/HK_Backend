// controllers/admin/AdminWallet.js
const WithdrawalRequest = require('../../models/WithdrawalRequest');
const Wallet = require('../../models/Wallet');
const moment = require('moment');
const mongoose = require('mongoose');
const Doctor = require('../../models/Doctor');
const Hospital = require('../../models/Hospital');
const Lab = require('../../models/Lab');
const Pharmacy = require('../../models/Pharmacy');
const Nurse = require('../../models/Nurse');
const Ambulance = require('../../models/Ambulance');
const { calculateAdminCommission } = require('../../utils/policyHelper');
const Appointment = require('../../models/Appointment');
const LabBooking = require('../../models/LabBooking');
const PharmacyBooking = require('../../models/PharmacyBooking');
const NurseBooking = require('../../models/NurseBooking');
const AmbulanceBooking = require('../../models/AmbulanceBooking');

// 1. GET ALL PENDING WITHDRAWALS (Admin dashboard lists all doctors, labs, nurses requests) - [1.2.2]
const getPendingWithdrawals = async (req, res) => {
    try {
        const list = await WithdrawalRequest.find({ status: 'Pending' })
            .populate({
                path: 'vendorId',
                select: 'name email phone speciality licenseNumber' // Polymorphic auto-lookup
            })
            .sort({ createdAt: -1 });

        res.json({ success: true, count: list.length, data: list });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. APPROVE WITHDRAWAL (Using manual payment UTR/Reference ID)
const approveWithdrawal = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { transactionReference } = req.body; 

        if (!transactionReference) {
            return res.status(400).json({ success: false, message: "Manual payout UTR reference code is mandatory." });
        }

        const request = await WithdrawalRequest.findById(requestId);
        if (!request || request.status !== 'Pending') {
            return res.status(404).json({ success: false, message: "Active pending withdrawal request not found." });
        }

        request.status = 'Approved';
        request.transactionReference = transactionReference;
        request.approvedAt = new Date();
        await request.save();

        // Finalize transaction details in the vendor's wallet
        const wallet = await Wallet.findOne({ vendorId: request.vendorId, vendorModel: request.vendorModel });
        if (wallet) {
            const lastTransaction = wallet.transactions[wallet.transactions.length - 1];
            if (lastTransaction && lastTransaction.type === 'Debit') {
                lastTransaction.remark = `Withdrawal Approved (UTR Ref: ${transactionReference})`;
            }
            await wallet.save();
        }

        res.json({ success: true, message: "Withdrawal approved successfully.", data: request });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. REJECT WITHDRAWAL (Refunds the locked balance back to vendor)
const rejectWithdrawal = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { reason } = req.body; 

        const request = await WithdrawalRequest.findById(requestId);
        if (!request || request.status !== 'Pending') {
            return res.status(404).json({ success: false, message: "Active pending withdrawal request not found." });
        }

        request.status = 'Rejected';
        request.rejectionReason = reason || "Declined by Admin";
        request.rejectedAt = new Date();
        await request.save();

        // 🚨 Refund safety mechanism
        const wallet = await Wallet.findOne({ vendorId: request.vendorId, vendorModel: request.vendorModel });
        if (wallet) {
            wallet.balance += request.amount; // Refund held amount
            wallet.transactions.push({
                type: 'Credit',
                amount: request.amount,
                remark: `Withdrawal Declined Refund (Reason: ${request.rejectionReason})`
            });
            await wallet.save();
        }

        res.json({ success: true, message: "Withdrawal request rejected. Balance refunded to vendor wallet.", data: request });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// PATCH /api/admin/wallet/verify-bank/:vendorModel/:vendorId
// Replace this complete function inside controllers/admin/AdminWallet.js
const verifyVendorBankDetails = async (req, res) => {
    try {
        const { vendorModel, vendorId } = req.params;
        const { isVerified } = req.body; // Expects true or false

        if (typeof isVerified === 'undefined') {
            return res.status(400).json({ success: false, message: "isVerified state (true/false) is required." });
        }

        let VendorModel;
        
        // Polymorphic Dynamic Model Selection [1]
        switch (vendorModel) {
            case 'Doctor': VendorModel = Doctor; break;
            case 'Hospital': VendorModel = Hospital; break;
            case 'Lab': VendorModel = Lab; break;
            case 'Pharmacy': VendorModel = Pharmacy; break;
            case 'Nurse': VendorModel = Nurse; break;
            case 'Ambulance': VendorModel = Ambulance; break;
            default:
                return res.status(400).json({ success: false, message: "Invalid vendor model type." });
        }

        // Update isVerified directly inside vendor's own schema profile document [1]
        const vendor = await VendorModel.findByIdAndUpdate(
            vendorId,
            { $set: { "bankDetails.isVerified": isVerified } },
            { new: true }
        ).select('-password');

        if (!vendor) {
            return res.status(404).json({ success: false, message: "Vendor profile not found." });
        }

        res.json({
            success: true,
            message: `Bank details for ${vendor.name} (${vendorModel}) marked as ${isVerified ? 'Verified' : 'Unverified'}.`,
            data: vendor.bankDetails
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 5. GET ALL PENDING BANK VERIFICATIONS (Admin Consolidated Dashboard) - [1.2.2]
// GET: /api/admin/wallet/pending-banks
const getPendingBankVerifications = async (req, res) => {
    try {
        // Query condition: Bank Account Number exist karta ho aur isVerified false/missing ho
        const queryFilter = {
            "bankDetails.accountNumber": { $exists: true, $ne: "" },
            $or: [
                { "bankDetails.isVerified": false },
                { "bankDetails.isVerified": { $exists: false } }
            ]
        };

        const selectFields = 'name email phone bankDetails';

        // High-Performance parallel queries across all 6 databases
        const [doctors, hospitals, labs, pharmacies, nurses, ambulances] = await Promise.all([
            Doctor.find(queryFilter).select(selectFields).lean(),
            Hospital.find(queryFilter).select(selectFields).lean(),
            Lab.find(queryFilter).select(selectFields).lean(),
            Pharmacy.find(queryFilter).select(selectFields).lean(),
            Nurse.find(queryFilter).select(selectFields).lean(),
            Ambulance.find(queryFilter).select(selectFields).lean()
        ]);

        // Map into a unified polymorphic response structure
        const pendingBanksList = [
            ...doctors.map(d => ({ vendorId: d._id, name: d.name, email: d.email, phone: d.phone, vendorModel: 'Doctor', bankDetails: d.bankDetails })),
            ...hospitals.map(h => ({ vendorId: h._id, name: h.name, email: h.email, phone: h.phone, vendorModel: 'Hospital', bankDetails: h.bankDetails })),
            ...labs.map(l => ({ vendorId: l._id, name: l.name, email: l.email, phone: l.phone, vendorModel: 'Lab', bankDetails: l.bankDetails })),
            ...pharmacies.map(p => ({ vendorId: p._id, name: p.name, email: p.email, phone: p.phone, vendorModel: 'Pharmacy', bankDetails: p.bankDetails })),
            ...nurses.map(n => ({ vendorId: n._id, name: n.name, email: n.email, phone: n.phone, vendorModel: 'Nurse', bankDetails: n.bankDetails })),
            ...ambulances.map(a => ({ vendorId: a._id, name: a.name, email: a.email, phone: a.phone, vendorModel: 'Ambulance', bankDetails: a.bankDetails }))
        ];

        res.json({
            success: true,
            count: pendingBanksList.length,
            data: pendingBanksList
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 6. GET ADMIN GLOBAL WALLET DASHBOARD STATS (Centralized Financial Monitor) - [1.2.2]
// GET: /api/admin/wallet/dashboard-stats
const getAdminWalletDashboardStats = async (req, res) => {
    try {
        // A. Calculate Total Platform Liability (Vendors ka total bacha hua wallet balance)
        const totalLiabilityQuery = await Wallet.aggregate([
            { $group: { _id: null, total: { $sum: "$balance" } } }
        ]);
        const platformTotalLiability = totalLiabilityQuery[0]?.total || 0;

        // B. Calculate Payout Metrics (Pending, Approved, Rejected)
        const payoutStats = await WithdrawalRequest.aggregate([
            {
                $group: {
                    _id: "$status",
                    totalAmount: { $sum: "$amount" },
                    count: { $sum: 1 }
                }
            }
        ]);

        const formattedPayouts = {
            Pending: { amount: 0, count: 0 },
            Approved: { amount: 0, count: 0 },
            Rejected: { amount: 0, count: 0 }
        };

        payoutStats.forEach(stat => {
            if (formattedPayouts[stat._id]) {
                formattedPayouts[stat._id] = {
                    amount: stat.totalAmount,
                    count: stat.count
                };
            }
        });

        // C. Count Pending Bank Verifications
        const queryFilter = {
            "bankDetails.accountNumber": { $exists: true, $ne: "" },
            $or: [
                { "bankDetails.isVerified": false },
                { "bankDetails.isVerified": { $exists: false } }
            ]
        };

        const [doctors, hospitals, labs, pharmacies, nurses, ambulances] = await Promise.all([
            Doctor.countDocuments(queryFilter),
            Hospital.countDocuments(queryFilter),
            Lab.countDocuments(queryFilter),
            Pharmacy.countDocuments(queryFilter),
            Nurse.countDocuments(queryFilter),
            Ambulance.countDocuments(queryFilter)
        ]);
        const totalPendingBanks = doctors + hospitals + labs + pharmacies + nurses + ambulances;

        // 🚨 D. CALCULATE TOTAL PLATFORM COMMISSION EARNED (Admin Revenue across all 6 collections)
        const [completedAppts, completedLabs, completedPharmas, completedNurses, completedAmbulances] = await Promise.all([
            Appointment.find({ status: 'Completed' }).select('bookingType totalAmount').lean(),
            LabBooking.find({ status: { $in: ['Report Uploaded', 'Completed'] } }).select('billSummary totalPrice').lean(),
            PharmacyBooking.find({ status: { $in: ['Delivered', 'Completed'] } }).select('billSummary').lean(),
            NurseBooking.find({ status: 'Completed' }).select('priceBreakdown totalPrice').lean(),
            AmbulanceBooking.find({ status: 'Delivered' }).select('serviceType pricing').lean()
        ]);

        let totalAdminCommissionRevenue = 0;
        let totalGrossOrderVolume = 0;

        // 1. Doctor & Hospital Appointments Commission
        for (let appt of completedAppts) {
            const role = appt.bookingType === 'Admission' ? 'Hospital' : 'Doctor';
            const gross = Number(appt.totalAmount || 0);
            totalGrossOrderVolume += gross;
            const { adminCutoff } = await calculateAdminCommission(role, gross);
            totalAdminCommissionRevenue += adminCutoff;
        }

        // 2. Lab Commission
        for (let lab of completedLabs) {
            const gross = Number(lab.billSummary?.totalAmount || lab.totalPrice || 0);
            totalGrossOrderVolume += gross;
            const { adminCutoff } = await calculateAdminCommission('Lab', gross);
            totalAdminCommissionRevenue += adminCutoff;
        }

        // 3. Pharmacy Commission
        for (let pharma of completedPharmas) {
            const gross = Number(pharma.billSummary?.totalAmount || 0);
            totalGrossOrderVolume += gross;
            const { adminCutoff } = await calculateAdminCommission('Pharmacy', gross);
            totalAdminCommissionRevenue += adminCutoff;
        }

        // 4. Nurse Commission
        for (let nurse of completedNurses) {
            const gross = Number(nurse.priceBreakdown?.totalPrice || nurse.totalPrice || 0);
            totalGrossOrderVolume += gross;
            const { adminCutoff } = await calculateAdminCommission('Nurse', gross);
            totalAdminCommissionRevenue += adminCutoff;
        }

        // 5. Ambulance Commission
        for (let amb of completedAmbulances) {
            let subtype = 'Ambulance-Medical';
            if (amb.serviceType === 'Accident emergency') subtype = 'Ambulance-Accident';
            else if (amb.serviceType === 'Referral Ambulance') subtype = 'Ambulance-Referral';

            const gross = Number(amb.pricing?.total > 0 ? amb.pricing.total : (amb.pricing?.originalAmbulanceCharge || 2000));
            totalGrossOrderVolume += gross;
            const { adminCutoff } = await calculateAdminCommission(subtype, gross);
            totalAdminCommissionRevenue += adminCutoff;
        }

        res.json({
            success: true,
            data: {
                totalGrossOrderVolume,              // Platform par total kitne rupaye ke orders huye
                totalAdminCommissionRevenue,        // 👈 Admin ka apna total kamaya gaya profit
                platformTotalLiability,             // Vendors ko abhi kitna cash pay karna bacha hai
                payoutStats: formattedPayouts,
                pendingBankVerificationsCount: totalPendingBanks
            }
        });

    } catch (error) {
        console.error("Admin Wallet Stats Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
module.exports = { getPendingWithdrawals, approveWithdrawal, rejectWithdrawal, verifyVendorBankDetails, getPendingBankVerifications, getAdminWalletDashboardStats }; 