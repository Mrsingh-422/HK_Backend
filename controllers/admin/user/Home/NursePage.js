const FrontendContent = require('../../../../models/HomePage'); // Apna model import karein (eg. NursePageContent ya FrontendContent)

// Utility function to handle parsed data properly (Supports both JSON & FormData strings)
const parseJsonField = (field) => {
    if (field && typeof field === 'string') {
        try { return JSON.parse(field); } catch (e) { return field; }
    }
    return field;
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
        const updateData = { ...req.body };
        updateData.carouselImages = parseJsonField(updateData.carouselImages);

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
        const updateData = { ...req.body };
        updateData.services = parseJsonField(updateData.services);
        updateData.carouselImages = parseJsonField(updateData.carouselImages);

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
        const updateData = { ...req.body };
        updateData.points = parseJsonField(updateData.points);
        updateData.carouselImages = parseJsonField(updateData.carouselImages);

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