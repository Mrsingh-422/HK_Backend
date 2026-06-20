// controllers/provider/Lab/LabsOrder.js

const LabBooking = require('../../../models/LabBooking');
const Wallet = require('../../../models/Wallet');
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


// POST /provider/labs/generate-report/:orderId
// Replace this function inside controllers/provider/Lab/LabsOrder.js
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

        // 🚨 DYNAMIC HEALTH SCORE & CLINICAL INTERPRETATION ENGINE [2]
        let healthScore = 100;
        const processedParametersList = [];
        
        const advisory = {
            nutritions: ["Have a balanced diet that includes whole grains, pulses, dairy, and healthy fruits."],
            lifestyles: ["Maintain ideal weight and have regular physical activity of 30 mins daily."],
            futureTests: [],
            supplements: []
        };

        // Loop through all tests & packages submitted by Lab Tech
        testValues.forEach(testGroup => {
            const groupName = testGroup.testName;
            
            testGroup.parameters.forEach(param => {
                const rawValue = param.value;
                const numValue = Number(rawValue);
                const minRef = Number(param.minRef);
                const maxRef = Number(param.maxRef);
                const unit = param.unit || "";
                
                let status = 'Everything looks good';
                
                // 🚨 HYBRID VALIDATOR: Numeric vs Qualitative string parser
                if (!isNaN(numValue)) {
                    // CASE A: Quantitative/Numeric Test (e.g. Hemoglobin, Vitamin D) [1]
                    if ((!isNaN(minRef) && numValue < minRef) || (!isNaN(maxRef) && numValue > maxRef)) {
                        status = 'Concern';
                        healthScore -= 8; // Deduct score dynamically [2]
                    }
                } else {
                    // CASE B: Qualitative/Text-Based Test (e.g. Urine Protein, Nitrite, Pus Cells) [1]
                    const cleanVal = String(rawValue).trim().toLowerCase();
                    const cleanRef = String(param.minRef || "negative").trim().toLowerCase();
                    
                    // Standard normal values for text tests
                    const isNormalValue = ["negative", "normal", "clear", "pale yellow", "absent", "nil"].includes(cleanVal);
                    
                    if (cleanVal !== cleanRef && !isNormalValue) {
                        status = 'Concern';
                        healthScore -= 5; // Deduct slightly lower score for qualitative warnings [2]
                    }
                }

                // Push to flat array for PDF rendering
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

                // Keyword Matching for Advisory generation [2]
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

        // PDF Generation Engine (HealthKangaroo Branded)
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const reportFileName = `report-${booking.bookingId}.pdf`;
        const reportPath = path.join(process.cwd(), 'public', 'uploads', 'user_reports', reportFileName);

        fs.mkdirSync(path.dirname(reportPath), { recursive: true });

        const stream = fs.createWriteStream(reportPath);
        doc.pipe(stream);

        // Colors Palette (HealthKangaroo Theme)
        const primaryColor = "#00a896"; // Brand Teal
        const warningColor = "#D32F2F"; // Concern Red
        const successColor = "#388E3C"; // Normal Green
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
            // Safe Overflow check at 700 units height
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
        // PAGE 4: HEALTH ADVISORY & SUGGESTIONS
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


// 8. NEW: GET REPORT TEMPLATES (For Frontend Dynamic Form Rendering)
// endpoint: GET /provider/labs/report-templates
const getReportTemplates = async (req, res) => {
    try {
        // Master templates mapping for 10 most common diagnostic tests [1]
        const MASTER_REPORT_TEMPLATES = {
            "Complete Blood Count (CBC)": [
                { "name": "Haemoglobin (HB)", "unit": "g/dL", "minRef": 12.0, "maxRef": 15.0, "type": "numeric", "machine": "Yumizen H2500", "method": "Spectrophotometry" },
                { "name": "Total Leucocyte Count (TLC)", "unit": "10^3/uL", "minRef": 4.0, "maxRef": 10.0, "type": "numeric", "machine": "Yumizen H2500", "method": "Impedance" },
                { "name": "Red Blood Cell Count (RBC)", "unit": "10^6/uL", "minRef": 3.80, "maxRef": 4.80, "type": "numeric", "machine": "Yumizen H2500", "method": "Impedance" },
                { "name": "Mean Corp Volume (MCV)", "unit": "fL", "minRef": 83.0, "maxRef": 101.0, "type": "numeric", "machine": "Yumizen H2500", "method": "Derived from RBC Histogram" },
                { "name": "Neutrophils", "unit": "%", "minRef": 40.0, "maxRef": 80.0, "type": "numeric", "machine": "Yumizen H2500", "method": "Flow-Cytometry DHSS" },
                { "name": "Lymphocytes", "unit": "%", "minRef": 20.0, "maxRef": 40.0, "type": "numeric", "machine": "Yumizen H2500", "method": "Flow-Cytometry DHSS" },
                { "name": "Platelet Count (PLT)", "unit": "10^3/uL", "minRef": 150.0, "maxRef": 410.0, "type": "numeric", "machine": "Yumizen H2500", "method": "Impedance" }
            ],
            "Liver Function Test (LFT)": [
                { "name": "Serum Bilirubin, (Total)", "unit": "mg/dl", "minRef": 0.3, "maxRef": 1.2, "type": "numeric", "machine": "BECKMAN COULTER AU 5801", "method": "Diazonium Ion" },
                { "name": "Serum Bilirubin, (Direct)", "unit": "mg/dl", "minRef": 0.0, "maxRef": 0.2, "type": "numeric", "machine": "BECKMAN COULTER AU 5801", "method": "Diazotization" },
                { "name": "Aspartate Aminotransferase (AST/SGOT)", "unit": "U/L", "minRef": 3.0, "maxRef": 35.0, "type": "numeric", "machine": "BECKMAN COULTER AU 5801", "method": "UV with P5P" },
                { "name": "Alanine Aminotransferase (ALT/SGPT)", "unit": "U/L", "minRef": 3.0, "maxRef": 35.0, "type": "numeric", "machine": "BECKMAN COULTER AU 5801", "method": "UV without P5P" },
                { "name": "Alkaline Phosphatase (ALP)", "unit": "U/L", "minRef": 33.0, "maxRef": 98.0, "type": "numeric", "machine": "BECKMAN COULTER AU 5801", "method": "IFCC AMP Buffer" },
                { "name": "Serum Total Protein", "unit": "gm/dl", "minRef": 6.6, "maxRef": 8.3, "type": "numeric", "machine": "BECKMAN COULTER AU 5801", "method": "Biuret" },
                { "name": "Serum Albumin", "unit": "g/dl", "minRef": 3.5, "maxRef": 5.2, "type": "numeric", "machine": "BECKMAN COULTER AU 5801", "method": "Bromo Cresol Green(BCG)" }
            ],
            "Kidney Function Test Advance (KFT)": [
                { "name": "Serum Creatinine", "unit": "mg/dl", "minRef": 0.3, "maxRef": 1.0, "type": "numeric", "machine": "BECKMAN COULTER AU 5801", "method": "Jaffes Kinetic" },
                { "name": "Serum Uric Acid", "unit": "mg/dl", "minRef": 2.6, "maxRef": 6.0, "type": "numeric", "machine": "BECKMAN COULTER AU 5801", "method": "Uricase" },
                { "name": "Serum Calcium", "unit": "mg/dl", "minRef": 8.8, "maxRef": 10.6, "type": "numeric", "machine": "BECKMAN COULTER AU 5801", "method": "Arsenazo III" },
                { "name": "Serum Phosphorus", "unit": "mg/dl", "minRef": 2.5, "maxRef": 4.5, "type": "numeric", "machine": "BECKMAN COULTER AU 5801", "method": "Phosphomolybdate complex" },
                { "name": "Serum Sodium", "unit": "mmol/L", "minRef": 136, "maxRef": 146, "type": "numeric", "machine": "BECKMAN COULTER AU 5801", "method": "ISE (Indirect)" },
                { "name": "Serum Chloride", "unit": "mmol/L", "minRef": 101, "maxRef": 109, "type": "numeric", "machine": "BECKMAN COULTER AU 5801", "method": "ISE (Indirect)" },
                { "name": "Blood Urea", "unit": "mg/dl", "minRef": 17.0, "maxRef": 43.0, "type": "numeric", "machine": "BECKMAN COULTER AU 5801", "method": "Urease" },
                { "name": "Blood Urea Nitrogen (BUN)", "unit": "mg/dl", "minRef": 8.0, "maxRef": 20.0, "type": "numeric", "machine": "BECKMAN COULTER AU 5801", "method": "Calculated" }
            ],
            "Lipid Profile": [
                { "name": "Total Cholesterol", "unit": "mg/dL", "minRef": 100.0, "maxRef": 200.0, "type": "numeric", "machine": "BECKMAN COULTER AU 5801", "method": "Cholesterol Oxidase" },
                { "name": "Serum Triglycerides", "unit": "mg/dl", "minRef": 50.0, "maxRef": 150.0, "type": "numeric", "machine": "BECKMAN COULTER AU 5801", "method": "Enzymatic" },
                { "name": "Serum HDL Cholesterol", "unit": "mg/dl", "minRef": 40.0, "maxRef": 60.0, "type": "numeric", "machine": "BECKMAN COULTER AU 5801", "method": "Direct measure" },
                { "name": "LDL Cholesterol", "unit": "mg/dl", "minRef": 50.0, "maxRef": 100.0, "type": "numeric", "machine": "BECKMAN COULTER AU 5801", "method": "Calculated" },
                { "name": "VLDL Cholesterol", "unit": "mg/dl", "minRef": 5.0, "maxRef": 30.0, "type": "numeric", "machine": "BECKMAN COULTER AU 5801", "method": "Calculated" }
            ],
            "Fasting Blood Sugar": [
                { "name": "Glucose, Fasting", "unit": "mg/dl", "minRef": 70.0, "maxRef": 100.0, "type": "numeric", "machine": "BECKMAN COULTER DxC 700 AU", "method": "Hexokinase" }
            ],
            "HbA1c (Glycated Hemoglobin)": [
                { "name": "HbA1c Percentage", "unit": "%", "minRef": 4.0, "maxRef": 5.6, "type": "numeric", "machine": "BIO-RAD D-10", "method": "HPLC" },
                { "name": "Estimated Average Glucose (eAG)", "unit": "mg/dl", "minRef": 70, "maxRef": 115, "type": "numeric", "machine": "BIO-RAD D-10", "method": "Calculated" }
            ],
            "Thyroid Profile": [
                { "name": "Total Triiodothyronine (T3)", "unit": "ng/mL", "minRef": 0.8, "maxRef": 2.0, "type": "numeric", "machine": "BECKMAN COULTER DxI800", "method": "CLIA" },
                { "name": "Total Thyroxine (T4)", "unit": "µg/dL", "minRef": 4.8, "maxRef": 11.6, "type": "numeric", "machine": "BECKMAN COULTER DxI800", "method": "CLIA" },
                { "name": "Thyroid Stimulating Hormone (TSH)-Ultrasensitive", "unit": "µIU/mL", "minRef": 0.38, "maxRef": 5.33, "type": "numeric", "machine": "BECKMAN COULTER DxI800", "method": "CLIA" }
            ],
            "Vitamin Profile": [
                { "name": "Vitamin D, 25-Hydroxy", "unit": "ng/ml", "minRef": 30.0, "maxRef": 100.0, "type": "numeric", "machine": "BECKMAN COULTER DxI800", "method": "CLIA" },
                { "name": "Vitamin B12", "unit": "pg/mL", "minRef": 211, "maxRef": 911, "type": "numeric", "machine": "BECKMAN COULTER DxI800", "method": "CLIA" }
            ],
            "Urine Routine & Microscopy Extended": [
                { "name": "Colour", "unit": "", "minRef": "Pale Yellow", "maxRef": "", "type": "text", "machine": "Visual Examination", "method": "Visual" },
                { "name": "Specific Gravity", "unit": "", "minRef": "1.001", "maxRef": "1.035", "type": "numeric", "machine": "Urometer", "method": "Dipstick" },
                { "name": "pH", "unit": "", "minRef": "4.5", "maxRef": "7.5", "type": "numeric", "machine": "Double indicator", "method": "Double indicator" },
                { "name": "Urine Protein", "unit": "", "minRef": "Negative", "maxRef": "", "type": "text", "machine": "Dipstick", "method": "Dipstick" },
                { "name": "Nitrite", "unit": "", "minRef": "Negative", "maxRef": "", "type": "text", "machine": "Dipstick", "method": "Dipstick" },
                { "name": "Pus Cells", "unit": "/HPF", "minRef": "0", "maxRef": "5", "type": "numeric", "machine": "Microscopic", "method": "Microscopic" },
                { "name": "Epithelial cells", "unit": "/HPF", "minRef": "0", "maxRef": "5", "type": "numeric", "machine": "Microscopic", "method": "Microscopic" },
                { "name": "Bacteria", "unit": "", "minRef": "Absent", "maxRef": "", "type": "text", "machine": "Microscopic", "method": "Microscopic" }
            ],
            "Dengue Serology Panel": [
                { "name": "Dengue NS1 Antigen", "unit": "", "minRef": "Negative", "maxRef": "", "type": "text", "machine": "ELISA", "method": "ELISA" },
                { "name": "Dengue IgM", "unit": "", "minRef": "Negative", "maxRef": "", "type": "text", "machine": "ELISA", "method": "ELISA" },
                { "name": "Dengue IgG", "unit": "", "minRef": "Negative", "maxRef": "", "type": "text", "machine": "ELISA", "method": "ELISA" }
            ]
        };

        // Frontend dynamically requested tests nikalna (Optional filter)
        // e.g. GET /report-templates?testNames=Complete Blood Count (CBC),Lipid Profile
        const { testNames } = req.query;
        
        if (testNames) {
            const requestedList = testNames.split(',').map(name => name.trim());
            const filteredTemplates = {};
            
            requestedList.forEach(name => {
                if (MASTER_REPORT_TEMPLATES[name]) {
                    filteredTemplates[name] = MASTER_REPORT_TEMPLATES[name];
                }
            });
            
            return res.json({ success: true, data: filteredTemplates });
        }

        // Default: Poore 10 templates bhej do
        res.json({ success: true, data: MASTER_REPORT_TEMPLATES });

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
    generateAndUploadSmartReport,
    getReportTemplates
};