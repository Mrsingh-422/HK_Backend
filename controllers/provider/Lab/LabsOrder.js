// controllers/provider/Lab/LabsOrder.js

const LabBooking = require('../../../models/LabBooking');
const Wallet = require('../../../models/Wallet');
const MasterReportTemplate = require('../../../models/MasterReportTemplate'); // 👈 Imported Template Model
const LabPrescriptionRequest = require('../../../models/LabPrescriptionRequest'); // Import model
const Driver = require('../../../models/Driver');
const moment = require('moment');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { sendPushNotification } = require('../../../utils/notification'); 



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

        if (!phlebotomistId) {
            return res.status(400).json({ 
                success: false, 
                message: "Phlebotomist ID is required to assign staff." 
            });
        }

        const booking = await LabBooking.findOneAndUpdate(
            { _id: req.params.orderId, labId: req.user.id },
            { 
                phlebotomistId: phlebotomistId, 
                status: 'Phlebotomist Assigned' 
            },
            { new: true }
        );

        if (!booking) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        res.json({ success: true, message: "Phlebotomist assigned successfully", data: booking });
    } catch (error) { 
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
// ==========================================
// 6. GENERATE PATIENT SMART REPORT (Dynamic Multi-Patient Multi-Test Engine)
// Replacing generateAndUploadSmartReport inside controllers/provider/Lab/LabsOrder.js
// ==========================================
const generateAndUploadSmartReport = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { testValues, patientId } = req.body; // 👈 Process specifically for this patientId [1]

        if (!testValues || !patientId) {
            return res.status(400).json({ success: false, message: "Both 'testValues' and 'patientId' are required." });
        }

        const booking = await LabBooking.findById(orderId);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Lab booking not found." });
        }

        // Find the specific target patient within the booking
        const patient = booking.patients.find(p => 
            String(p.patientId) === String(patientId) || 
            String(p._id) === String(patientId) ||
            (patientId === 'Self' && p.relation === 'Self')
        );

        if (!patient) {
            return res.status(404).json({ success: false, message: "Target patient not found in this booking." });
        }

        const isFemale = patient.gender?.toLowerCase() === 'female';

        // Health Score & Interpretations
        let healthScore = 100;
        const processedParametersList = [];
        const advisory = {
            nutritions: ["Have a balanced diet that includes whole grains, pulses, dairy, and healthy fruits."],
            lifestyles: ["Maintain ideal weight and have regular physical activity of 30 mins daily."],
            futureTests: [],
            supplements: []
        };

        testValues.forEach(testGroup => {
            const groupName = testGroup.testName;
            
            testGroup.parameters.forEach(param => {
                const rawValue = param.value;
                const numValue = Number(rawValue);
                const minRef = Number(param.minRef);
                const maxRef = Number(param.maxRef);
                const unit = param.unit || "";
                
                let status = 'Everything looks good';
                
                if (!isNaN(numValue)) {
                    if ((!isNaN(minRef) && numValue < minRef) || (!isNaN(maxRef) && numValue > maxRef)) {
                        status = 'Concern';
                        healthScore -= 8; 
                    }
                } else {
                    const cleanVal = String(rawValue).trim().toLowerCase();
                    const cleanRef = String(param.minRef || "negative").trim().toLowerCase();
                    const isNormalValue = ["negative", "normal", "clear", "pale yellow", "absent", "nil"].includes(cleanVal);
                    
                    if (cleanVal !== cleanRef && !isNormalValue) {
                        status = 'Concern';
                        healthScore -= 5; 
                    }
                }

                processedParametersList.push({
                    testGroup: groupName || "General",
                    parameterName: param.name,
                    value: rawValue,
                    unit,
                    interval: param.unit ? `${param.minRef} - ${param.maxRef}` : (param.minRef || "Negative"),
                    status,
                    method: param.method || "N/A",
                    machine: param.machine || "Automated Analyzer"
                });

                const nameLower = param.name.toLowerCase();
                if (nameLower.includes("hemoglobin") && status === 'Concern') {
                    advisory.nutritions.push("Take iron-rich foods like spinach, beetroot, dates, and green leafy vegetables.");
                    advisory.futureTests.push("Complete Hemogram - Every 1 Month");
                    advisory.futureTests.push("Iron Studies - Every 1 Month");
                }
                if (nameLower.includes("vitamin d") && status === 'Concern') {
                    advisory.nutritions.push("Include calcium-rich foods like milk, yoghurt, and cheese in your diet.");
                    advisory.lifestyles.push("Ensure safe and moderate exposure to sunlight (15-20 mins daily).");
                    advisory.supplements.push({ name: "VITAMIN D3", benefit: "Improves bone health & immunity." });
                    advisory.futureTests.push("Vitamin D Total-25 Hydroxy - Every 2 Month");
                }
                if ((nameLower.includes("sugar") || nameLower.includes("glucose")) && status === 'Concern') {
                    advisory.nutritions.push("Limit sugar intake, avoid refined carbs, and decrease sugary drinks.");
                    advisory.lifestyles.push("Avoid overexertion and monitor blood sugar levels regularly.");
                    advisory.futureTests.push("Fasting Blood Sugar - Every 1 Month");
                }
                if (nameLower.includes("creatinine") && status === 'Concern') {
                    advisory.nutritions.push("Prioritize hydration and balanced nutrition to support kidney health.");
                    advisory.futureTests.push("Kidney Function Test - Every 3 Month");
                }
            });
        });

        healthScore = Math.max(0, healthScore);

        advisory.nutritions = [...new Set(advisory.nutritions)];
        advisory.lifestyles = [...new Set(advisory.lifestyles)];
        advisory.futureTests = [...new Set(advisory.futureTests)];

        // Fetch matching Master templates
        const testNames = testValues.map(tg => tg.testName);
        const templates = await MasterReportTemplate.find({ testName: { $in: testNames } }).lean();

        // PDF Generation Engine (Branded with Patient Specific details) [2]
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        
        // Save PDF with Unique Patient Marker to prevent over-writing
        const cleanPatientName = patient.name.replace(/\s+/g, '_');
        const reportFileName = `report-${booking.bookingId}-${cleanPatientName}.pdf`;
        const reportPath = path.join(process.cwd(), 'public', 'uploads', 'user_reports', reportFileName);

        fs.mkdirSync(path.dirname(reportPath), { recursive: true });

        const stream = fs.createWriteStream(reportPath);
        doc.pipe(stream);

        const primaryColor = "#00a896"; 
        const warningColor = "#D32F2F"; 
        const successColor = "#388E3C"; 
        const textColor = "#212121";

        // ==========================================
        // PAGE 1: COVER PAGE
        // ==========================================
        doc.rect(0, 0, 595.28, 20).fill(primaryColor); 
        
        doc.fillColor(primaryColor).fontSize(28).font('Helvetica-Bold').text("HealthKangaroo", 50, 80);
        doc.fillColor("#757575").fontSize(14).font('Helvetica').text("Smart Report 3.0", 50, 115);

        doc.moveTo(50, 140).lineTo(545, 140).strokeColor(primaryColor).lineWidth(2).stroke();

        doc.fillColor(textColor).fontSize(20).font('Helvetica-Bold').text("A Comprehensive Health Analysis Report", 50, 180);
        doc.fillColor("#757575").fontSize(12).font('Helvetica-Oblique').text("AI Based Personalized Diagnostic Report for You", 50, 210);

        doc.rect(50, 260, 495, 140).fillColor("#f5f5f5").fill();
        doc.fillColor(textColor).fontSize(11).font('Helvetica-Bold');
        doc.text(`Booking ID :`, 70, 280).text(booking.bookingId, 180, 280);
        doc.text(`Patient Name :`, 70, 300).text(patient.name, 180, 300);
        doc.text(`Age / Gender :`, 70, 320).text(`${patient.age} Yrs / ${patient.gender}`, 180, 320);
        doc.text(`Collection Date :`, 70, 340).text(moment(booking.createdAt).format('DD-MMM-YYYY'), 180, 340);
        doc.text(`Report Status :`, 70, 360).fillColor(successColor).text("Final Report", 180, 360);

        doc.rect(50, 650, 495, 80).lineWidth(1).strokeColor("#e0e0e0").stroke();
        doc.fillColor(textColor).fontSize(10).font('Helvetica-Bold').text("HEALTHKANGAROO CREDIBILITY ASSURED", 70, 670);
        doc.fillColor("#757575").fontSize(8).font('Helvetica').text("Scan the report's QR code on our app to verify the machine-generated authenticity of your results.", 70, 690);

        // ==========================================
        // PAGE 2: PERSONALIZED SUMMARY & VITALS
        // ==========================================
        doc.addPage();
        doc.rect(0, 0, 595.28, 20).fill(primaryColor);
        doc.fillColor(primaryColor).fontSize(14).font('Helvetica-Bold').text("HEALTH SUMMARY & VITALS", 50, 40);
        doc.moveTo(50, 60).lineTo(545, 60).strokeColor("#e0e0e0").lineWidth(1).stroke();

        doc.circle(450, 140, 45).fillColor(primaryColor).fill();
        doc.fillColor("#ffffff").fontSize(26).font('Helvetica-Bold').text(`${healthScore}`, 430, 120);
        doc.fillColor("#ffffff").fontSize(8).font('Helvetica').text("Score / 100", 425, 150);

        doc.fillColor(textColor).fontSize(12).font('Helvetica-Bold').text(`Hello ${patient.name},`, 50, 90);
        doc.fillColor("#424242").fontSize(10).font('Helvetica').text("We have successfully analyzed your diagnostic samples. Below is your dynamic body ecosystem health score card:", 50, 110, { width: 330 });

        let gridY = 220;
        doc.fillColor(textColor).fontSize(11).font('Helvetica-Bold').text("Key Parameters Status", 50, 200);

        processedParametersList.slice(0, 7).forEach((item) => {
            const isConcern = item.status === 'Concern';
            
            doc.rect(50, gridY, 495, 35).fillColor("#fafafa").fill();
            doc.fillColor(textColor).fontSize(9).font('Helvetica-Bold').text(item.parameterName, 70, gridY + 12);
            doc.text(`${item.value} ${item.unit}`, 280, gridY + 12);
            
            doc.fillColor(isConcern ? warningColor : successColor)
               .text(item.status, 420, gridY + 12);
               
            gridY += 42;
        });

        // ==========================================
        // PAGE 3: DYNAMIC DETAILED REPORT TABLES (Automatic Page breaks)
        // ==========================================
        doc.addPage();
        doc.rect(0, 0, 595.28, 20).fill(primaryColor);
        doc.fillColor(primaryColor).fontSize(14).font('Helvetica-Bold').text("DETAILED CLINICAL REPORT", 50, 40);
        doc.moveTo(50, 60).lineTo(545, 60).strokeColor("#e0e0e0").lineWidth(1).stroke();

        let tableY = 90;
        
        const drawTableHeader = (yPos) => {
            doc.fillColor("#757575").fontSize(8).font('Helvetica-Bold');
            doc.text("TEST PARAMETER", 50, yPos);
            doc.text("VALUE", 230, yPos);
            doc.text("UNIT", 290, yPos);
            doc.text("REFERENCE INTERVAL", 350, yPos);
            doc.text("STATUS", 480, yPos);
            doc.moveTo(50, yPos + 15).lineTo(545, yPos + 15).strokeColor("#e0e0e0").lineWidth(1).stroke();
        };

        drawTableHeader(tableY);
        tableY += 25;

        let currentGroup = "";

        for (let item of processedParametersList) {
            if (tableY > 700) {
                doc.addPage();
                doc.rect(0, 0, 595.28, 20).fill(primaryColor);
                tableY = 50;
                drawTableHeader(tableY);
                tableY += 25;
            }

            if (item.testGroup !== currentGroup) {
                currentGroup = item.testGroup;
                tableY += 10;
                doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold').text(currentGroup.toUpperCase(), 50, tableY);
                tableY += 20;
            }

            doc.fillColor(textColor).fontSize(9).font('Helvetica-Bold').text(item.parameterName, 60, tableY, { width: 160 });
            doc.font('Helvetica').text(`${item.value}`, 230, tableY);
            doc.text(item.unit, 290, tableY);
            doc.text(item.interval, 350, tableY);
            
            const isConcern = item.status === 'Concern';
            doc.fillColor(isConcern ? warningColor : successColor)
               .font('Helvetica-Bold')
               .text(item.status === 'Concern' ? 'High/Low' : 'Normal', 480, tableY);

            tableY += 30;
        }

        // ==========================================
        // PAGE 4: CLINICAL INTERPRETATIONS (Dynamic Content extracted from parameters[0])
        // ==========================================
        let hasInterpretations = templates.some(t => t.parameters?.[0]?.interpretation && t.parameters[0].interpretation.trim().length > 0);
        
        if (hasInterpretations) {
            doc.addPage();
            doc.rect(0, 0, 595.28, 20).fill(primaryColor);
            doc.fillColor(primaryColor).fontSize(14).font('Helvetica-Bold').text("CLINICAL INTERPRETATIONS & NOTES", 50, 40);
            doc.moveTo(50, 60).lineTo(545, 60).strokeColor("#e0e0e0").lineWidth(1).stroke();

            let interpY = 80;
            templates.forEach(t => {
                const interpText = t.parameters?.[0]?.interpretation; 
                
                if (interpText && interpText.trim().length > 0) {
                    if (interpY > 680) {
                        doc.addPage();
                        doc.rect(0, 0, 595.28, 20).fill(primaryColor);
                        interpY = 40;
                    }

                    doc.fillColor(primaryColor).fontSize(11).font('Helvetica-Bold').text(t.testName.toUpperCase(), 50, interpY);
                    interpY += 18;

                    doc.fillColor("#424242").fontSize(8.5).font('Helvetica').text(interpText, 50, interpY, {
                        width: 495,
                        align: 'justify',
                        lineGap: 2
                    });
                    
                    const textHeight = doc.heightOfString(interpText, { width: 495, lineGap: 2 });
                    interpY += textHeight + 20;
                }
            });
        }

        // ==========================================
        // PAGE 5: HEALTH ADVISORY & SUGGESTIONS [2]
        // ==========================================
        doc.addPage();
        doc.rect(0, 0, 595.28, 20).fill(primaryColor);
        doc.fillColor(primaryColor).fontSize(14).font('Helvetica-Bold').text("SUGGESTED ADVISORY & DO'S/DONT'S", 50, 40);
        doc.moveTo(50, 60).lineTo(545, 60).strokeColor("#e0e0e0").lineWidth(1).stroke();

        doc.fillColor(textColor).fontSize(11).font('Helvetica-Bold').text("Suggested Nutrition Do's", 50, 90);
        let nutritionY = 110;
        advisory.nutritions.forEach((item) => {
            doc.fillColor("#424242").fontSize(9).font('Helvetica').text(`• ${item}`, 60, nutritionY, { width: 480 });
            nutritionY += 20;
        });

        doc.fillColor(textColor).fontSize(11).font('Helvetica-Bold').text("Suggested Lifestyle Do's", 50, nutritionY + 15);
        let lifestyleY = nutritionY + 35;
        advisory.lifestyles.forEach((item) => {
            doc.fillColor("#424242").fontSize(9).font('Helvetica').text(`• ${item}`, 60, lifestyleY, { width: 480 });
            lifestyleY += 20;
        });

        if (advisory.futureTests.length > 0) {
            doc.fillColor(textColor).fontSize(11).font('Helvetica-Bold').text("Suggested Future Follow-Up Tests", 50, lifestyleY + 20);
            let testY = lifestyleY + 45;
            advisory.futureTests.forEach((test) => {
                doc.fillColor("#424242").fontSize(9).font('Helvetica').text(`• ${test}`, 60, testY);
                testY += 15;
            });
            lifestyleY = testY;
        }

        if (advisory.supplements.length > 0) {
            doc.fillColor(textColor).fontSize(11).font('Helvetica-Bold').text("Suggested Nutritional Supplements", 50, lifestyleY + 20);
            let suppY = lifestyleY + 45;
            advisory.supplements.forEach((supp) => {
                doc.fillColor(textColor).fontSize(9).font('Helvetica-Bold').text(`• ${supp.name}: `, 60, suppY);
                doc.fillColor("#424242").font('Helvetica').text(supp.benefit, 150, suppY);
                suppY += 15;
            });
        }

        doc.end();

        stream.on('finish', async () => {
            // 🚨 MULTI-PATIENT SYNC (Bypassing Mongoose strict mode constraints safely)
            if (!booking.patientReports) booking.patientReports = [];

            // Purani generated patient report remove karein (if re-triggered)
            booking.patientReports = booking.patientReports.filter(r => String(r.patientId) !== String(patientId));

            const finalReportFile = `/uploads/user_reports/${reportFileName}`;

            booking.patientReports.push({
                patientId: patient.patientId || patient._id || "Self",
                patientName: patient.name,
                reportFile: finalReportFile
            });

            // Status check: Kya booking ke sabhi patients ke report card generate ho chuke hain?
            const allCompleted = booking.patients.every(p => {
                const targetId = p.patientId || p._id || "Self";
                return booking.patientReports.some(r => String(r.patientId) === String(targetId));
            });

            booking.status = allCompleted ? 'Completed' : 'Testing';
            booking.reportFile = finalReportFile; // Fallback main reference
            
            // Mark modified and save
            booking.markModified('patientReports');
            await booking.save();

            res.status(200).json({
                success: true,
                message: `Dynamic report for ${patient.name} generated successfully!`,
                reportUrl: finalReportFile,
                data: booking
            });
        });

    } catch (error) {
        console.error("Critical Error in Report Generator Engine:", error);
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
        // 🚨 STRICT SYNC: Capturing tests and packages separately as defined in your schema
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

        // Map tests array safely [1]
        if (tests && tests.length > 0) {
            for (let t of tests) {
                const subtotal = Number(t.pricePerUnit || 0);
                itemTotal += subtotal;
                verifiedTests.push({
                    testId: t.testId && mongoose.isValidObjectId(t.testId) ? t.testId : null,
                    name: t.name,
                    mrp: Number(t.mrp || 0),
                    pricePerUnit: subtotal
                });
            }
        }

        // Map packages array safely [1]
        if (packages && packages.length > 0) {
            for (let p of packages) {
                const subtotal = Number(p.pricePerUnit || 0);
                itemTotal += subtotal;
                verifiedPackages.push({
                    packageId: p.packageId && mongoose.isValidObjectId(p.packageId) ? p.packageId : null,
                    name: p.name,
                    mrp: Number(p.mrp || 0),
                    pricePerUnit: subtotal
                });
            }
        }

        const patientCount = request.patients.length || 1;
        const subtotalSum = itemTotal * patientCount;
        const totalAmount = subtotalSum + Number(homeVisitCharge || 0);

        // 🚨 SAVED: Strictly matching your database schema keys
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

// 2. ASSIGN PHLEBOTOMIST (First Time Assignment)

// =======================================================

// Endpoint: PATCH /provider/labs/assign-staff/:orderId

const assignDriverStaff = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { phlebotomistId } = req.body;
        const labId = req.user.id;
 
        if (!phlebotomistId) {
            return res.status(400).json({ 
                success: false, 
                message: "Phlebotomist ID is required to assign staff." 
            });
        }

        // ID formats validate karein
        if (!mongoose.Types.ObjectId.isValid(phlebotomistId)) {
            return res.status(400).json({ success: false, message: "Invalid Phlebotomist ID format." });
        }
 
        // 1. Phlebotomist fetch karein aur verification apply karein
        const driver = await Driver.findById(phlebotomistId);
        if (!driver) {
            return res.status(404).json({ success: false, message: "Phlebotomist not found." });
        }

        // Secure boundary checks: verify vendor connection
        if (driver.vendorId.toString() !== labId.toString()) {
            return res.status(403).json({ success: false, message: "Unauthorized. This phlebotomist does not belong to your lab." });
        }
 
        if (driver.status === 'Offline') {
            return res.status(400).json({ success: false, message: "Cannot assign an offline phlebotomist." });
        }
 
        // 2. Booking ko update karein
        const booking = await LabBooking.findOneAndUpdate(
            { _id: orderId, labId },
            { 
                phlebotomistId: phlebotomistId, 
                status: 'Phlebotomist Assigned' 
            },
            { new: true }
        );
 
        if (!booking) {
            return res.status(404).json({ success: false, message: "Order not found or unauthorized." });
        }
 
        // 3. FIX: Atomic update operator use karein taaki status directly update ho bina kisi hook blockage ke
        const updatedDriver = await Driver.findByIdAndUpdate(
            phlebotomistId,
            { $set: { status: 'Busy' } },
            { new: true } // Returns the updated document state
        );
 
        res.json({ 
            success: true, 
            message: "Phlebotomist assigned successfully and status updated to Busy.", 
            data: {
                booking,
                phlebotomistStatus: updatedDriver ? updatedDriver.status : 'Busy'
            }
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

 



module.exports = { 
    getLabStats, 
    getOrders, 
    handleOrderAction, 
    assignStaff, 
    updateProgressStatus, 
    uploadReport ,

    // New endpoints
    generateAndUploadSmartReport,
    getReportTemplates,
    getReportTemplatesDropdown, // 👈 Added
    getReportTemplatesForBooking, // 👈 Added
    saveDraftResults, // 👈 Added
    getDraftResults, // 👈 Added


    // Prescription Flow endpoints
    getProviderLabPrescriptionRequests,
    getProviderLabPrescriptionRequestDetails,
    startLabPrescriptionReview,
    submitLabReviewBill,
    rejectLabPrescriptionRequest,
    getAvailablePhlebotomists,
    assignDriverStaff,              
    reassignDriverStaff   ,
    getBookingTrackingDetails,
    
 
};