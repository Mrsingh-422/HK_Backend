const LabContent = require('../../../../models/HomePage'); // Apna model import karein (eg. LabPageContent ya FrontendContent)

// ==========================================
// 1. SEARCH TEST SECTION
// ==========================================
const updateSearchTest = async (req, res) => {
    try {
        const { miniTitle, mainTitle, description, searchLabel } = req.body;
        
        let updateData = { miniTitle, mainTitle, description, searchLabel };

        const content = await LabContent.findOneAndUpdate(
            { section: 'searchTest' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Search Test section updated', data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getSearchTest = async (req, res) => {
    try {
        const content = await LabContent.findOne({ section: 'searchTest' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// ==========================================
// 2. PRESCRIPTION TEST SECTION
// ==========================================
const updatePrescriptionTest = async (req, res) => {
    try {
        const { miniTitle, mainTitle, bulkTitle, bulkDescription, mainDescription, badgeText } = req.body;
        
        let updateData = { miniTitle, mainTitle, bulkTitle, bulkDescription, mainDescription, badgeText };

        if (req.files && req.files.length > 0) {
            updateData.images = req.files.map(file => `/uploads/homepage/${file.filename}`);
        }

        const content = await LabContent.findOneAndUpdate(
            { section: 'prescriptionTest' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Prescription section updated', data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getPrescriptionTest = async (req, res) => {
    try {
        const content = await LabContent.findOne({ section: 'prescriptionTest' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// ==========================================
// 3. HOW IT WORKS SECTION
// ==========================================
const updateHowItWorks = async (req, res) => {
    try {
        const { mainTitle, steps } = req.body;
        let updateData = { mainTitle };

        // Parse JSON string array from FormData
        if (steps) {
            updateData.steps = typeof steps === 'string' ? JSON.parse(steps) : steps;
        }

        const content = await LabContent.findOneAndUpdate(
            { section: 'howItWorks' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'How It Works section updated', data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getHowItWorks = async (req, res) => {
    try {
        const content = await LabContent.findOne({ section: 'howItWorks' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// ==========================================
// 4. LAB CARE SECTION
// ==========================================
const updateLabCare = async (req, res) => {
    try {
        const { title, description, buttonText, statusLabel, statusValue, features } = req.body;
        
        let updateData = { title, description, buttonText, statusLabel, statusValue };

        if (features) {
            updateData.features = typeof features === 'string' ? JSON.parse(features) : features;
        }

        if (req.files && req.files.length > 0) {
            updateData.images = req.files.map(file => `/uploads/homepage/${file.filename}`);
        }

        const content = await LabContent.findOneAndUpdate(
            { section: 'labCare' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Lab Care section updated', data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getLabCare = async (req, res) => {
    try {
        const content = await LabContent.findOne({ section: 'labCare' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// ==========================================
// 5. ABOUT LAB SECTION
// ==========================================
const updateAboutLab = async (req, res) => {
    try {
        const { title, subtitle, description, skills } = req.body;
        
        let updateData = { title, subtitle, description };

        if (skills) {
            updateData.skills = typeof skills === 'string' ? JSON.parse(skills) : skills;
        }

        if (req.files && req.files.length > 0) {
            updateData.images = req.files.map(file => `/uploads/homepage/${file.filename}`);
        }

        const content = await LabContent.findOneAndUpdate(
            { section: 'aboutLab' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'About Lab section updated', data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getAboutLab = async (req, res) => {
    try {
        const content = await LabContent.findOne({ section: 'aboutLab' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// ==========================================
// 6. RESEARCH & VERIFY SECTION
// ==========================================
const updateResearchSection = async (req, res) => {
    try {
        const { title, subtitle, description, phone1, phone2, buttonText, features } = req.body;
        
        let updateData = { title, subtitle, description, phone1, phone2, buttonText };

        if (features) {
            updateData.features = typeof features === 'string' ? JSON.parse(features) : features;
        }

        if (req.files && req.files.length > 0) {
            updateData.images = req.files.map(file => `/uploads/homepage/${file.filename}`);
        }

        const content = await LabContent.findOneAndUpdate(
            { section: 'research' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Research section updated', data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getResearchSection = async (req, res) => {
    try {
        const content = await LabContent.findOne({ section: 'research' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

module.exports = {
    updateSearchTest, getSearchTest,
    updatePrescriptionTest, getPrescriptionTest,
    updateHowItWorks, getHowItWorks,
    updateLabCare, getLabCare,
    updateAboutLab, getAboutLab,
    updateResearchSection, getResearchSection
};