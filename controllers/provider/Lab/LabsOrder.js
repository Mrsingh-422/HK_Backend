// controllers/provider/Lab/LabsOrder.js

const LabBooking = require('../../../models/LabBooking');
const Wallet = require('../../../models/Wallet');
const MasterReportTemplate = require('../../../models/MasterReportTemplate'); // 👈 Imported Template Model
const LabPrescriptionRequest = require('../../../models/LabPrescriptionRequest'); // Import model
const Driver = require('../../../models/Driver');
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { sendPushNotification } = require('../../../utils/notification'); 
const { deleteFile } = require('../../../utils/fileHandler');
const NoShowConfig = require('../../../models/NoShowConfig');


// 1. GET DASHBOARD STATS (Updated with Priority Count)
const getLabStats = async (req, res) => {
    try {
        const labId = req.user.id;

        const [requests, priorityRequests, accepted, completed] = await Promise.all([
            LabBooking.countDocuments({ labId, status: 'Pending' }),
            // Count of pending bookings that have a rapid/priority delivery charge
            LabBooking.countDocuments({ 
                labId, 
                status: 'Pending', 
                'billSummary.rapidDeliveryCharge': { $gt: 0 } 
            }),
            LabBooking.countDocuments({ labId, status: 'Confirmed' }),
            LabBooking.countDocuments({ labId, status: 'Completed' })
        ]);
        
        const wallet = await Wallet.findOne({ vendorId: labId });
        res.json({ 
            success: true, 
            data: { 
                requests, 
                priorityRequests, // For UI Priority Tab Badge
                accepted, 
                completed, 
                todayEarnings: wallet?.balance || 0 
            } 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 2. GET ORDER LIST (With Filter & Priority Logic)
// endpoint: GET /api/provider/labs/orders
const getOrders = async (req, res) => {
    try {
        const { status, isPriority } = req.query;
        let query = { labId: req.user.id };
        
        // 1. Status Filter
        if (status) query.status = status;

        // 2. Priority / Rapid Delivery Filter
        if (isPriority === 'true') {
            // Bookings that have rapid delivery charges applied (> 0)
            query['billSummary.rapidDeliveryCharge'] = { $gt: 0 };
        } else if (isPriority === 'false') {
            // Bookings that are normal/regular delivery (charge is 0)
            query['billSummary.rapidDeliveryCharge'] = 0;
        }

        const orders = await LabBooking.find(query)
            .populate('userId', 'name phone address')
            .populate('phlebotomistId', 'name phone')
            .populate({
                path: 'items.packages.packageId',
                select: 'packageName tests', // Select package fields
                populate: {
                    path: 'tests', // Populate nested MasterLabTest array
                    model: 'MasterLabTest',
                    select: 'testName' // Select only testName field
                }
            })
            .sort({ createdAt: -1 });

        res.json({ success: true, count: orders.length, data: orders });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 3. ACTION: ACCEPT/REJECT
const handleOrderAction = async (req, res) => {
    try {
        const { action, reason } = req.body; 
        const status = action === 'Rejected' ? 'Cancelled' : 'Confirmed';
        
        const order = await LabBooking.findOneAndUpdate(
            { _id: req.params.orderId, labId: req.user.id },
            { status, cancelReason: reason },
            { new: true }
        );
        res.json({ success: true, message: `Order ${status} successfully`, data: order });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 4. ASSIGN PHLEBOTOMIST
const assignStaff = async (req, res) => {
    try {
        const { phlebotomistId } = req.body;
        const { orderId } = req.params;
        const labId = req.user.id;

        if (!phlebotomistId || !orderId) {
            return res.status(400).json({ 
                success: false, 
                message: "Phlebotomist ID and Order ID are required to assign staff." 
            });
        }

        // 1. Explicitly cast values to ObjectId to prevent dynamic refPath mismatch in queries
        const phlebotomistObjectId = new mongoose.Types.ObjectId(phlebotomistId);
        const labObjectId = new mongoose.Types.ObjectId(labId);
        const orderObjectId = new mongoose.Types.ObjectId(orderId);

        // 2. Verify karein ki driver exist karta hai, is lab ka part hai aur online hai
        const driver = await Driver.findOne({ 
            _id: phlebotomistObjectId, 
            vendorId: labObjectId,
            vendorType: 'Lab'
        });

        if (!driver) {
            return res.status(404).json({ 
                success: false, 
                message: "Phlebotomist not found or unauthorized for this lab." 
            });
        }

        if (driver.status === 'Offline') {
            return res.status(400).json({ 
                success: false, 
                message: "Cannot assign an offline phlebotomist." 
            });
        }

        // 3. Booking update karein database me
        const booking = await LabBooking.findOneAndUpdate(
            { _id: orderObjectId, labId: labObjectId },
            { 
                $set: {
                    phlebotomistId: phlebotomistObjectId, 
                    status: 'Phlebotomist Assigned' 
                }
            },
            { new: true }
        );

        if (!booking) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        // 4. Update the driver status directly to 'Busy' using findByIdAndUpdate
        const updatedDriver = await Driver.findByIdAndUpdate(
            phlebotomistObjectId,
            { $set: { status: 'Busy' } },
            { new: true, runValidators: false }
        );

        console.log(`[Sync Completed]: Phlebotomist status set to ->`, updatedDriver?.status);

        res.json({ 
            success: true, 
            message: "Phlebotomist assigned successfully", 
            driverStatus: updatedDriver ? updatedDriver.status : "Busy",
            data: booking 
        });

    } catch (error) { 
        console.error("Assign Staff Operation Failed:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 5. UPDATE PROGRESS (Sample Collected -> Testing -> Report Generated)
const updateProgressStatus = async (req, res) => {
    try {
        const { status } = req.body; 
        const validStatuses = ['Sample Collected', 'Testing', 'Report Generated'];
        
        if (!validStatuses.includes(status)) return res.status(400).json({ message: "Invalid status" });

        const order = await LabBooking.findOneAndUpdate(
            { _id: req.params.orderId, labId: req.user.id },
            { status },
            { new: true }
        );
        res.json({ success: true, message: "Status updated", data: order });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 6. UPLOAD REPORT & COMPLETE
const uploadReport = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "PDF report required" });

        const order = await LabBooking.findOneAndUpdate(
            { _id: req.params.orderId, labId: req.user.id },
            { 
                reportFile: req.file.path, 
                status: 'Completed' 
            },
            { new: true }
        );
        res.json({ success: true, message: "Report uploaded successfully", data: order });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};


// 7. GET REPORT TEMPLATES (Optimized: Strictly requires testNames to avoid 1000+ database dumps)
// endpoint: GET /provider/labs/report-templates
const getReportTemplates = async (req, res) => {
    try {
        const { testNames } = req.query;
        
        // 🚨 SECURITY/PERFORMANCE GUARD: Prevent massive data dump
        if (!testNames) {
            return res.status(400).json({ 
                success: false, 
                message: "Query parameter 'testNames' (comma-separated list) is required to fetch detailed parameters. Database dump is blocked." 
            });
        }

        const requestedList = testNames.split(',').map(name => name.trim());
        
        // Only fetch requested templates from database
        const templates = await MasterReportTemplate.find({ testName: { $in: requestedList } }).lean();

        const formattedTemplates = {};
        templates.forEach(t => {
            formattedTemplates[t.testName] = {
                interpretation: t.parameters?.[0]?.interpretation || "",
                parameters: t.parameters
            };
        });

        res.json({ 
            success: true, 
            count: templates.length, 
            data: formattedTemplates 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};




// 8. GET REPORT TEMPLATES FOR DROPDOWN (Highly Optimized: Name & ID only with Limit 50)
// endpoint: GET /provider/labs/report-templates/dropdown
const getReportTemplatesDropdown = async (req, res) => {
    try {
        const { search } = req.query; // Optional search to filter dropdown values on typing

        let query = {};
        if (search) {
            query.testName = { $regex: search, $options: 'i' };
        }

        // 🚨 PERFORMANCE OPTIMIZATION: Only select 'testName' and limit results to 50
        const templates = await MasterReportTemplate.find(query)
            .select('testName')
            .sort({ testName: 1 })
            .limit(50); // Prevents rendering bottleneck of 1000+ rows
        
        res.json({ 
            success: true, 
            count: templates.length, 
            data: templates 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}; 

// =============================================================================
// 7. NEW: GET REPORT DATA (Frontend PDF rendering ke liye clean JSON bhejega)
// endpoint: GET /provider/labs/get-report-data/:orderId
// =============================================================================
const getReportData = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { patientId } = req.query;

        // Fetch Booking with populated Lab profile
        const booking = await LabBooking.findById(orderId).populate('labId').lean();
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found." });
        }

        // Mapped: Fetch draft specifically for this patient to prevent data mix-ups
        let testResults = null;
        if (booking.testResults) {
            if (patientId && booking.testResults[patientId]) {
                testResults = booking.testResults[patientId];
            } else {
                const keys = Object.keys(booking.testResults);
                testResults = keys.length > 0 ? booking.testResults[keys[0]] : booking.testResults;
            }
        }

        // --- NEW CONDITIONAL ADDRESS LOGIC ---
        let reportCollectionAddress = null;

        if (booking.collectionType === 'Home Collection') {
            const addr = booking.address;
            if (addr) {
                // Construct full formatted address string from the booking's address object
                reportCollectionAddress = [
                    addr.houseNo,
                    addr.sector,
                    addr.landmark,
                    addr.city,
                    addr.state,
                    addr.pincode ? `- ${addr.pincode}` : ''
                ]
                .filter(part => part && part.trim() !== '') // Remove empty fields
                .join(', ')
                .replace(', -', ' -'); // Clean up spacing before the pincode
            } else {
                reportCollectionAddress = "Home Collection (Address Details Missing)";
            }
        } else {
            // For 'Visit Lab', return null or a designated walk-in string
            reportCollectionAddress = "Walk-In (Visit Lab)";
        }

        res.json({
            success: true,
            data: {
                bookingId: booking.bookingId,
                appointmentId: booking._id,
                appointmentDate: booking.appointmentDate,
                barcode: booking.barcode || "E4708538",
                collectionType: booking.collectionType, // Returned so the PDF engine/frontend knows the setup
                collectionAddress: reportCollectionAddress, // Handled conditionally on backend
                labName: booking.labId?.name || "HealthKangaroo Labs",
                labAddress: `${booking.labId?.city || ''}, ${booking.labId?.state || ''}`,
                patients: booking.patients, 
                testResults: testResults 
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =============================================================================
// 8. NEW: UPLOAD CLIENT GENERATED PDF (Safe from EXDEV cross-device link issues)
// endpoint: POST /provider/labs/upload-client-pdf/:orderId
// =============================================================================
const uploadClientGeneratedPDF = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { patientId } = req.body; // Target Patient ID

        if (!req.file) {
            return res.status(400).json({ success: false, message: "Please upload the compiled PDF file." });
        }

        const booking = await LabBooking.findById(orderId);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found." });
        }

        // Safe Patient Resolver [1]
        let patient = null;
        if (patientId && patientId !== "undefined" && patientId !== "null") {
            patient = booking.patients.find(p => 
                String(p.patientId) === String(patientId) || 
                String(p._id) === String(patientId) ||
                (String(patientId).toLowerCase() === 'self' && p.relation === 'Self')
            );
        }

        if (!patient && booking.patients && booking.patients.length > 0) {
            patient = booking.patients[0];
        }

        if (!patient) {
            patient = { name: "Patient", age: 30, gender: "Female" };
        }

        // Unique PDF file save path
        const reportFileName = `report-${booking.bookingId}-${patient.name.replace(/\s+/g, '_')}.pdf`;
        const destPath = path.join(process.cwd(), 'public', 'uploads', 'user_reports', reportFileName);

        // 🚨 CRITICAL PROD FIX: Safe file rename handler protecting from EXDEV cross-device link errors [cite: custom_context]
        try {
            fs.renameSync(req.file.path, destPath);
        } catch (renameErr) {
            if (renameErr.code === 'EXDEV') {
                // Fallback copy-and-delete for containerized mounts/Docker/VPS
                fs.copyFileSync(req.file.path, destPath);
                fs.unlinkSync(req.file.path);
            } else {
                throw renameErr;
            }
        }

        // Sync polymorphic multi-patient database fields [1]
        if (!booking.patientReports) booking.patientReports = [];
        booking.patientReports = booking.patientReports.filter(r => String(r.patientId) !== String(patient.patientId || patient._id || "Self"));

        const finalReportFile = `/uploads/user_reports/${reportFileName}`;

        booking.patientReports.push({
            patientId: patient.patientId || patient._id || "Self",
            patientName: patient.name,
            reportFile: finalReportFile
        });

        // Overall state management check
        const allCompleted = booking.patients.every(p => {
            const targetId = p.patientId || p._id || "Self";
            return booking.patientReports.some(r => String(r.patientId) === String(targetId));
        });

        booking.status = allCompleted ? 'Completed' : 'Testing';
        booking.reportFile = finalReportFile; // Fallback reference
        
        booking.markModified('patientReports');
        await booking.save();

        res.json({
            success: true,
            message: "Client PDF report successfully saved on server!",
            reportUrl: finalReportFile,
            data: booking
        });

    } catch (error) {
        console.error("uploadClientGeneratedPDF Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// 10. NEW: AUTO-RESOLVE TEMPLATES FOR SPECIFIC BOOKING (Smart Handshake)
// endpoint: GET /provider/labs/report-templates/booking/:orderId
const getReportTemplatesForBooking = async (req, res) => {
    try {
        const { orderId } = req.params;
        
        // 🚨 DEEP POPULATION: Resolves packages and their nested clinical tests dynamically! [1]
        const booking = await LabBooking.findById(orderId)
            .populate({
                path: 'items.packages.packageId',
                populate: {
                    path: 'tests',
                    model: 'MasterLabTest',
                    select: 'testName'
                }
            });

        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found." });
        }

        // A. Extract standalone test names
        const testNames = booking.items.tests.map(t => t.name);
        
        // B. 🚨 PACKAGE EXTRACTOR: Loop through packages and extract nested testName strings [1]
        const packageTestNames = [];
        if (booking.items?.packages) {
            booking.items.packages.forEach(p => {
                if (p.packageId && p.packageId.tests) {
                    p.packageId.tests.forEach(nt => {
                        packageTestNames.push(nt.testName); // 👈 Nested test name [1]
                    });
                }
            });
        }

        // Combine standalone and package-based tests into a single query array
        const allBookedNames = [...testNames, ...packageTestNames];

        // Fuzzy regex matching
        const regexQueries = allBookedNames.map(name => {
            const cleanName = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').trim();
            const words = cleanName.split(/\s+/).filter(w => w.length > 2);
            return new RegExp(words.join('.*'), 'i');
        });

        const templates = await MasterReportTemplate.find({
            $or: [
                { testName: { $in: allBookedNames } },
                { testName: { $in: regexQueries } }
            ]
        }).lean();

        const formattedTemplates = {};
        templates.forEach(t => {
            formattedTemplates[t.testName] = {
                interpretation: t.parameters?.[0]?.interpretation || "",
                parameters: t.parameters
            };
        });

        res.json({ 
            success: true, 
            count: templates.length, 
            data: formattedTemplates 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 4. SAVE DRAFT RESULTS (Partitioned by Patient ID)
// Replacing saveDraftResults inside controllers/provider/Lab/LabsOrder.js
// ==========================================
const saveDraftResults = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { testValues, patientId } = req.body; // 👈 Partitioned by patientId

        if (!testValues || !patientId) {
            return res.status(400).json({ success: false, message: "Both 'testValues' and 'patientId' are required." });
        }

        const booking = await LabBooking.findById(orderId);
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found." });

        // Initialize object if null/empty
        if (!booking.testResults || typeof booking.testResults !== 'object') {
            booking.testResults = {};
        }

        // Save progress specifically under this patient's key [1]
        booking.testResults[patientId] = testValues;

        // Force Mongoose to save mixed type changes
        booking.markModified('testResults');
        booking.status = 'Testing';

        await booking.save();

        res.json({ 
            success: true, 
            message: "Draft saved for this patient successfully.", 
            data: booking.testResults[patientId] 
        });
    } catch (error) {
        console.error("saveDraftResults Error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 5. FETCH SAVED DRAFT RESULTS (Partitioned by Patient ID)
// Replacing getDraftResults inside controllers/provider/Lab/LabsOrder.js
// ==========================================
const getDraftResults = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { patientId } = req.query; // 👈 Fetch specifically for this patient

        if (!patientId) {
            return res.status(400).json({ success: false, message: "Query parameter 'patientId' is required." });
        }

        const booking = await LabBooking.findById(orderId).lean();
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found." });
        }

        // Extract draft specifically for this patient
        const draft = booking.testResults ? booking.testResults[patientId] : null;

        res.json({ 
            success: true, 
            data: draft || null 
        });
    } catch (error) {
        console.error("getDraftResults Error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET LAB ORDER HISTORY (Completed & Cancelled Bookings)
// Endpoint: GET /provider/labs/order-history
const getLabOrderHistory = async (req, res) => {
    try {
        const labId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20; // Default limit 20 entries per page
        const skip = (page - 1) * limit;
        
        const { search, status, startDate, endDate } = req.query;

        // Base query: Sirf completed ya cancelled orders fetch karne ke liye
        let query = { 
            labId, 
            status: { $in: ['Completed', 'Cancelled'] } 
        };

        // Specific status filter (Completed ya Cancelled me se koi ek)
        if (status && ['Completed', 'Cancelled'].includes(status)) {
            query.status = status;
        }

        // Dynamic Keyword Search (Booking ID, Custom Order ID ya Patient Name ke upar)
        if (search) {
            query.$or = [
                { bookingId: { $regex: search, $options: 'i' } },
                { 'patients.name': { $regex: search, $options: 'i' } }
            ];
        }

        // Optional Date Range filtering (Auditing/Earnings checks ke liye)
        if (startDate && endDate) {
            const start = moment(startDate).startOf('day').toDate();
            const end = moment(endDate).endOf('day').toDate();
            query.createdAt = {
                $gte: start,
                $lte: end
            };
        }

        // Parallel count and find operations for performance optimization
        const [orders, total] = await Promise.all([
            LabBooking.find(query)
                .populate('userId', 'name phone email')
                .populate('phlebotomistId', 'name phone status')
                .populate({
                    path: 'items.packages.packageId',
                    select: 'packageName tests',
                    populate: {
                        path: 'tests',
                        model: 'MasterLabTest',
                        select: 'testName'
                    }
                })
                .sort({ createdAt: -1 }) // Latest orders first
                .skip(skip)
                .limit(limit)
                .lean(),
            LabBooking.countDocuments(query)
        ]);

        res.json({
            success: true,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            limit,
            data: orders
        });

    } catch (error) {
        console.error("Error in getLabOrderHistory:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};



/////////////////////////////////////////////////////////////////
////////////////////// AI SCAN PRESCRIPTION ////////////////////
////////////////////////////////////////////////////////////////

// 1. GET PENDING REQUESTS FOR LAB (Dashboard View)
const getProviderLabPrescriptionRequests = async (req, res) => {
    try {
        const labId = req.user.id;
        const { status } = req.query;

        let query = { labId };
        if (status) query.status = status;

        const requests = await LabPrescriptionRequest.find(query)
            .populate('userId', 'name phone email')
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

// 2. GET SINGLE REQUEST DETAILS (For Review)
const getProviderLabPrescriptionRequestDetails = async (req, res) => {
    try {
        const { requestId } = req.params;
        const labId = req.user.id;

        // 🚨 FIXED: Hybrid query safely supports both Mongoose _id and custom REQ-LAB string
        const isObjectId = mongoose.Types.ObjectId.isValid(requestId);
        const query = { labId };
        if (isObjectId) query._id = requestId;
        else query.requestId = requestId;

        const request = await LabPrescriptionRequest.findOne(query)
            .populate('userId', 'name phone email gender age');

        if (!request) {
            return res.status(404).json({ success: false, message: "Request details not found" });
        }

        res.json({
            success: true,
            data: request
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. START PRESCRIPTION REVIEW (Locks status to 'Reviewing' with Hybrid Query)
const startLabPrescriptionReview = async (req, res) => {
    try {
        const { requestId } = req.params;
        const labId = req.user.id;

        // 🚨 FIXED: Hybrid query support
        const isObjectId = mongoose.Types.ObjectId.isValid(requestId);
        const query = { labId };
        if (isObjectId) query._id = requestId;
        else query.requestId = requestId;

        const request = await LabPrescriptionRequest.findOne(query);
        if (!request) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }

        if (request.status === 'Pending Review') {
            request.status = 'Reviewing';
            await request.save();
        }

        res.json({
            success: true,
            message: "Prescription review started successfully",
            data: request
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. SUBMIT LAB REVIEW & BILL (Generate Suggested Invoice)
const submitLabReviewBill = async (req, res) => {
    try {
        const { requestId } = req.params;
        // 🚨 STRICT SYNC: Capturing tests and packages carrying precautions separately [cite: custom_context]
        const { tests, packages, homeVisitCharge } = req.body; 
        const labId = req.user.id;

        const isObjectId = mongoose.Types.ObjectId.isValid(requestId);
        const query = { labId };
        if (isObjectId) query._id = requestId;
        else query.requestId = requestId;

        const request = await LabPrescriptionRequest.findOne(query);
        if (!request) {
            return res.status(404).json({ success: false, message: "Request details not found" });
        }

        let itemTotal = 0;
        const verifiedTests = [];
        const verifiedPackages = [];

        // Map tests array safely with precautions [cite: custom_context]
        if (tests && tests.length > 0) {
            for (let t of tests) {
                const subtotal = Number(t.pricePerUnit || 0);
                itemTotal += subtotal;
                verifiedTests.push({
                    testId: t.testId && mongoose.isValidObjectId(t.testId) ? t.testId : null,
                    name: t.name,
                    mrp: Number(t.mrp || 0),
                    pricePerUnit: subtotal,
                    precaution: t.precaution || "" // 👈 Dynamic precaution saved [cite: custom_context]
                });
            }
        }

        // Map packages array safely with precautions [cite: custom_context]
        if (packages && packages.length > 0) {
            for (let p of packages) {
                const subtotal = Number(p.pricePerUnit || 0);
                itemTotal += subtotal;
                verifiedPackages.push({
                    packageId: p.packageId && mongoose.isValidObjectId(p.packageId) ? p.packageId : null,
                    name: p.name,
                    mrp: Number(p.mrp || 0),
                    pricePerUnit: subtotal,
                    precaution: p.precaution || "" // 👈 Dynamic precaution saved [cite: custom_context]
                });
            }
        }

        const patientCount = request.patients.length || 1;
        const subtotalSum = itemTotal * patientCount;
        const totalAmount = subtotalSum + Number(homeVisitCharge || 0);

        // Saved matching your updated database schema keys
        request.verifiedBill = {
            tests: verifiedTests,
            packages: verifiedPackages,
            itemTotal: subtotalSum,
            homeVisitCharge: Number(homeVisitCharge || 0),
            totalAmount: Math.round(totalAmount)
        };
        request.status = 'Bill Generated';
        await request.save();

        // Trigger Notification
        await sendPushNotification(
            request.userId,
            "Lab Bill Generated!",
            `Your prescription review is complete. View suggested tests & make payment of ₹${request.verifiedBill.totalAmount}.`,
            { requestId: request._id.toString(), type: 'lab_bill_generated' }
        );

        res.json({
            success: true,
            message: "Suggested bill generated successfully!",
            data: request
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 5. REJECT LAB PRESCRIPTION REQUEST (With Push Alert)
const rejectLabPrescriptionRequest = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { reason } = req.body;
        const labId = req.user.id;

        const isObjectId = mongoose.Types.ObjectId.isValid(requestId);
        const query = { labId };
        if (isObjectId) query._id = requestId;
        else query.requestId = requestId;

        const request = await LabPrescriptionRequest.findOne(query);
        if (!request) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }

        request.status = 'Rejected';
        request.rejectReason = reason || "Invalid Prescription criteria";
        await request.save();

        // 🚨 TRIGGER PUSH NOTIFICATION: Patient ko rejection ki suchna dein
        await sendPushNotification(
            request.userId,
            "Prescription Request Rejected",
            `Your prescription upload was rejected. Reason: ${request.rejectReason}`,
            { requestId: request._id.toString(), type: 'lab_prescription_rejected' }
        );

        res.json({
            success: true,
            message: "Request rejected successfully",
            rejectReason: request.rejectReason,
            data: request
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

 // =======================================================

// 1. GET ALL ELIGIBLE PHLEBOTOMISTS FOR DROPDOWN / LIST

// =======================================================

// Endpoint: GET /provider/labs/available-phlebotomists

const getAvailablePhlebotomists = async (req, res) => {

    try {

        const labId = req.user.id;
 
        // Sirf un drivers ko fetch karein jo is Lab ke under registered hain aur Offline nahi hain

        const phlebotomists = await Driver.find({

            vendorId: labId,

            vendorType: 'Lab',

            status: { $ne: 'Offline' } // Jo log offline hain unhe assign nahi kiya ja sakta

        }).select('name phone status profilePic');
 
        res.json({ 

            success: true, 

            count: phlebotomists.length, 

            data: phlebotomists 

        });

    } catch (error) {

        res.status(500).json({ success: false, message: error.message });

    }

};
 
 
// =======================================================

// 3. RE-ASSIGN PHLEBOTOMIST (Change Existing Driver)

// =======================================================

// Endpoint: PATCH /provider/labs/reassign-staff/:orderId

const reassignDriverStaff = async (req, res) => {

    try {

        const { orderId } = req.params;

        const { newPhlebotomistId } = req.body;

        const labId = req.user.id;
 
        if (!newPhlebotomistId) {

            return res.status(400).json({ 

                success: false, 

                message: "New Phlebotomist ID is required for re-assignment." 

            });

        }
 
        // 1. Find the current booking

        const booking = await LabBooking.findOne({ _id: orderId, labId });

        if (!booking) {

            return res.status(404).json({ success: false, message: "Booking not found." });

        }
 
        const oldPhlebotomistId = booking.phlebotomistId;
 
        // Security check: Agar same driver ko re-assign karne ki koshish ki jaye

        if (oldPhlebotomistId && String(oldPhlebotomistId) === String(newPhlebotomistId)) {

            return res.status(400).json({ 

                success: false, 

                message: "This phlebotomist is already assigned to this booking." 

            });

        }
 
        // 2. Naye phlebotomist ki verification

        const newDriver = await Driver.findOne({ _id: newPhlebotomistId, vendorId: labId });

        if (!newDriver) {

            return res.status(404).json({ success: false, message: "New phlebotomist not found or unauthorized." });

        }
 
        if (newDriver.status === 'Offline') {

            return res.status(400).json({ success: false, message: "New phlebotomist is offline." });

        }
 
        // 3. Database Updates tayyar karein

        const updateFields = {

            phlebotomistId: newPhlebotomistId,

            status: 'Phlebotomist Assigned',

            // Reset tracking timestamps kyunki naya driver naye sire se shuru karega

            startedAt: null,

            arrivedAt: null,

            collectedAt: null

        };
 
        // Agar purana driver assign tha, toh use 'rejectedBy' history array me push karein

        const updateQuery = {

            $set: updateFields

        };
 
        if (oldPhlebotomistId) {

            updateQuery.$addToSet = { rejectedBy: oldPhlebotomistId };

        }
 
        // 4. Booking update execute karein

        const updatedBooking = await LabBooking.findByIdAndUpdate(

            orderId,

            updateQuery,

            { new: true }

        );
 
        // 5. Naye driver ko 'Busy' mark karein

        newDriver.status = 'Busy';

        await newDriver.save();
 
        // 6. Purane driver ka status manage karein

        if (oldPhlebotomistId) {

            // Check karein kya purane driver ke paas koi aur active booking abhi chal rahi hai

            const activeBookingsForOldDriver = await LabBooking.countDocuments({

                phlebotomistId: oldPhlebotomistId,

                status: { $in: ['Phlebotomist Assigned', 'Sample Collected', 'Sample Deposited'] }

            });
 
            // Agar koi active task nahi bacha, toh purane driver ko wapas 'Available' mark kar dein

            if (activeBookingsForOldDriver === 0) {

                await Driver.findByIdAndUpdate(oldPhlebotomistId, { status: 'Available' });

            }

        }
 
        res.json({

            success: true,

            message: "Phlebotomist re-assigned successfully.",

            data: updatedBooking

        });
 
    } catch (error) {

        res.status(500).json({ success: false, message: error.message });

    }

};

// =======================================================

// GET LIVE TRACKING DETAILS FOR MODAL POPUP

// =======================================================

// Endpoint: GET /provider/labs/booking-tracking/:orderId

const getBookingTrackingDetails = async (req, res) => {

    try {

        const { orderId } = req.params;

        const labId = req.user.id;
 
        // Fetch booking and populate user and driver details

        const booking = await LabBooking.findOne({ _id: orderId, labId })

            .populate('userId', 'name phone email profilePic')

            .populate('phlebotomistId', 'name phone profilePic status');
 
        if (!booking) {

            return res.status(404).json({ 

                success: false, 

                message: "Lab booking not found." 

            });

        }
 
        // Address string compile karein (Figma ui representation ke liye)

        const addr = booking.address;

        const formattedAddress = addr 

            ? `${addr.houseNo ? addr.houseNo + ', ' : ''}${addr.sector ? addr.sector + ', ' : ''}${addr.landmark ? addr.landmark + ', ' : ''}${addr.city || ''}, ${addr.state || ''} - ${addr.pincode || ''}`

            : "Address Details Not Found";
 
        // Patient details determine karein

        // Pehle patients array se main primary details nikalein

        const primaryPatientName = booking.patients?.[0]?.name || booking.userId?.name || "Patient";

        const primaryPatientPhone = booking.address?.phone || booking.userId?.phone || "N/A";
 
        // Live Tracking Stubs (ETA/Distance dynamic placeholders)

        // Note: Real routing algorithms na hone par standard fallback values render karein

        const liveTrackingStats = {

            distance: booking.startedAt && !booking.arrivedAt ? "3.2 km" : "0.0 km",

            eta: booking.startedAt && !booking.arrivedAt ? "25 mins" : "0 mins"

        };
 
        // Timeline Builder Array

        const timeline = [

            {

                step: "Booking Assigned",

                completed: !!booking.phlebotomistId,

                timestamp: booking.phlebotomistId ? booking.updatedAt : null,

                description: "Staff allocation recorded."

            },

            {

                step: "On the Way",

                completed: !!booking.startedAt,

                timestamp: booking.startedAt,

                description: "Phlebotomist is in-transit to patient location."

            },

            {

                step: "Arrived at Location",

                completed: !!booking.arrivedAt,

                timestamp: booking.arrivedAt,

                description: "Field phlebotomist arrived at destination."

            },

            {

                step: "Sample Collected",

                completed: !!booking.collectedAt,

                timestamp: booking.collectedAt,

                description: "Diagnostics samples collected successfully."

            },

            {

                step: "Sample Deposited",

                completed: !!booking.depositedAt,

                timestamp: booking.depositedAt,

                description: "Samples deposited at processing lab hub."

            }

        ];
 
        // Output Structure matches the popup exactly

        res.status(200).json({

            success: true,

            data: {

                orderId: booking.bookingId,

                status: booking.status,

                bookingType: booking.bookingType,

                collectionType: booking.collectionType,

                amount: booking.billSummary?.totalAmount || 0,

                // Dispatched Field Nurse equivalent

                phlebotomist: booking.phlebotomistId ? {

                    id: booking.phlebotomistId._id,

                    name: booking.phlebotomistId.name,

                    phone: booking.phlebotomistId.phone,

                    profilePic: booking.phlebotomistId.profilePic || null,

                    status: booking.phlebotomistId.status || "Busy"

                } : null,
 
                // Live Tracking Distance & Duration Card

                liveTracking: liveTrackingStats,
 
                // Patient Details Section

                patientDetails: {

                    name: primaryPatientName,

                    phone: primaryPatientPhone,

                    address: formattedAddress,

                    patientsCount: booking.patients?.length || 1

                },
 
                // Service Timeline Tracker Card

                timeline: timeline

            }

        });
 
    } catch (error) {

        console.error("Error in getBookingTrackingDetails:", error.message);

        res.status(500).json({ success: false, message: error.message });

    }

};

// =======================================================
// GET SINGLE PHLEBOTOMIST DETAIL WITH ACTIVE PATIENT INFO
// =======================================================
// Endpoint: GET /provider/labs/phlebotomist-detail/:phlebotomistId
const getPhlebotomistActiveDetail = async (req, res) => {
    try {
        const { phlebotomistId } = req.params;
        const labId = req.user.id;
 
        // 1. Phlebotomist details fetch karein aur verify karein ki yeh usi lab ka hai
        const phlebotomist = await Driver.findOne({ _id: phlebotomistId, vendorId: labId });
        if (!phlebotomist) {
            return res.status(404).json({
                success: false,
                message: "Phlebotomist not found or unauthorized."
            });
        }
 
        // Base response tayyar karein (Driver profile)
        const responseData = {
            phlebotomist: {
                id: phlebotomist._id,
                name: phlebotomist.name,
                phone: phlebotomist.phone,
                status: phlebotomist.status,
                profilePic: phlebotomist.profilePic || null,
                vehicleNumber: phlebotomist.vehicleNumber || null,
                vehicleType: phlebotomist.vehicleType || null,
                address: phlebotomist.address || null
            },
            activeBooking: null // By default isko null rakhenge
        };
 
        // 2. Agar driver 'Busy' hai, toh unka active task aur patient details fetch karein
        if (phlebotomist.status === 'Busy') {
            const activeBooking = await LabBooking.findOne({
                phlebotomistId: phlebotomistId,
                // Active task statuses jab tak sample lab me deposit nahi ho jata
                status: { $in: ['Phlebotomist Assigned', 'Sample Collected'] }
            }).populate('userId', 'name phone email');
 
            if (activeBooking) {
                const addr = activeBooking.address;
                const formattedAddress = addr
                    ? `${addr.houseNo ? addr.houseNo + ', ' : ''}${addr.sector ? addr.sector + ', ' : ''}${addr.landmark ? addr.landmark + ', ' : ''}${addr.city || ''}, ${addr.state || ''} - ${addr.pincode || ''}`
                    : "Address Details N/A";
 
                const primaryPatientName = activeBooking.patients?.[0]?.name || activeBooking.userId?.name || "Patient";
                const primaryPatientPhone = activeBooking.address?.phone || activeBooking.userId?.phone || "N/A";
 
                responseData.activeBooking = {
                    bookingMongoId: activeBooking._id,
                    bookingId: activeBooking.bookingId, // custom code string
                    bookingType: activeBooking.bookingType,
                    status: activeBooking.status,
                    amount: activeBooking.billSummary?.totalAmount || 0,
                    appointmentDate: activeBooking.appointmentDate,
                    appointmentTime: activeBooking.appointmentTime,
                    patientDetails: {
                        name: primaryPatientName,
                        phone: primaryPatientPhone,
                        address: formattedAddress,
                        patientsCount: activeBooking.patients?.length || 1
                    },
                    // Visual map rendering ya tracking timeline ke liye timestamps
                    timeline: {
                        startedAt: activeBooking.startedAt,
                        arrivedAt: activeBooking.arrivedAt,
                        collectedAt: activeBooking.collectedAt
                    }
                };
            }
        }
 
        res.status(200).json({
            success: true,
            data: responseData
        });
 
    } catch (error) {
        console.error("Error in getPhlebotomistActiveDetail:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

 const labWalkInNoShow = async (req, res) => {
    try {
        const { orderId, comments } = req.body;
        const labId = req.user.id;

        const booking = await LabBooking.findOne({ 
            _id: orderId, 
            labId, 
            collectionType: 'Visit Lab',
            status: { $in: ['Confirmed', 'Pending'] } 
        });

        if (!booking) {
            return res.status(404).json({ success: false, message: "Active walk-in booking record not found." });
        }

        const totalPaid = booking.billSummary?.totalAmount || 0;
        let noShowFee = 0;

        const config = await NoShowConfig.findOne({ vendorType: 'Lab', isActive: true });
        if (config && config.chargeValue > 0) {
            noShowFee = config.chargeType === 'Percentage'
                ? Math.round((totalPaid * config.chargeValue) / 100)
                : Math.min(config.chargeValue, totalPaid);
        }

        booking.status = 'No-Show';
        if (!booking.billSummary) booking.billSummary = {};
        booking.billSummary.noShowFeeApplied = noShowFee;
        booking.paymentStatus = noShowFee > 0 ? 'Refund-Initiated' : 'Refunded';
        booking.noShowComments = comments || "Patient did not arrive at physical lab desk.";

        await booking.save();

        res.json({ 
            success: true, 
            message: "Walk-In No-Show registered successfully. Refund initiated.", 
            noShowFeeApplied: noShowFee,
            data: booking
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};




module.exports = { 
    getLabStats, 
    getOrders, 
    handleOrderAction, 
    assignStaff, 
    updateProgressStatus, 
    uploadReport ,

    // New endpoints
    getReportData,            
    uploadClientGeneratedPDF,  
    getReportTemplates,
    getReportTemplatesDropdown, // 👈 Added
    getReportTemplatesForBooking, // 👈 Added
    saveDraftResults, // 👈 Added
    getDraftResults, // 👈 Added
    getLabOrderHistory,


    // Prescription Flow endpoints
    getProviderLabPrescriptionRequests,
    getProviderLabPrescriptionRequestDetails,
    startLabPrescriptionReview,
    submitLabReviewBill,
    rejectLabPrescriptionRequest,
    getAvailablePhlebotomists,              
    reassignDriverStaff   ,
    getBookingTrackingDetails,
    getPhlebotomistActiveDetail,
    labWalkInNoShow
    
 
};