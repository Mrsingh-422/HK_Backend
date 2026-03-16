const FrontendContent = require('../../../../models/HomePage');

// ==========================================
// 1. MANAGE PHARMACY PAGE SECTION
// ==========================================
const updatePharmacyPage = async (req, res) => {
    try {
        const updateData = req.body; 
        // Destructures all fields coming from pharmacy form directly

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'pharmacyPage' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Pharmacy page updated', data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getPharmacyPage = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'pharmacyPage' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// ==========================================
// 2. FEATURED PRODUCTS (ONLINE PHARMACY)
// ==========================================
const updateFeaturedProducts = async (req, res) => {
    try {
        const { tag, title } = req.body;
        let updateData = { tag, title };

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'onlinePharmacyFeatured' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Featured products updated', data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getFeaturedProducts = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'onlinePharmacyFeatured' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// ==========================================
// 3. BOOK PRESCRIPTION TEST SECTION (MEDICINE)
// ==========================================
const updateMedicinePrescription = async (req, res) => {
    try {
        const { miniTitle, mainTitle, bulkTitle, bulkDescription, mainDescription, badgeText } = req.body;
        let updateData = { miniTitle, mainTitle, bulkTitle, bulkDescription, mainDescription, badgeText };

        if (req.files && req.files.length > 0) {
            updateData.images = req.files.map(file => `/uploads/homepage/${file.filename}`);
        }

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'medicinePrescription' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Medicine prescription updated', data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getMedicinePrescription = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'medicinePrescription' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// ==========================================
// 4. BEST OF BEST SECTION
// ==========================================
const updateBestOfBest = async (req, res) => {
    try {
        const { miniTitle, mainTitle, description, buttonText, statusText } = req.body;
        let updateData = { miniTitle, mainTitle, description, buttonText, statusText };

        if (req.files && req.files.length > 0) {
            updateData.images = req.files.map(file => `/uploads/homepage/${file.filename}`);
        }

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'bestOfBest' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Best of Best updated', data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getBestOfBest = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'bestOfBest' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// ==========================================
// 5. RECOMMENDED MEDICINES SECTION
// ==========================================
const updateRecommendedMed = async (req, res) => {
    try {
        const { miniTitle, mainTitle, description, statusText, buttonText } = req.body;
        let updateData = { miniTitle, mainTitle, description, statusText, buttonText };

        if (req.files && req.files.length > 0) {
            updateData.images = req.files.map(file => `/uploads/homepage/${file.filename}`);
        }

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'recommendedMed' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Recommended Medicines updated', data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getRecommendedMed = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'recommendedMed' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// ==========================================
// 6. ABOUT MEDICINE SECTION
// ==========================================
const updateAboutMedicine = async (req, res) => {
    try {
        const { title, subtitle, description, skills } = req.body;
        let updateData = { title, subtitle, description };

        if (skills) {
            updateData.skills = typeof skills === 'string' ? JSON.parse(skills) : skills;
        }

        if (req.files && req.files.length > 0) {
            updateData.images = req.files.map(file => `/uploads/homepage/${file.filename}`);
        }

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'aboutMedicine' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'About Medicine updated', data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getAboutMedicine = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'aboutMedicine' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

module.exports = {
    updatePharmacyPage, getPharmacyPage,
    updateFeaturedProducts, getFeaturedProducts,
    updateMedicinePrescription, getMedicinePrescription,
    updateBestOfBest, getBestOfBest,
    updateRecommendedMed, getRecommendedMed,
    updateAboutMedicine, getAboutMedicine
};