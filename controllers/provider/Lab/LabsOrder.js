// controllers/provider/Lab/LabsOrder.js
const LabBooking = require('../../../models/LabBooking');
const Wallet = require('../../../models/Wallet');
const MasterReportTemplate = require('../../../models/MasterReportTemplate');
const LabPrescriptionRequest = require('../../../models/LabPrescriptionRequest'); 
const MasterLabTest = require('../../../models/MasterLabTest'); 
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { sendPushNotification } = require('../../../utils/notification'); 
const { deleteFile } = require('../../../utils/fileHandler');
const NoShowConfig = require('../../../models/NoShowConfig');


// @desc    Get Lab Provider Dashboard Stats (Includes in-transit & delivered sample counters)
// @route   GET /provider/labs/dashboard
// @access  Private (Lab)
const getLabStats = async (req, res) => {
    try {
        const labId = req.user.id;

        const [
            totalOrders,
            pendingOrders,
            inTransitSamples,
            inLabTesting,
            completedOrders,
            revenueData
        ] = await Promise.all([
            LabBooking.countDocuments({ labId }),
            LabBooking.countDocuments({ labId, status: { $in: ['Pending', 'Confirmed'] } }),
            
            // 🚨 BUG FIX: Accurately count samples currently on the way to lab
            LabBooking.countDocuments({ 
                labId, 
                status: { $in: ['Sample Collected', 'Sample on the way to lab'] } 
            }),

            // 🚨 BUG FIX: Accurately count samples delivered at lab & under testing
            LabBooking.countDocuments({ 
                labId, 
                status: { $in: ['Sample Delivered to Lab', 'Sample Deposited', 'Testing', 'Report Generated'] } 
            }),

            LabBooking.countDocuments({ labId, status: 'Completed' }),

            LabBooking.aggregate([
                { $match: { labId: new mongoose.Types.ObjectId(labId), status: 'Completed' } },
                { $group: { _id: null, total: { $sum: "$totalPrice" } } }
            ])
        ]);

        const totalRevenue = revenueData.length > 0 ? revenueData[0].total : 0;

        res.status(200).json({
            success: true,
            data: {
                totalOrders,
                pendingOrders,
                inTransitSamples,    // 👈 Samples currently on the way
                inLabTesting,        // 👈 Samples received at lab & testing
                completedOrders,
                totalRevenue
            }
        });
    } catch (error) {
        console.error("Get Lab Stats Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get Lab Orders with Status Filters (Preserves visibility in transit & in lab)
// @route   GET /provider/labs/orders
// @access  Private (Lab)
const getOrders = async (req, res) => {
    try {
        const labId = req.user.id;
        const { status, tab, priority, page = 1, limit = 20 } = req.query;

        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 20;
        const skip = (pageNum - 1) * limitNum;

        let query = { labId };

        // 🚨 BUG FIX: Map both new statuses into the vendor Active / Testing tabs
        if (tab === 'Active' || tab === 'In-Progress') {
            query.status = { 
                $in: [
                    'Confirmed', 
                    'Phlebotomist Assigned', 
                    'Arrived', 
                    'Sample Collected', 
                    'Sample on the way to lab', 
                    'Sample Delivered to Lab', 
                    'Sample Deposited', 
                    'Testing', 
                    'Report Generated'
                ] 
            };
        } else if (tab === 'In-Lab') {
            // Samples that arrived at lab and are ready for analyzer
            query.status = { $in: ['Sample Delivered to Lab', 'Sample Deposited', 'Testing', 'Report Generated'] };
        } else if (tab === 'Completed') {
            query.status = 'Completed';
        } else if (tab === 'Cancelled') {
            query.status = { $in: ['Cancelled', 'No-Show'] };
        } else if (status && status !== 'All') {
            query.status = status;
        }

        if (priority === 'Rapid') {
            query['billSummary.rapidDeliveryCharge'] = { $gt: 0 };
        }

        const [total, orders] = await Promise.all([
            LabBooking.countDocuments(query),
            LabBooking.find(query)
                .populate('userId', 'name phone email profilePic')
                .populate('phlebotomistId', 'name phone vehicleNumber vehicleType status location')
                .populate('items.tests.testId', 'testName sampleType discountPrice amount')
                .populate('items.packages.packageId', 'packageName offerPrice mrp')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean()
        ]);

        res.status(200).json({
            success: true,
            total,
            count: orders.length,
            currentPage: pageNum,
            totalPages: Math.ceil(total / limitNum),
            data: orders
        });
    } catch (error) {
        console.error("Get Lab Orders Error:", error);
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
                message: "Phlebotomist ID and Order ID are required." 
            });
        }

        const phlebotomistObjectId = new mongoose.Types.ObjectId(phlebotomistId);
        const labObjectId = new mongoose.Types.ObjectId(labId);
        const orderObjectId = new mongoose.Types.ObjectId(orderId);

        const driver = await Driver.findOne({ 
            _id: phlebotomistObjectId, 
            vendorId: labObjectId,
            vendorType: 'Lab'
        });

        if (!driver || driver.status === 'Offline') {
            return res.status(400).json({ 
                success: false, 
                message: "Phlebotomist not found or is currently Offline." 
            });
        }

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

        if (!booking) return res.status(404).json({ success: false, message: "Order not found" });

        await Driver.findByIdAndUpdate(phlebotomistObjectId, { $set: { status: 'Busy' } });

        // 🚨 FCM PUSH NOTIFICATION: Alert Driver on New Task
        await sendPushNotification(
            phlebotomistId,
            'driver',
            "New Lab Sample Collection Assigned!",
            `You have been assigned order #${booking.bookingId}. Tap to view details.`,
            { orderId: booking._id.toString(), type: 'lab_collection_task' }
        );

        res.json({ 
            success: true, 
            message: "Phlebotomist assigned successfully", 
            data: booking 
        });

    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// @desc    Lab Provider updates test progress status ('Sample Delivered to Lab', 'Testing', 'Report Generated')
// @route   PATCH /provider/labs/update-progress/:orderId
// @access  Private (Lab)
const updateProgressStatus = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status } = req.body;
        const labId = req.user.id;

        const validStatuses = [
            'Sample on the way to lab',
            'Sample Delivered to Lab',
            'Sample Deposited',
            'Testing',
            'Report Generated',
            'Completed'
        ];

        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({ 
                success: false, 
                message: `Invalid status. Allowed values: ${validStatuses.join(', ')}` 
            });
        }

        const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
        const query = {
            labId,
            ...(isObjectId ? { _id: orderId } : { bookingId: orderId })
        };

        const booking = await LabBooking.findOne(query).populate('userId', 'name phone fcmToken');
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found or unauthorized." });
        }

        booking.status = status;
        if (status === 'Sample Delivered to Lab') {
            booking.sampleDeliveredToLabAt = new Date();
        }
        await booking.save();

        const labName = req.user?.name || "Diagnostic Lab";

        // Patient Notification
        if (booking.userId) {
            try {
                let title = `🔬 Lab Testing Update: ${booking.bookingId}`;
                let message = `Your sample status is now: ${status}`;

                if (status === 'Testing') {
                    title = `🧪 Testing in Progress: ${booking.bookingId}`;
                    message = `${labName} has started processing and analyzing your test samples.`;
                } else if (status === 'Report Generated') {
                    title = `📄 Report Ready: ${booking.bookingId}`;
                    message = `Diagnostic findings for ${booking.bookingId} have been recorded. Final report uploading shortly.`;
                }

                await sendPushNotification(
                    booking.userId._id,
                    'user',
                    title,
                    message,
                    {
                        type: 'LAB_PROGRESS_UPDATE',
                        serviceType: 'Lab',
                        bookingId: String(booking.bookingId),
                        status: String(status),
                        click_action: 'FLUTTER_NOTIFICATION_CLICK'
                    }
                );
            } catch (e) {
                console.error("Lab Progress Push Error:", e.message);
            }
        }

        res.status(200).json({ 
            success: true, 
            message: `Booking progress updated to '${status}'.`, 
            data: booking 
        });

    } catch (error) {
        console.error("Update Progress Status Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Upload Diagnostic Report PDF for Specific Patient (Multi-Patient Safe)
// @route   POST /provider/labs/upload-report/:orderId
// @access  Private (Lab)
const uploadReport = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { patientId } = req.body; // Target patient identifier (e.g. 'Self' or family member ID)
        const labId = req.user.id;

        if (!req.file && (!req.files || req.files.length === 0)) {
            return res.status(400).json({ success: false, message: "Please upload a valid report PDF/image file." });
        }

        const uploadedFilePath = req.file ? req.file.path.replace(/\\/g, "/") : req.files[0].path.replace(/\\/g, "/");

        const booking = await LabBooking.findOne({ _id: orderId, labId });
        if (!booking) {
            return res.status(404).json({ success: false, message: "Lab booking not found or unauthorized." });
        }

        const targetPatientId = patientId ? String(patientId).trim() : (booking.patients[0]?.patientId || "Self");

        // 1. Update individual patient subdocument report
        const patientIndex = booking.patients.findIndex(p => String(p.patientId) === targetPatientId);
        let targetPatientName = "Patient";

        if (patientIndex > -1) {
            booking.patients[patientIndex].medicalReport = uploadedFilePath;
            targetPatientName = booking.patients[patientIndex].name;
        }

        // 2. Push or Update inside patientReports array
        if (!Array.isArray(booking.patientReports)) {
            booking.patientReports = [];
        }

        const reportEntryIndex = booking.patientReports.findIndex(pr => String(pr.patientId) === targetPatientId);
        if (reportEntryIndex > -1) {
            booking.patientReports[reportEntryIndex].reportFile = uploadedFilePath;
            booking.patientReports[reportEntryIndex].patientName = targetPatientName;
        } else {
            booking.patientReports.push({
                patientId: targetPatientId,
                patientName: targetPatientName,
                reportFile: uploadedFilePath
            });
        }

        // Backward compatibility fallback for single report view
        booking.reportFile = uploadedFilePath;

        // 3. Strict Check: Are all patients' reports uploaded?
        const totalPatientsCount = booking.patients.length;
        const reportsCount = booking.patientReports.length;

        if (reportsCount >= totalPatientsCount) {
            booking.status = 'Completed'; // All reports delivered!
        } else {
            booking.status = 'Report Generated'; // Partial reports uploaded, wait for remaining
        }

        await booking.save();

        // 4. Notify Patient App
        if (booking.userId) {
            try {
                const isAllDone = booking.status === 'Completed';
                const notifTitle = isAllDone ? "🎉 Diagnostic Reports Ready!" : "📄 New Test Report Uploaded";
                const notifMsg = isAllDone 
                    ? `All test reports for Booking #${booking.bookingId} have been uploaded and finalized.`
                    : `Report for ${targetPatientName} has been uploaded. Other reports are in progress.`;

                await sendPushNotification(
                    booking.userId,
                    'user',
                    notifTitle,
                    notifMsg,
                    { bookingId: booking._id.toString(), type: 'lab_report_uploaded' }
                );
            } catch (e) {}
        }

        return res.status(200).json({
            success: true,
            message: `Report for ${targetPatientName} uploaded successfully. (${reportsCount}/${totalPatientsCount} completed)`,
            bookingStatus: booking.status,
            patientReports: booking.patientReports,
            data: booking
        });

    } catch (error) {
        console.error("Upload Lab Report Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};


// 7. GET REPORT TEMPLATES (Strict Test List with Optional Gender Filter)
// endpoint: GET /provider/labs/report-templates?testNames=CBC,LFT&gender=Female
const getReportTemplates = async (req, res) => {
    try {
        const { testNames, gender } = req.query;
        
        if (!testNames) {
            return res.status(400).json({ 
                success: false, 
                message: "Query parameter 'testNames' (comma-separated list) is required." 
            });
        }

        const requestedList = testNames.split(',').map(name => name.trim());
        const targetGender = gender || 'Both';
        
        const query = {
            testName: { $in: requestedList },
            $or: [
                { gender: targetGender },
                { gender: 'Both' }
            ]
        };

        const templates = await MasterReportTemplate.find(query).lean();

        // Specific gender takes precedence over 'Both'
        templates.sort((a, b) => (a.gender === 'Both' ? -1 : 1));

        const formattedTemplates = {};
        templates.forEach(t => {
            formattedTemplates[t.testName] = {
                genderApplied: t.gender,
                interpretation: t.parameters?.[0]?.interpretation || "",
                parameters: t.parameters
            };
        });

        res.json({ 
            success: true, 
            count: Object.keys(formattedTemplates).length, 
            genderRequested: targetGender,
            data: formattedTemplates 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// 8. GET REPORT TEMPLATES FOR DROPDOWN (Gender-Aware Display with Limit 50)
// endpoint: GET /provider/labs/report-templates/dropdown?search=...
const getReportTemplatesDropdown = async (req, res) => {
    try {
        const { search } = req.query;

        let query = {};
        if (search) {
            query.testName = { $regex: search, $options: 'i' };
        }

        // 🚨 Select both testName & gender for accurate LIMS manual selection
        const templates = await MasterReportTemplate.find(query)
            .select('testName gender')
            .sort({ testName: 1, gender: 1 })
            .limit(50)
            .lean();

        const formattedDropdown = templates.map(t => ({
            _id: t._id,
            testName: t.testName,
            gender: t.gender || 'Both',
            displayName: t.gender && t.gender !== 'Both' 
                ? `${t.testName} (${t.gender})` 
                : t.testName
        }));

        res.json({ 
            success: true, 
            count: formattedDropdown.length, 
            data: formattedDropdown 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// 7. GET REPORT DATA (Frontend PDF rendering data engine with mainCategory / Department metadata)
// endpoint: GET /provider/labs/get-report-data/:orderId?patientId=...
const getReportData = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { patientId } = req.query;
        // Fetch Booking with populated Lab profile
        const booking = await LabBooking.findById(orderId).populate('labId').lean();
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found." });
        }

        // 1. Target Patient Resolver
        let targetPatient = null;
        if (patientId && booking.patients && booking.patients.length > 0) {
            targetPatient = booking.patients.find(p => 
                String(p.patientId) === String(patientId) || 
                String(p._id) === String(patientId) ||
                (String(patientId).toLowerCase() === 'self' && p.relation === 'Self')
            );
        }
        if (!targetPatient && booking.patients && booking.patients.length > 0) {
            targetPatient = booking.patients[0];
        }

        // 2. Fetch specific draft values partitioned by patientId
        let testResults = null;
        if (booking.testResults) {
            if (patientId && booking.testResults[patientId]) {
                testResults = booking.testResults[patientId];
            } else {
                const keys = Object.keys(booking.testResults);
                testResults = keys.length > 0 ? booking.testResults[keys[0]] : booking.testResults;
            }
        }

        // 3. Extract actual values and attach mainCategory to testResults
        if (testResults) {
            const draftList = Array.isArray(testResults) ? testResults : (testResults.values || []);
            const testNamesInReport = draftList.map(t => t.testName);

            const masterTests = await MasterLabTest.find({
                testName: { $in: testNamesInReport }
            }).select('testName mainCategory category').lean();

            const catMap = {};
            masterTests.forEach(mt => {
                catMap[mt.testName] = {
                    mainCategory: mt.mainCategory || 'Pathology',
                    category: mt.category || 'General'
                };
            });

            // Inject mainCategory into each group for PDF Rendering
            draftList.forEach(group => {
                group.mainCategory = catMap[group.testName]?.mainCategory || 'Pathology';
                group.department = `Department of ${group.mainCategory}`;
                group.category = catMap[group.testName]?.category || 'General';
            });
        }

        // 4. Conditional Address String Builder
        let reportCollectionAddress = null;
        if (booking.collectionType === 'Home Collection') {
            const addr = booking.address;
            if (addr) {
                reportCollectionAddress = [
                    addr.houseNo,
                    addr.sector,
                    addr.landmark,
                    addr.city,
                    addr.state,
                    addr.pincode ? `- ${addr.pincode}` : ''
                ]
                .filter(part => part && String(part).trim() !== '')
                .join(', ')
                .replace(', -', ' -');
            } else {
                reportCollectionAddress = "Home Collection (Address Details Missing)";
            }
        } else {
            reportCollectionAddress = "Walk-In (Visit Lab)";
        }

        res.json({
            success: true,
            data: {
                bookingId: booking.bookingId,
                appointmentId: booking._id,
                appointmentDate: booking.appointmentDate,
                barcode: booking.barcode || "E4708538",
                collectionType: booking.collectionType,
                collectionAddress: reportCollectionAddress,
                labName: booking.labId?.name || "HealthKangaroo Labs",
                labAddress: `${booking.labId?.city || ''}, ${booking.labId?.state || ''}`,
                currentPatient: targetPatient ? {
                    patientId: targetPatient.patientId || targetPatient._id || "Self",
                    name: targetPatient.name,
                    age: targetPatient.age || 30,
                    gender: targetPatient.gender || "Both",
                    relation: targetPatient.relation || "Self"
                } : null,
                patients: booking.patients, 
                testResults: testResults 
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// @desc    Upload Compiled Client-Side Smart Report PDF (Multi-Patient Safe)
// @route   POST /provider/labs/upload-client-pdf/:orderId
// @access  Private (Lab)
const uploadClientGeneratedPDF = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { patientId } = req.body;
        const labId = req.user.id;

        if (!req.file) {
            return res.status(400).json({ success: false, message: "PDF reportFile is required." });
        }

        const cleanPdfPath = req.file.path.replace(/\\/g, "/");

        const booking = await LabBooking.findOne({ _id: orderId, labId });
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found or unauthorized access." });
        }

        const targetPatientId = patientId ? String(patientId).trim() : (booking.patients[0]?.patientId || "Self");

        const patientIndex = booking.patients.findIndex(p => String(p.patientId) === targetPatientId);
        let targetPatientName = "Patient";

        if (patientIndex > -1) {
            booking.patients[patientIndex].medicalReport = cleanPdfPath;
            targetPatientName = booking.patients[patientIndex].name;
        }

        if (!Array.isArray(booking.patientReports)) {
            booking.patientReports = [];
        }

        const reportEntryIndex = booking.patientReports.findIndex(pr => String(pr.patientId) === targetPatientId);
        if (reportEntryIndex > -1) {
            booking.patientReports[reportEntryIndex].reportFile = cleanPdfPath;
            booking.patientReports[reportEntryIndex].patientName = targetPatientName;
        } else {
            booking.patientReports.push({
                patientId: targetPatientId,
                patientName: targetPatientName,
                reportFile: cleanPdfPath
            });
        }

        booking.reportFile = cleanPdfPath;

        const totalPatientsCount = booking.patients.length;
        const reportsCount = booking.patientReports.length;

        if (reportsCount >= totalPatientsCount) {
            booking.status = 'Completed';
        } else {
            booking.status = 'Report Generated';
        }

        await booking.save();

        if (booking.userId) {
            try {
                await sendPushNotification(
                    booking.userId,
                    'user',
                    "📄 Smart Report Compiled!",
                    `Diagnostic Smart Report for ${targetPatientName} has been compiled and is ready to view.`,
                    { bookingId: booking._id.toString(), type: 'lab_report_uploaded' }
                );
            } catch (e) {}
        }

        return res.status(200).json({
            success: true,
            message: `Smart Report for ${targetPatientName} compiled successfully!`,
            reportUrl: cleanPdfPath,
            bookingStatus: booking.status,
            patientReports: booking.patientReports
        });

    } catch (error) {
        console.error("Upload Client PDF Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};


// 10. AUTO-RESOLVE TEMPLATES FOR SPECIFIC BOOKING (With Gender & Category/Department Binding)
// endpoint: GET /provider/labs/report-templates/booking/:orderId?patientId=...
const getReportTemplatesForBooking = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { patientId } = req.query; // Partitioned by active patient
        const booking = await LabBooking.findById(orderId)
            .populate({
                path: 'items.packages.packageId',
                populate: {
                    path: 'tests',
                    model: 'MasterLabTest',
                    select: 'testName mainCategory category'
                }
            });

        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found." });
        }

        // 1. Detect patient's gender from booking.patients array
        let detectedGender = 'Both';
        if (booking.patients && booking.patients.length > 0) {
            let patient = null;
            if (patientId) {
                patient = booking.patients.find(p => 
                    String(p.patientId) === String(patientId) || 
                    String(p._id) === String(patientId) ||
                    (String(patientId).toLowerCase() === 'self' && p.relation === 'Self')
                );
            }
            if (!patient) {
                patient = booking.patients[0];
            }

            if (patient && patient.gender) {
                const g = String(patient.gender).trim().toLowerCase();
                if (g === 'male' || g === 'm') detectedGender = 'Male';
                else if (g === 'female' || g === 'f') detectedGender = 'Female';
            }
        }

        // 2. Extract standalone tests and package-included tests
        const testNames = (booking.items?.tests || []).map(t => t.name);
        const packageTestNames = [];
        if (booking.items?.packages) {
            booking.items.packages.forEach(p => {
                if (p.packageId && p.packageId.tests) {
                    p.packageId.tests.forEach(nt => {
                        packageTestNames.push(nt.testName);
                    });
                }
            });
        }

        const allBookedNames = [...testNames, ...packageTestNames];

        // Fuzzy regex matching fallback
        const regexQueries = allBookedNames.map(name => {
            const cleanName = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').trim();
            const words = cleanName.split(/\s+/).filter(w => w.length > 2);
            return new RegExp(words.join('.*'), 'i');
        });

        // 3. Fetch MasterLabTest details to get mainCategory & subcategory mapping
        const masterTests = await MasterLabTest.find({
            $or: [
                { testName: { $in: allBookedNames } },
                { testName: { $in: regexQueries } }
            ]
        }).select('testName mainCategory category sampleType').lean();

        const masterCategoryMap = {};
        masterTests.forEach(mt => {
            masterCategoryMap[mt.testName] = {
                mainCategory: mt.mainCategory || 'Pathology',
                category: mt.category || 'General',
                sampleType: mt.sampleType || 'Blood'
            };
        });

        // 4. Query Master Report Templates matching test names & preferred gender
        const templates = await MasterReportTemplate.find({
            $and: [
                {
                    $or: [
                        { testName: { $in: allBookedNames } },
                        { testName: { $in: regexQueries } }
                    ]
                },
                {
                    $or: [
                        { gender: detectedGender },
                        { gender: 'Both' }
                    ]
                }
            ]
        }).lean();

        // Specific gender takes precedence over 'Both'
        templates.sort((a, b) => (a.gender === 'Both' ? -1 : 1));

        const formattedTemplates = {};

        templates.forEach(t => {
            const meta = masterCategoryMap[t.testName] || {
                mainCategory: 'Pathology',
                category: 'General',
                sampleType: 'Blood'
            };

            formattedTemplates[t.testName] = {
                mainCategory: meta.mainCategory, // 👈 'Biochemistry', 'Pathology', 'Radiology', etc.
                category: meta.category,         // 👈 Subcategory e.g., 'Electrolytes', 'Lipids'
                sampleType: meta.sampleType,     // 👈 Sample type e.g., 'Blood', 'Urine'
                genderApplied: t.gender,
                interpretation: t.parameters?.[0]?.interpretation || "",
                parameters: t.parameters
            };
        });

        res.json({ 
            success: true, 
            count: Object.keys(formattedTemplates).length, 
            detectedPatientGender: detectedGender,
            data: formattedTemplates 
        });
    } catch (error) {
        console.error("getReportTemplatesForBooking Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Lab Technician saves observed test values draft in LIMS console
// @route   POST /provider/labs/save-draft/:orderId
// @access  Private (Lab)
const saveDraftResults = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { testValues, patientId } = req.body;
        const labId = req.user.id;

        const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
        const query = {
            labId,
            ...(isObjectId ? { _id: orderId } : { bookingId: orderId })
        };

        const booking = await LabBooking.findOne(query);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking record not found or unauthorized." });
        }

        // 🚨 BUG FIX: Allow drafting as soon as sample is delivered to lab or in testing
        const allowedDraftStatuses = [
            'Sample Delivered to Lab',
            'Sample Deposited',
            'Testing',
            'Report Generated'
        ];

        // If sample has reached lab, auto-transition to 'Testing' on first draft input
        if (booking.status === 'Sample Delivered to Lab' || booking.status === 'Sample Deposited') {
            booking.status = 'Testing';
        } else if (!allowedDraftStatuses.includes(booking.status)) {
            return res.status(400).json({ 
                success: false, 
                message: `Cannot enter test results. Sample must be delivered to lab first (Current Status: '${booking.status}').` 
            });
        }

        if (!booking.testResults) {
            booking.testResults = {};
        }

        const targetPatientKey = patientId || "default";
        booking.testResults[targetPatientKey] = testValues;
        booking.markModified('testResults');
        await booking.save();

        res.status(200).json({
            success: true,
            message: "Test results draft saved successfully in LIMS. Status updated to Testing.",
            status: booking.status,
            data: booking.testResults[targetPatientKey]
        });
    } catch (error) {
        console.error("Save Draft Results Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 5. FETCH SAVED DRAFT RESULTS (Partitioned by Patient ID)
// endpoint: GET /provider/labs/get-draft/:orderId?patientId=...
const getDraftResults = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { patientId } = req.query;

        if (!patientId) {
            return res.status(400).json({ success: false, message: "Query parameter 'patientId' is required." });
        }

        const booking = await LabBooking.findById(orderId).lean();
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found." });
        }

        const rawDraft = booking.testResults ? booking.testResults[patientId] : null;

        // Backward compatibility: If draft is an array (old schema) or object (new schema)
        let draftValues = null;
        let genderApplied = 'Both';

        if (rawDraft) {
            if (Array.isArray(rawDraft)) {
                draftValues = rawDraft;
            } else if (rawDraft.values) {
                draftValues = rawDraft.values;
                genderApplied = rawDraft.genderApplied || 'Both';
            }
        }

        res.json({ 
            success: true, 
            genderApplied,
            data: draftValues || null 
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

// @desc    Lab generates verified bill for prescription (Supports both custom requestId and MongoDB _id)
// @route   POST /provider/labs/prescription-request/review/:requestId
// @access  Private (Lab Provider)
const submitLabReviewBill = async (req, res) => {
    try {
        const { requestId } = req.params;
        const labId = req.user.id;
        const { items, deliveryCharge } = req.body;

        if (!requestId || String(requestId).trim() === "") {
            return res.status(400).json({ 
                success: false, 
                message: "Prescription requestId parameter is required in URL." 
            });
        }

        const cleanRequestId = String(requestId).trim();
        const isObjectId = mongoose.isValidObjectId(cleanRequestId);

        // 🚨 DUAL LOOKUP FIX: Searches by both MongoDB _id and custom requestId string
        const requestQuery = {
            labId,
            $or: [
                ...(isObjectId ? [{ _id: new mongoose.Types.ObjectId(cleanRequestId) }] : []),
                { requestId: cleanRequestId }
            ]
        };

        const request = await LabPrescriptionRequest.findOne(requestQuery);
        if (!request) {
            return res.status(404).json({
                success: false,
                message: `Prescription request '${cleanRequestId}' not found or you are not authorized to bill it.`
            });
        }

        // Status Guard
        if (request.status === 'Paid') {
            return res.status(400).json({
                success: false,
                message: "Cannot generate bill. This lab prescription request has already been paid."
            });
        }

        if (['Rejected', 'Cancelled', 'Expired'].includes(request.status)) {
            return res.status(400).json({
                success: false,
                message: `Cannot generate bill. Current status is already '${request.status}'.`
            });
        }

        // Multi-key fallback for frontend payload
        const rawItems = items || req.body.tests || req.body.requestedTests;
        let parsedItems = [];
        if (typeof rawItems === 'string') {
            try { parsedItems = JSON.parse(rawItems); } catch(e) { parsedItems = []; }
        } else if (Array.isArray(rawItems)) {
            parsedItems = rawItems;
        }

        if (!parsedItems || parsedItems.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Please provide valid test items in 'items' array with at least one test." 
            });
        }

        let itemTotal = 0;
        const verifiedItems = [];

        for (const item of parsedItems) {
            const qty = Number(item.quantity || 1);
            const price = Number(item.pricePerUnit || item.price || 0);
            const subtotal = price * qty;
            itemTotal += subtotal;

            verifiedItems.push({
                name: item.name || "Diagnostic Test",
                mrp: Number(item.mrp || price),
                pricePerUnit: price,
                quantity: qty,
                totalPrice: subtotal
            });
        }

        const totalAmount = itemTotal + Number(deliveryCharge || 0);

        request.verifiedBill = {
            items: verifiedItems,
            itemTotal,
            deliveryCharge: Number(deliveryCharge || 0),
            totalAmount: Math.round(totalAmount)
        };
        request.status = 'Bill Generated';
        await request.save();

        const labName = req.user?.name || "Diagnostic Lab";
        const testNames = verifiedItems.map(i => i.name).slice(0, 3).join(', ');
        const testsSummary = verifiedItems.length > 3 ? `${testNames} +${verifiedItems.length - 3} more` : testNames;

        // 🔔 Patient Notification
        if (request.userId) {
            try {
                await sendPushNotification(
                    request.userId,
                    'user',
                    `🧾 Lab Quotation Ready: ₹${Math.round(totalAmount)} (${labName})`,
                    `${labName} has generated your lab tests bill #${request.requestId} for [${testsSummary}]. Total bill is ₹${Math.round(totalAmount)}. Tap to review & pay.`,
                    { 
                        type: 'PRESCRIPTION_BILL_GENERATED',
                        serviceType: 'Lab',
                        requestId: String(request.requestId), 
                        id: String(request._id), 
                        totalAmount: String(Math.round(totalAmount)),
                        vendorName: String(labName),
                        itemCount: String(verifiedItems.length),
                        itemsSummary: String(testsSummary),
                        paymentRoute: '/lab/prescription-bill',
                        click_action: 'FLUTTER_NOTIFICATION_CLICK'
                    }
                );
            } catch (notifErr) {
                console.error("Lab Bill Notification Error:", notifErr.message);
            }
        }

        res.status(200).json({
            success: true,
            message: "Lab bill generated successfully and notification dispatched to patient.",
            data: request
        });

    } catch (error) {
        console.error("submitLabReviewBill Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Reject Lab Prescription Request by Vendor (Instantly frees the locked time slot and alerts patient)
// @route   POST /provider/labs/prescription-request/reject/:requestId
// @access  Private (Lab Provider)
const rejectLabPrescriptionRequest = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { reason } = req.body;
        const labId = req.user.id;

        if (!requestId) {
            return res.status(400).json({ success: false, message: "requestId parameter is required." });
        }

        // Support lookup by custom requestId (e.g. HK-LREQ-XXXX) or MongoDB ObjectId
        const isObjectId = mongoose.isValidObjectId(requestId);
        const query = {
            labId,
            ...(isObjectId ? { $or: [{ _id: requestId }, { requestId: String(requestId).trim() }] } : { requestId: String(requestId).trim() })
        };

        const request = await LabPrescriptionRequest.findOne(query);
        if (!request) {
            return res.status(404).json({ success: false, message: "Prescription inquiry record not found or unauthorized access." });
        }

        if (request.status === 'Paid') {
            return res.status(400).json({ 
                success: false, 
                message: "Cannot reject. This prescription has already been paid and converted into a confirmed lab booking." 
            });
        }

        if (request.status === 'Rejected') {
            return res.status(400).json({ 
                success: false, 
                message: "This prescription request has already been marked as Rejected." 
            });
        }

        // 🚨 CRITICAL STATE TRANSITION: Marking status as 'Rejected' automatically frees the time slot in getLabSlots engine
        request.status = 'Rejected';
        request.rejectReason = reason ? String(reason).trim() : "Prescription verification check failed / Reagents out of stock.";
        await request.save();

        // Send Real-time Push Notification to Patient
        if (request.userId) {
            try {
                await sendPushNotification(
                    request.userId,
                    'user',
                    "❌ Lab Prescription Request Rejected",
                    `Your prescription inquiry #${request.requestId} was rejected by the lab. Reason: "${request.rejectReason}". Please select another lab.`,
                    { requestId: request.requestId, type: 'lab_prescription_rejected' }
                );
            } catch (notifErr) {
                console.error("Patient Notification Error:", notifErr.message);
            }
        }

        res.status(200).json({
            success: true,
            message: "Prescription request has been rejected successfully. The booked time slot is now released and free for other users.",
            requestId: request.requestId,
            rejectReason: request.rejectReason,
            data: request
        });

    } catch (error) {
        console.error("Reject Lab Prescription Request Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 1. GET ALL ELIGIBLE PHLEBOTOMISTS FOR DROPDOWN / LIST
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

// 3. RE-ASSIGN PHLEBOTOMIST (Change Existing Driver)
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

// GET LIVE TRACKING DETAILS FOR MODAL POPUP
// Endpoint: GET /provider/labs/booking-tracking/:orderId

// @desc    Get Lab Booking Tracking Details for Provider Modal (9 Steps Lifecycle)
// @route   GET /provider/labs/booking-tracking/:orderId
// @access  Private (Lab)
const getBookingTrackingDetails = async (req, res) => {
    try {
        const { orderId } = req.params;
        const labId = req.user.id;

        const isObjectId = mongoose.isValidObjectId(orderId);
        const query = {
            labId,
            ...(isObjectId ? { _id: orderId } : { bookingId: orderId })
        };

        const booking = await LabBooking.findOne(query)
            .populate('userId', 'name phone email profilePic')
            .populate('phlebotomistId', 'name phone vehicleNumber status location profilePic')
            .lean();

        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found." });
        }

        const statusHierarchy = {
            'Confirmed': 1,
            'Phlebotomist Assigned': 2,
            'Arrived': 3,
            'Sample Collected': 4,
            'Sample on the way to lab': 5,
            'Sample In-Transit': 5,
            'Sample Delivered to Lab': 6,
            'Sample Deposited': 6,
            'Testing': 7,
            'Report Generated': 8,
            'Completed': 9
        };

        const currentStep = statusHierarchy[booking.status] || 1;

        const steps = [
            { title: "Order Confirmed", step: 1, key: "Confirmed" },
            { title: "Phlebotomist Assigned", step: 2, key: "Phlebotomist Assigned" },
            { title: "Arrived at Location", step: 3, key: "Arrived" },
            { title: "Sample Collected", step: 4, key: "Sample Collected" },
            { title: "Sample on the way to lab", step: 5, key: "Sample on the way to lab" },
            { title: "Sample Delivered to Lab", step: 6, key: "Sample Delivered to Lab" },
            { title: "Testing in Progress", step: 7, key: "Testing" },
            { title: "Report Generated", step: 8, key: "Report Generated" },
            { title: "Completed", step: 9, key: "Completed" }
        ].map(s => ({
            ...s,
            isCompleted: currentStep >= s.step,
            isCurrent: currentStep === s.step
        }));

        res.status(200).json({
            success: true,
            data: {
                ...booking,
                currentStep,
                totalSteps: 9,
                lifecycleProgress: steps
            }
        });
    } catch (error) {
        console.error("Get Booking Tracking Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET SINGLE PHLEBOTOMIST DETAIL WITH ACTIVE PATIENT INFO
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
    getReportTemplatesDropdown,
    getReportTemplatesForBooking,
    saveDraftResults,
    getDraftResults,
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