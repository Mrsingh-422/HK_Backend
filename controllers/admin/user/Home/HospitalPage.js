const FrontendContent = require('../../../../models/HomePage');

// Utility to parse JSON fields if sent as string from FormData
const parseJsonField = (field) => {
    if (field && typeof field === 'string') {
        try { return JSON.parse(field); } catch (e) { return field; }
    }
    return field;
};

// Utility to handle images (supports new uploads + existing URL strings)
const processHospitalImages = (existingImages, files) => {
    let finalImages = [];
    
    // 1. Handle existing images (can be array or single string from form)
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

// ==========================================
// 1. HOSPITAL PAGE (HERO / SEARCH SECTION)
// ==========================================
const updateHospitalHero = async (req, res) => {
    try {
        const content = await FrontendContent.findOneAndUpdate(
            { section: 'hospitalHero' },
            { $set: req.body },
            { new: true, upsert: true }
        );
        res.status(200).json({ success: true, message: 'Hospital Hero Page updated', data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getHospitalHero = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'hospitalHero' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 2. HOSPITAL FACILITY SECTION
// ==========================================
const updateHospitalFacility = async (req, res) => {
    try {
        const { tagline, titlePart1, titlePart2, description, badgeText, existingImages } = req.body;
        
        let updateData = { tagline, titlePart1, titlePart2, description, badgeText };
        
        // Parse partners if sent as stringified JSON
        updateData.partners = parseJsonField(req.body.partners);
        
        // Merge old image URLs and new uploaded files
        updateData.carouselImages = processHospitalImages(existingImages, req.files);

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'hospitalFacility' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Hospital Facility updated', data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getHospitalFacility = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'hospitalFacility' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 3. MAIN "HOW IT WORKS" SECTION
// ==========================================
const updateMainHowItWorks = async (req, res) => {
    try {
        const updateData = { ...req.body };
        
        // Parse arrays
        updateData.steps = parseJsonField(updateData.steps);
        updateData.partners = parseJsonField(updateData.partners);

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'mainHowItWorks' },
            { $set: updateData },
            { new: true, upsert: true }
        );
        res.status(200).json({ success: true, message: 'How It Works updated', data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getMainHowItWorks = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'mainHowItWorks' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = {
    updateHospitalHero, getHospitalHero,
    updateHospitalFacility, getHospitalFacility,
    updateMainHowItWorks, getMainHowItWorks
};