const FrontendContent = require('../../../../models/HomePage'); // Apna model import karein (eg. NursePageContent ya FrontendContent)

// Utility function to handle parsed data properly (Supports JSON strings or direct arrays)
const parseJsonField = (field) => {
    if (field && typeof field === 'string') {
        try { return JSON.parse(field); } catch (e) { return field; }
    }
    return field;
};

// Utility function to merge Old Images and New Uploaded Images
const processImages = (existingImages, files) => {
    let finalImages =[];
    
    // 1. Handle existing images (coming as string or array of strings)
    if (existingImages) {
        if (Array.isArray(existingImages)) {
            finalImages =[...existingImages];
        } else {
            finalImages.push(existingImages); // if only one existing image
        }
    }

    // 2. Handle new uploaded files via Multer
    if (files && files.length > 0) {
        const newImages = files.map(file => `/uploads/homepage/${file.filename}`);
        finalImages = [...finalImages, ...newImages];
    }

    return finalImages;
};

// Utility to handle array fields sent via FormData like 'services[]'
const processFormDataArray = (reqBody, fieldName) => {
    let arr = reqBody[`${fieldName}[]`] || reqBody[fieldName] || [];
    return Array.isArray(arr) ? arr : [arr];
};

// ==========================================
// 1. NURSE PAGE MAIN HERO
// ==========================================
const updateNurseHero = async (req, res) => {
    try {
        const content = await FrontendContent.findOneAndUpdate(
            { section: 'nurseHero' },
            { $set: req.body },
            { new: true, upsert: true }
        );
        res.status(200).json({ success: true, message: 'Nurse Hero Page updated', data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getNurseHero = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'nurseHero' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 2. NURSE PRESCRIPTION SECTION
// ==========================================
const updateNursePrescription = async (req, res) => {
    try {
        const { sectionTag, mainTitle, titleEmoji, subTitle, description, uploadLabel, uploadBtnText, existingImages } = req.body;
        
        let updateData = { sectionTag, mainTitle, titleEmoji, subTitle, description, uploadLabel, uploadBtnText };
        
        // Merge old and new images
        updateData.carouselImages = processImages(existingImages, req.files);

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'nursePrescription' },
            { $set: updateData },
            { new: true, upsert: true }
        );
        res.status(200).json({ success: true, message: 'Nurse Prescription updated', data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getNursePrescription = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'nursePrescription' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 3. NURSING STEPS SECTION
// ==========================================
const updateNursingSteps = async (req, res) => {
    try {
        const updateData = { ...req.body };
        updateData.steps = parseJsonField(updateData.steps);

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'nursingSteps' },
            { $set: updateData },
            { new: true, upsert: true }
        );
        res.status(200).json({ success: true, message: 'Nursing Steps updated', data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getNursingSteps = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'nursingSteps' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 4. OUR NURSING SERVICES
// ==========================================
const updateNursingServices = async (req, res) => {
    try {
        const { title, description, existingImages } = req.body;
        
        let updateData = { title, description };
        
        // Extract services array safely
        updateData.services = processFormDataArray(req.body, 'services');
        
        // Merge old and new images
        updateData.carouselImages = processImages(existingImages, req.files);

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'nursingServices' },
            { $set: updateData },
            { new: true, upsert: true }
        );
        res.status(200).json({ success: true, message: 'Nursing Services updated', data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getNursingServices = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'nursingServices' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 5. EXPERIENCED NURSES SECTION
// ==========================================
const updateExperiencedNurses = async (req, res) => {
    try {
        const content = await FrontendContent.findOneAndUpdate(
            { section: 'experiencedNurses' },
            { $set: req.body },
            { new: true, upsert: true }
        );
        res.status(200).json({ success: true, message: 'Experienced Nurses updated', data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getExperiencedNurses = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'experiencedNurses' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 6. ONLY THE BEST CARE SECTION
// ==========================================
const updateOnlyTheBestCare = async (req, res) => {
    try {
        const { title, subheading, description, existingImages } = req.body;
        
        let updateData = { title, subheading, description };

        // Extract points array safely
        updateData.points = processFormDataArray(req.body, 'points');

        // Merge old and new images
        updateData.carouselImages = processImages(existingImages, req.files);

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'onlyTheBestCare' },
            { $set: updateData },
            { new: true, upsert: true }
        );
        res.status(200).json({ success: true, message: 'Best Care section updated', data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getOnlyTheBestCare = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'onlyTheBestCare' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = {
    updateNurseHero, getNurseHero,
    updateNursePrescription, getNursePrescription,
    updateNursingSteps, getNursingSteps,
    updateNursingServices, getNursingServices,
    updateExperiencedNurses, getExperiencedNurses,
    updateOnlyTheBestCare, getOnlyTheBestCare
};