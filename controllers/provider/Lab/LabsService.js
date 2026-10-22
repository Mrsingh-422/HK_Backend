const LabTest = require('../../../models/LabTest');
const LabPackage = require('../../../models/LabPackage');
const MasterLabTest = require('../../../models/MasterLabTest');
const MasterLabPackage = require('../../../models/MasterLabPackage');
const MasterRequest = require('../../../models/MasterRequest');

// Helper to auto-calculate Discount Price
const calculateActualPrice = (amount, discountPercent) => {
    const discount = (amount * parseInt(discountPercent)) / 100;
    return amount - discount;
};

// @desc    Get Standard Catalog Tests with Verified Lowest Starting Price (minPrice)
// @route   GET /provider/labs/services/tests/standard-catalog
// @access  Public
const getStandardCatalogTests = async (req, res) => {
    try {
        const { search, mainCategory } = req.query;

        let matchQuery = { isActive: true };
        if (mainCategory) matchQuery.mainCategory = mainCategory;
        if (search) matchQuery.testName = new RegExp(search.trim(), 'i');

        const tests = await MasterLabTest.aggregate([
            { $match: matchQuery },
            {
                $lookup: {
                    from: "labtests", 
                    localField: "_id",
                    foreignField: "masterTestId",
                    as: "vendorList",
                    pipeline: [{ $match: { isActive: true } }] 
                }
            },
            {
                $addFields: {
                    vendorCount: { $size: "$vendorList" },
                    // Calculate lowest available price among active labs, with fallback to standardMRP
                    minPrice: { 
                        $cond: {
                            if: { $gt: [{ $size: "$vendorList" }, 0] },
                            then: { $min: "$vendorList.discountPrice" },
                            else: "$standardMRP"
                        }
                    }
                }
            },
            { $sort: { vendorCount: -1, testName: 1 } },
            {
                $project: {
                    vendorList: 0,
                    __v: 0
                }
            }
        ]);

        res.status(200).json({
            success: true,
            count: tests.length,
            data: tests
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};



// endpoint: GET /provider/labs/services/packages/standard-catalog
// Yeh seedha Master database se standard info dikhayega
const getStandardPackages = async (req, res) => {
    try {
        const { search, category } = req.query;

        let matchQuery = { isActive: true };
        if (search) matchQuery.packageName = new RegExp(search, 'i');
        if (category) matchQuery.category = category;

        const packages = await MasterLabPackage.aggregate([
            { $match: matchQuery },
            
            // Step 1: Lookup Vendor Listings
            {
                $lookup: {
                    from: "labpackages",
                    localField: "_id",
                    foreignField: "masterPackageId",
                    as: "vendorList",
                    pipeline: [{ $match: { isActive: true } }]
                }
            },

            // Step 2: Calculate Counts & Min Price
            {
                $addFields: {
                    vendorCount: { $size: "$vendorList" },
                    minPrice: { 
                        $cond: {
                            if: { $gt: [{ $size: "$vendorList" }, 0] },
                            then: { $min: "$vendorList.offerPrice" },
                            else: null
                        }
                    }
                }
            },

            // Step 3: Sorting
            { $sort: { vendorCount: -1, packageName: 1 } },

            // Step 4: Final Projection
            {
                $project: {
                    vendorList: 0,
                    __v: 0
                }
            }
        ]);

        res.json({
            success: true,
            count: packages.length,
            data: packages
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// endpoint: GET /provider/labs/services/tests/master-tests?mainCategory=Pathology&search=diabetes
// Radiology or Pathology ke master test list ke liye
const getMasterList = async (req, res) => {
    try {
        const { mainCategory, search } = req.query;
        let query = { isActive: true };
        if (mainCategory) query.mainCategory = mainCategory;
        if (search) query.testName = new RegExp(search, 'i');

        const list = await MasterLabTest.find(query);
        res.json({ success: true, data: list });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 1. LAB TEST SECTION (Radiology & Pathology)
// ==========================================

// endpoint: POST /provider/labs/services/add-test
const saveLabTest = async (req, res) => {
    try {
        const { id, masterTestId, amount, discountPercent, reportTime, precaution, testType, description } = req.body;
        
        const masterData = await MasterLabTest.findById(masterTestId);
        if (!masterData) return res.status(404).json({ message: "Invalid Master Test ID" });

        // Numeric Conversion
        const mrp = parseFloat(amount);
        const disc = parseFloat(discountPercent) || 0;

        // Backend Calculation (Middleware ki jagah yahan calculate kar rahe hain)
        const calculatedDiscountPrice = mrp - (mrp * (disc / 100));

        const payload = {
            labId: req.user.id,
            masterTestId,
            testName: masterData.testName,
            mainCategory: masterData.mainCategory,
            sampleType: masterData.sampleType,
            reportTime,
            precaution,
            description,
            testType,
            amount: mrp,
            discountPercent: disc,
            discountPrice: calculatedDiscountPrice // Seedha value store hogi
        };
        
        const test = id 
            ? await LabTest.findByIdAndUpdate(id, payload, { new: true })
            : await LabTest.create(payload);

        res.json({ success: true, data: test });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// endpoint: GET /provider/labs/services/tests/my-tests?mainCategory=Pathology
const getMyTests = async (req, res) => {
    try {
        const { mainCategory } = req.query; // Pathology or Radiology
        let query = { labId: req.user.id };
        if (mainCategory) query.mainCategory = mainCategory;

        const tests = await LabTest.find(query).populate('masterTestId').populate('labId', 'name').sort({ createdAt: -1 });
        res.json({ success: true, data: tests });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// @desc    Save or Update Lab Package (Prevents Duplicate Template Packages for same lab)
// @route   POST /provider/labs/services/packages/save
// @access  Private (Lab)
const saveLabPackage = async (req, res) => {
    try {
        const { 
            id, masterPackageId, packageName, tests, 
            mrp, discountPercent, reportTime, description, precaution,
            gender, ageGroup,
            shortDescription, longDescription, mainCategory, category, sampleTypes,
            isFastingRequired, fastingDuration, preparations, detailedDescription, faqs,
            tags, lifestyleTags, packageImage
        } = req.body;

        let finalTests = [];
        let finalName = packageName;
        let finalSampleTypes = [];
        let isCustom = true;

        let masterTemplateData = {};

        if (masterPackageId && masterPackageId !== "") {
            const masterPkg = await MasterLabPackage.findById(masterPackageId);
            if (!masterPkg) return res.status(404).json({ success: false, message: "Master Package not found" });
            
            finalTests = masterPkg.tests; 
            finalName = masterPkg.packageName;
            finalSampleTypes = masterPkg.sampleTypes || []; 
            isCustom = false;
            masterTemplateData = masterPkg;
        } else {
            finalTests = typeof tests === 'string' ? JSON.parse(tests) : tests;
            if (!finalTests || finalTests.length === 0) {
                return res.status(400).json({ success: false, message: "No tests selected for custom package" });
            }
        }

        if (finalSampleTypes.length === 0) {
            const testsData = await MasterLabTest.find({ _id: { $in: finalTests } });
            finalSampleTypes = [...new Set(testsData.map(t => t.sampleType))].filter(Boolean);
        }

        const packageMRP = parseFloat(mrp) || 0;
        const disc = parseFloat(discountPercent) || 0;
        const calculatedOfferPrice = Math.max(0, packageMRP - (packageMRP * (disc / 100)));

        const parsedDetailedDesc = typeof detailedDescription === 'string' ? JSON.parse(detailedDescription) : detailedDescription;
        const parsedFaqs = typeof faqs === 'string' ? JSON.parse(faqs) : faqs;
        const parsedPreparations = typeof preparations === 'string' ? JSON.parse(preparations) : preparations;
        const parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
        const parsedLifestyleTags = typeof lifestyleTags === 'string' ? JSON.parse(lifestyleTags) : lifestyleTags;

        let uploadedPackageImage = packageImage || masterTemplateData.packageImage || "";
        if (req.files && req.files.photos && req.files.photos[0]) {
            uploadedPackageImage = `/uploads/lab_services/${req.files.photos[0].filename}`;
        }

        const precautionStringFallback = parsedPreparations 
            ? parsedPreparations.join(", ") 
            : (precaution || masterTemplateData.preparations?.join(", ") || "");

        const payload = {
            labId: req.user.id,
            masterPackageId: !isCustom ? masterPackageId : null,
            isCustom,
            packageName: finalName,
            tests: finalTests,
            totalTestsIncluded: finalTests.length,
            mrp: packageMRP,
            discountPercent: disc,
            offerPrice: calculatedOfferPrice,
            sampleType: finalSampleTypes,
            precaution: precautionStringFallback,
            description: description || shortDescription || masterTemplateData.shortDescription || "",
            shortDescription: shortDescription || masterTemplateData.shortDescription || "",
            longDescription: longDescription || masterTemplateData.longDescription || "",
            mainCategory: mainCategory || masterTemplateData.mainCategory || "Pathology",
            category: category || masterTemplateData.category || "",
            sampleTypes: finalSampleTypes,
            reportTime: reportTime || masterTemplateData.reportTime || "24 Hours",
            isFastingRequired: isFastingRequired !== undefined ? (isFastingRequired === 'true' || isFastingRequired === true) : (masterTemplateData.isFastingRequired || false),
            fastingDuration: fastingDuration || masterTemplateData.fastingDuration || "",
            preparations: parsedPreparations || masterTemplateData.preparations || [],
            detailedDescription: parsedDetailedDesc || masterTemplateData.detailedDescription || [],
            faqs: parsedFaqs || masterTemplateData.faqs || [],
            gender: gender || masterTemplateData.gender || "Both",
            ageGroup: ageGroup || masterTemplateData.ageGroup || "All",
            tags: parsedTags || masterTemplateData.tags || [],
            lifestyleTags: parsedLifestyleTags || masterTemplateData.lifestyleTags || [],
            packageImage: uploadedPackageImage
        };

        let result;
        if (id) {
            result = await LabPackage.findOneAndUpdate({ _id: id, labId: req.user.id }, { $set: payload }, { new: true });
        } else if (masterPackageId && !isCustom) {
            // Upsert template package to prevent duplicate entries for the same lab
            result = await LabPackage.findOneAndUpdate(
                { labId: req.user.id, masterPackageId },
                { $set: payload },
                { upsert: true, new: true }
            );
        } else {
            result = await LabPackage.create(payload);
        }

        res.status(200).json({ success: true, message: "Package saved successfully", data: result });
    } catch (error) { 
        console.error("saveLabPackage Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// endpoint: GET /provider/labs/services/packages/my-packages
const getMyPackages = async (req, res) => {
    try {
        const packages = await LabPackage.find({ labId: req.user.id }).populate('tests');
        res.json({ success: true, data: packages });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 3. COMMON ACTIONS
// ==========================================

// endpoint: DELETE /provider/labs/services/service/delete/:type/:id
const deleteService = async (req, res) => {
    try {
        const Model = req.params.type === 'test' ? LabTest : LabPackage;
        const deleted = await Model.findOneAndDelete({ _id: req.params.id, labId: req.user.id });
        
        if (!deleted) return res.status(404).json({ message: "Item not found" });
        res.json({ success: true, message: "Deleted successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// 4. GET SPECIFIC MASTER TEST DETAILS (Figma logic: Auto-fill fields)
// endpoint: GET /provider/lab/services/master-test-details/:masterTestId
const getMasterTestDetails = async (req, res) => {
    try {
        const test = await MasterLabTest.findById(req.params.masterTestId);
        if (!test) return res.status(404).json({ message: "Test not found" });
        res.json({ success: true, data: test });
    } catch (error) { res.status(500).json({ message: error.message }); }
};



const getMasterPackages = async (req, res) => {
    try {
        const packages = await MasterLabPackage.find({ isActive: true });
        res.json({ success: true, data: packages });
    } catch (error) { res.status(500).json({ message: error.message }); }           
}
// 5. GET SPECIFIC MASTER PACKAGE DETAILS (Figma logic: Auto-fill fields)
// endpoint: GET /provider/lab/services/master-package-details/:id
const getMasterPackageDetails = async (req, res) => {
    try {
        const pkg = await MasterLabPackage.findById(req.params.id).populate('tests');
        if (!pkg) return res.status(404).json({ message: "Not found" });
        res.json({ success: true, data: pkg });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const submitNewMasterRequest = async (req, res) => {
    try {
        const { requestType, data } = req.body; // requestType: 'Test' or 'Package'
        
        const newRequest = await MasterRequest.create({
            vendorId: req.user.id,
            vendorType: req.user.role, // Lab
            requestType,
            data, // Saari keys yahan Object me aayengi
            status: 'Pending'
        });

        res.json({ success: true, message: "Request submitted to Admin for approval", data: newRequest });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// @desc    Update Lab Test Pricing and TAT (Scoped strictly to logged-in lab)
// @route   PUT /provider/labs/services/update-test
// @access  Private (Lab)
const updateLabTest = async (req, res) => {
    try {
        const { id, amount, discountPercent, reportTime, precaution, testType, description } = req.body;
        const labId = req.user.id;

        if (!id) return res.status(400).json({ success: false, message: "Test ID is required" });
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ success: false, message: "Invalid Test ID format." });
        }

        const mrp = parseFloat(amount) || 0;
        const disc = parseFloat(discountPercent) || 0;
        const calculatedDiscountPrice = Math.max(0, mrp - (mrp * (disc / 100)));

        const payload = {
            amount: mrp,
            discountPercent: disc,
            discountPrice: calculatedDiscountPrice,
            reportTime,
            precaution,
            description,
            testType
        };

        // Strictly verify that this test belongs to the logged-in lab
        const updatedTest = await LabTest.findOneAndUpdate(
            { _id: id, labId }, 
            { $set: payload }, 
            { new: true }
        );

        if (!updatedTest) {
            return res.status(404).json({ success: false, message: "Test not found or unauthorized to edit." });
        }

        res.status(200).json({ success: true, message: "Test updated successfully", data: updatedTest });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
 
 
// @desc    Update Lab Package (Scoped strictly to logged-in lab)
// @route   PUT /provider/labs/services/update-package
// @access  Private (Lab)
const updateLabPackage = async (req, res) => {
    try {
        const {
            id, packageName, tests, mrp, discountPercent,
            reportTime, description, precaution, gender, ageGroup,
            shortDescription, longDescription, mainCategory, category,
            isFastingRequired, fastingDuration, preparations, detailedDescription, faqs,
            tags, lifestyleTags, packageImage
        } = req.body;
        const labId = req.user.id;

        if (!id) return res.status(400).json({ success: false, message: "Package ID is required" });
        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ success: false, message: "Invalid Package ID format." });
        }

        let updateData = {
            packageName, reportTime, description,
            precaution, gender, ageGroup,
            shortDescription, longDescription, mainCategory, category, fastingDuration
        };

        if (isFastingRequired !== undefined) {
            updateData.isFastingRequired = isFastingRequired === 'true' || isFastingRequired === true;
        }

        if (detailedDescription) updateData.detailedDescription = typeof detailedDescription === 'string' ? JSON.parse(detailedDescription) : detailedDescription;
        if (faqs) updateData.faqs = typeof faqs === 'string' ? JSON.parse(faqs) : faqs;
        
        if (preparations) {
            const parsedPreps = typeof preparations === 'string' ? JSON.parse(preparations) : preparations;
            updateData.preparations = parsedPreps;
            updateData.precaution = parsedPreps.join(", ");
        }
        
        if (tags) updateData.tags = typeof tags === 'string' ? JSON.parse(tags) : tags;
        if (lifestyleTags) updateData.lifestyleTags = typeof lifestyleTags === 'string' ? JSON.parse(lifestyleTags) : lifestyleTags;

        if (req.files && req.files.photos && req.files.photos[0]) {
            updateData.packageImage = `/uploads/lab_services/${req.files.photos[0].filename}`;
        } else if (packageImage) {
            updateData.packageImage = packageImage;
        }

        if (tests) {
            const finalTests = typeof tests === 'string' ? JSON.parse(tests) : tests;
            const testsData = await MasterLabTest.find({ _id: { $in: finalTests } });
            const resolvedSampleTypes = [...new Set(testsData.map(t => t.sampleType))].filter(Boolean);
            
            updateData.tests = finalTests;
            updateData.totalTestsIncluded = finalTests.length;
            updateData.sampleType = resolvedSampleTypes;
            updateData.sampleTypes = resolvedSampleTypes;
        }

        if (mrp) {
            const packageMRP = parseFloat(mrp);
            const disc = parseFloat(discountPercent) || 0;
            updateData.mrp = packageMRP;
            updateData.discountPercent = disc;
            updateData.offerPrice = Math.max(0, packageMRP - (packageMRP * (disc / 100)));
        }

        // Strictly verify that this package belongs to the logged-in lab
        const updatedPackage = await LabPackage.findOneAndUpdate(
            { _id: id, labId },
            { $set: updateData },
            { new: true }
        ).populate('tests');

        if (!updatedPackage) {
            return res.status(404).json({ success: false, message: "Package not found or unauthorized to edit." });
        }

        res.status(200).json({ success: true, message: "Package updated successfully", data: updatedPackage });
    } catch (error) {
        console.error("updateLabPackage Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
 



module.exports = { getMasterList,getStandardCatalogTests, getStandardPackages, saveLabTest, getMyTests, saveLabPackage, getMyPackages, deleteService,getMasterTestDetails,getMasterPackages, getMasterPackageDetails, submitNewMasterRequest,updateLabTest,updateLabPackage };