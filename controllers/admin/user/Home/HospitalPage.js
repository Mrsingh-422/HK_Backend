const FrontendContent = require('../../../../models/HomePage');

// Utility function to parse JSON arrays safely
const parseJsonField = (field) => {
    if (field && typeof field === 'string') {
        try { return JSON.parse(field); } catch (e) { return field; }
    }
    return field;
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
        const updateData = { ...req.body };
        
        // Ensure arrays sent as stringified JSON (from formData) are parsed properly
        updateData.carouselImages = parseJsonField(updateData.carouselImages);
        updateData.partners = parseJsonField(updateData.partners);

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'hospitalFacility' },
            { $set: updateData },
            { new: true, upsert: true }
        );
        res.status(200).json({ success: true, message: 'Hospital Facility updated', data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
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