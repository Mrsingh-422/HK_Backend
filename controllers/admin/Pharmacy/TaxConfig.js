// controllers/admin/Pharmacy/TaxConfig.js

const HsnMaster = require('../../../models/HsnMaster');
const HsnRequest = require('../../../models/HsnRequest');

// 1. Create HSN Code Master Entry (Protected)
const createHsnCode = async (req, res) => {
    try {
        const { hsnCode, description, totalGstPercent } = req.body;

        if (!hsnCode || !description || totalGstPercent === undefined) {
            return res.status(400).json({ 
                success: false, 
                message: "All fields (hsnCode, description, totalGstPercent) are required." 
            });
        }

        const newHsn = await HsnMaster.create({
            hsnCode: hsnCode.trim(),
            description: description.trim(),
            totalGstPercent: Number(totalGstPercent)
        });

        res.status(201).json({ 
            success: true, 
            message: "HSN Code slab registered successfully!", 
            data: newHsn 
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ 
                success: false, 
                message: "This HSN Code is already registered." 
            });
        }
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. Fetch all active HSN codes (Public / Token Free)
const getHsnCodes = async (req, res) => {
    try {
        const list = await HsnMaster.find({ isActive: true }).sort({ hsnCode: 1 });
        
        res.status(200).json({ 
            success: true, 
            count: list.length, 
            data: list 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. Admin: Sabhi pharmacies ki aayi hui HSN requests ki list dekhna
// Endpoint: GET /admin/pharmacy/tax-config/hsn-requests/list?status=Pending
const getAllHsnRequests = async (req, res) => {
    try {
        const { status } = req.query;
        let query = {};
        if (status) query.status = status; // Filter: 'Pending', 'Approved', 'Rejected'

        const requests = await HsnRequest.find(query)
            .populate('vendorId', 'name email phone city address')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: requests.length,
            data: requests
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. Admin: Request ko APPROVE ya REJECT karna (with reason)
// Endpoint: PUT /admin/pharmacy/tax-config/hsn-requests/action/:requestId
const reviewHsnRequest = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { action, rejectionReason, finalTaxPercent } = req.body; 
        // action: 'Approved' ya 'Rejected'

        const request = await HsnRequest.findById(requestId);
        if (!request) {
            return res.status(404).json({ success: false, message: "HSN Request not found." });
        }

        if (request.status !== 'Pending') {
            return res.status(400).json({ success: false, message: `Request is already ${request.status}.` });
        }

        if (action === 'Approved') {
            const taxToApply = finalTaxPercent !== undefined ? Number(finalTaxPercent) : request.suggestedTaxPercent;

            // 1. HSN Master Table me automatic insert / activate karein
            await HsnMaster.findOneAndUpdate(
                { hsnCode: request.hsnCode },
                {
                    description: request.description,
                    totalGstPercent: taxToApply,
                    isActive: true
                },
                { upsert: true, new: true }
            );

            // 2. Request status update karein
            request.status = 'Approved';
            request.rejectionReason = null;
            await request.save();

            return res.json({
                success: true,
                message: `HSN Code '${request.hsnCode}' has been approved and added to active master list!`,
                data: request
            });
        } 
        
        if (action === 'Rejected') {
            if (!rejectionReason || rejectionReason.trim() === "") {
                return res.status(400).json({ success: false, message: "Please provide a rejection reason." });
            }

            request.status = 'Rejected';
            request.rejectionReason = rejectionReason.trim();
            await request.save();

            return res.json({
                success: true,
                message: "HSN request has been rejected.",
                data: request
            });
        }

        return res.status(400).json({ success: false, message: "Invalid action. Must be 'Approved' or 'Rejected'." });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = { createHsnCode, getHsnCodes, getAllHsnRequests, reviewHsnRequest };