// controllers/provider/Lab/LabsOrder.js

const LabBooking = require('../../../models/LabBooking');
const Wallet = require('../../../models/Wallet');
const MasterReportTemplate = require('../../../models/MasterReportTemplate'); // 👈 Imported Template Model
const moment = require('moment');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');



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


// ==========================================
// 7. GET REPORT TEMPLATES (Fully Database-Driven & Lightweight)
// endpoint: GET /provider/labs/report-templates
// ==========================================
const getReportTemplates = async (req, res) => {
    try {
        const { testNames } = req.query;
        let query = {};
        
        if (testNames) {
            const requestedList = testNames.split(',').map(name => name.trim());
            query.testName = { $in: requestedList };
        }

        const templates = await MasterReportTemplate.find(query).lean();

        const formattedTemplates = {};
        templates.forEach(template => {
            formattedTemplates[template.testName] = template.parameters;
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
// 8. GENERATE SMART REPORT PDF (Dynamic Quantitative & Qualitative Evaluator)
// endpoint: POST /provider/labs/generate-report/:orderId
// ==========================================
const generateAndUploadSmartReport = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { testValues } = req.body; 

        if (!testValues || !Array.isArray(testValues) || testValues.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: "Please provide valid testValues array." 
            });
        }

        const booking = await LabBooking.findById(orderId).populate('userId');
        if (!booking) {
            return res.status(404).json({ success: false, message: "Lab booking not found." });
        }

        const patient = booking.patients[0] || { name: booking.userId?.name || "Patient", age: 30, gender: "Female" };
        const isFemale = patient.gender?.toLowerCase() === 'female';

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

        // Fetch matching Master templates to extract interpretations from first parameter [1]
        const testNames = testValues.map(tg => tg.testName);
        const templates = await MasterReportTemplate.find({ testName: { $in: testNames } }).lean();

        // PDF Generation Engine (HealthKangaroo Branded)
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const reportFileName = `report-${booking.bookingId}.pdf`;
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
        // PAGE 2: PERSONALIZED summary & VITAL PARAMETERS
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
        // 🚨 PAGE 4: CLINICAL INTERPRETATIONS (Dynamic Content extracted from parameters[0]) [1]
        // ==========================================
        // Check if any loaded template has interpretation saved in parameters[0]
        let hasInterpretations = templates.some(t => t.parameters?.[0]?.interpretation && t.parameters[0].interpretation.trim().length > 0);
        
        if (hasInterpretations) {
            doc.addPage();
            doc.rect(0, 0, 595.28, 20).fill(primaryColor);
            doc.fillColor(primaryColor).fontSize(14).font('Helvetica-Bold').text("CLINICAL INTERPRETATIONS & NOTES", 50, 40);
            doc.moveTo(50, 60).lineTo(545, 60).strokeColor("#e0e0e0").lineWidth(1).stroke();

            let interpY = 80;
            templates.forEach(t => {
                const interpText = t.parameters?.[0]?.interpretation; // 👈 Extracts strictly from first parameter! [1]
                
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
            booking.reportFile = `/uploads/user_reports/${reportFileName}`;
            booking.status = 'Completed';
            await booking.save();

            res.status(200).json({
                success: true,
                message: "Dynamic Smart Report generated successfully!",
                reportUrl: booking.reportFile,
                data: booking
            });
        });

    } catch (error) {
        console.error("Critical Error in Report Generator Engine:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// 9. NEW: GET REPORT TEMPLATES FOR DROPDOWN (Name & ID only)
// endpoint: GET /provider/labs/report-templates/dropdown
const getReportTemplatesDropdown = async (req, res) => {
    try {
        // Fetch only template names and IDs for fast dropdown rendering
        const templates = await MasterReportTemplate.find().select('testName').sort({ testName: 1 });
        
        res.json({ 
            success: true, 
            count: templates.length, 
            data: templates 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 10. NEW: AUTO-RESOLVE TEMPLATES FOR SPECIFIC BOOKING (Smart Handshake)
// endpoint: GET /provider/labs/report-templates/booking/:orderId
const getReportTemplatesForBooking = async (req, res) => {
    try {
        const { orderId } = req.params;
        
        const booking = await LabBooking.findById(orderId);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found." });
        }

        const testNames = booking.items.tests.map(t => t.name);
        const packageNames = booking.items.packages.map(p => p.name);
        const allBookedNames = [...testNames, ...packageNames];

        // 🚨 RELAXED FUZZY MATCHING: Checks for partial words to resolve name mismatches [1]
        // e.g. "Kidney Function Test" matches "Kidney Function Test Advance (KFT)"
        const regexQueries = allBookedNames.map(name => {
            const cleanName = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').trim();
            const words = cleanName.split(/\s+/).filter(w => w.length > 2); // Match words length > 2
            return new RegExp(words.join('.*'), 'i');
        });

        const templates = await MasterReportTemplate.find({
            $or: [
                { testName: { $in: allBookedNames } },
                { testName: { $in: regexQueries } } // 👈 Fuzzy matched query
            ]
        }).lean();

        const formattedTemplates = {};
        templates.forEach(t => {
            formattedTemplates[t.testName] = {
                interpretation: t.parameters?.[0]?.interpretation || "", // Pulls from first param [1]
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

// 11. NEW: SAVE DRAFT RESULTS (Save intermediate progress before final print)
// endpoint: POST /provider/labs/save-draft/:orderId
const saveDraftResults = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { testValues } = req.body;

        if (!testValues) {
            return res.status(400).json({ success: false, message: "testValues payload is required." });
        }

        // Save raw parameters in testResults and transition state to 'Testing'
        const booking = await LabBooking.findByIdAndUpdate(
            orderId,
            { $set: { testResults: testValues, status: 'Testing' } },
            { new: true }
        );

        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found." });
        }

        res.json({ 
            success: true, 
            message: "Draft report results saved successfully.", 
            data: booking.testResults 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 12. NEW: FETCH SAVED DRAFT RESULTS (To pre-populate form on screen reload)
// endpoint: GET /provider/labs/get-draft/:orderId
const getDraftResults = async (req, res) => {
    try {
        const { orderId } = req.params;

        const booking = await LabBooking.findById(orderId).select('testResults');
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found." });
        }

        res.json({ 
            success: true, 
            data: booking.testResults || null // Returns null if no draft was saved before
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
    generateAndUploadSmartReport,
    getReportTemplates,
    getReportTemplatesDropdown, // 👈 Added
    getReportTemplatesForBooking, // 👈 Added
    saveDraftResults, // 👈 Added
    getDraftResults // 👈 Added
};