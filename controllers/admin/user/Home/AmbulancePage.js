const FrontendContent = require('../../../../models/HomePage'); // Model import

// Utility to merge Old Image URLs and New Uploaded Files
const processImages = (existingImages, files) => {
    let finalImages = [];
    
    // 1. Existing images (can be array or string)
    if (existingImages) {
        finalImages = Array.isArray(existingImages) ? existingImages : [existingImages];
    }

    // 2. Add new files from Multer
    if (files && files.length > 0) {
        const newImages = files.map(file => `/uploads/homepage/${file.filename}`);
        finalImages = [...finalImages, ...newImages];
    }
    return finalImages;
};

const parseJsonField = (field) => {
    if (field && typeof field === 'string') {
        try { return JSON.parse(field); } catch (e) { return field; }
    }
    return field;
};

// ==========================================
// 1. AMBULANCE PAGE (LEFT SECTION)
// ==========================================
const updateAmbulanceHero = async (req, res) => {
    try {
        const updateData = { ...req.body };
        updateData.categories = parseJsonField(updateData.categories);
        const content = await FrontendContent.findOneAndUpdate(
            { section: 'ambulanceHero' },
            { $set: updateData },
            { new: true, upsert: true }
        );
        res.status(200).json({ success: true, message: 'Ambulance Page updated', data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getAmbulanceHero = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'ambulanceHero' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 2. REFERRAL AMBULANCE HERO SECTION
// ==========================================
const updateReferralAmbulanceHero = async (req, res) => {
    try {
        const updateData = { ...req.body };
        updateData.categories = parseJsonField(updateData.categories);
        const content = await FrontendContent.findOneAndUpdate(
            { section: 'ambulanceReferralHero' },
            { $set: updateData },
            { new: true, upsert: true }
        );
        res.status(200).json({ success: true, message: 'Referral Ambulance Page updated', data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getReferralAmbulanceHero = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'ambulanceReferralHero' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 3. EMERGENCY FACILITY SECTION
// ==========================================
const updateEmergencyFacility = async (req, res) => {
    try {
        const content = await FrontendContent.findOneAndUpdate(
            { section: 'emergencyFacility' },
            { $set: req.body },
            { new: true, upsert: true }
        );
        res.status(200).json({ success: true, message: 'Emergency Facility updated', data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getEmergencyFacility = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'emergencyFacility' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 4. ACCIDENTAL EMERGENCY SECTION
// ==========================================
const updateAccidentalEmergency = async (req, res) => {
    try {
        const { sectionTag, mainTitle, description, buttonText, existingImages } = req.body;
        let updateData = { sectionTag, mainTitle, description, buttonText };
        
        // Merge URLs with new Multer files (key: 'carouselImages')
        updateData.carouselImages = processImages(existingImages, req.files);

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'accidentalEmergency' },
            { $set: updateData },
            { new: true, upsert: true }
        );
        res.status(200).json({ success: true, message: 'Accidental Emergency updated', data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getAccidentalEmergency = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'accidentalEmergency' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 5. MEDICAL EMERGENCY SECTION
// ==========================================
const updateMedicalEmergency = async (req, res) => {
    try {
        const { title, description, highlightText, buttonText, existingImages } = req.body;
        let updateData = { title, description, highlightText, buttonText };

        updateData.carouselImages = processImages(existingImages, req.files);

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'medicalEmergency' },
            { $set: updateData },
            { new: true, upsert: true }
        );
        res.status(200).json({ success: true, message: 'Medical Emergency updated', data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getMedicalEmergency = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'medicalEmergency' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 6. SAVE REFERRAL AMBULANCE SECTION
// ==========================================
const updateReferralAmbulance = async (req, res) => {
    try {
        const { tagline, subHeader, description, buttonText, badgeText, existingImages } = req.body;
        let updateData = { tagline, subHeader, description, buttonText, badgeText };

        updateData.carouselImages = processImages(existingImages, req.files);

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'referralAmbulance' },
            { $set: updateData },
            { new: true, upsert: true }
        );
        res.status(200).json({ success: true, message: 'Referral Services updated', data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getReferralAmbulance = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'referralAmbulance' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = {
    updateAmbulanceHero, getAmbulanceHero,
    updateReferralAmbulanceHero, getReferralAmbulanceHero,
    updateEmergencyFacility, getEmergencyFacility,
    updateAccidentalEmergency, getAccidentalEmergency,
    updateMedicalEmergency, getMedicalEmergency,
    updateReferralAmbulance, getReferralAmbulance
};