const FrontendContent = require('../../../../models/HomePage');

// ==========================================
// 1. ABOUT US SECTION
// ==========================================

// @desc    Update or Create About Us Section
// @access  Private (Admin)
const updateAboutUs = async (req, res) => {
    try {
        const { 
            title, subtitle, 
            workDescription, missionDescription, achievementDescription 
        } = req.body;

        let updateData = {
            title,
            subtitle,
            workDescription,
            missionDescription,
            achievementDescription
        };

        // Handle Images: If new images are uploaded, replace/add them
        if (req.files && req.files.length > 0) {
            const imgPaths = req.files.map(file => `/uploads/homepage/${file.filename}`);
            updateData.images = imgPaths; 
        }

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'aboutUs' }, // Find by section name
            { $set: updateData },
            { returnDocument: 'after', upsert: true } 
        );

        res.status(200).json({ success: true, message: 'About Us section updated', data: content });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get About Us Data
// @access  Public
const getAboutUs = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'aboutUs' });
        res.status(200).json({ success: true, data: content });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


// ==========================================
// 2. AMBULANCE / HOMEPAGE SECTION
// ==========================================

// ==========================================
// 4. AMBULANCE SECTION
// ==========================================
const updateAmbulance = async (req, res) => {
    try {
        // Frontend sends: title, subtitle, introduction
        const { title, subtitle, introduction } = req.body;

        let updateData = { 
            title, 
            subtitle, 
            introduction // ✅ Updated Key to match frontend
        };

        // Handle Images
        if (req.files && req.files.length > 0) {
            updateData.images = req.files.map(file => `/uploads/homepage/${file.filename}`);
        }

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'ambulance' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Ambulance section updated', data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getAmbulance = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'ambulance' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};


// ==========================================
// 3. HOMEPAGE (MAIN/HERO) SECTION
// ==========================================
// Matches Frontend Form: Title, Subtitle, Images

// @desc    Update Homepage Main Section
// @route   POST /api/homepage/main
const updateHomepageSection = async (req, res) => {
    try {
        const { title, subtitle } = req.body;

        let updateData = {
            title,
            subtitle
        };

        // Handle Images
        if (req.files && req.files.length > 0) {
            const imgPaths = req.files.map(file => `/uploads/homepage/${file.filename}`);
            updateData.images = imgPaths; 
        }

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'homepage' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Homepage section updated', data: content });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get Homepage Main Section
// @route   GET /api/homepage/main
const getHomepageSection = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'homepage' });
        res.status(200).json({ success: true, data: content });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


// ==========================================
// 4. INTRODUCTION SECTION
// ==========================================
// Matches Frontend Form: Title, Subtitle, Introduction, Images

// @desc    Update Introduction Section
// @route   POST /api/homepage/introduction
const updateIntroductionSection = async (req, res) => {
    try {
        const { title, subtitle, introduction } = req.body;

        let updateData = {
            title,
            subtitle,
            introduction // Matches the textarea name="introduction"
        };

        // Handle Images
        if (req.files && req.files.length > 0) {
            const imgPaths = req.files.map(file => `/uploads/homepage/${file.filename}`);
            updateData.images = imgPaths; 
        }

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'introduction' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Introduction section updated', data: content });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get Introduction Section
// @route   GET /api/homepage/introduction
const getIntroductionSection = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'introduction' });
        res.status(200).json({ success: true, data: content });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


// ==========================================
// 5. GET HEALTH APP SECTION
// ==========================================
const updateAppSection = async (req, res) => {
    try {
        const { title, description, androidLink, iosLink } = req.body;
        let updateData = { title, description, androidLink, iosLink };

        if (req.files && req.files.length > 0) {
            updateData.images = req.files.map(file => `/uploads/homepage/${file.filename}`);
        }

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'getHealthApp' },
            { $set: updateData },
            { new: true, upsert: true }
        );
        res.status(200).json({ success: true, message: 'App section updated', data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getAppSection = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'getHealthApp' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 6. HOSPITALS SECTION
// ==========================================
const updateHospitalSection = async (req, res) => {
    try {
        // Frontend sends: title, subtitle, introduction
        const { title, subtitle, introduction } = req.body;

        let updateData = { 
            title, 
            subtitle, 
            introduction // ✅ Updated Key to match frontend
        };

        // Handle Images
        if (req.files && req.files.length > 0) {
            updateData.images = req.files.map(file => `/uploads/homepage/${file.filename}`);
        }

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'hospitals' }, // Matches enum in Model
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Hospital section updated', data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getHospitalSection = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'hospitals' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// ==========================================
// 7. NURSING SECTION
// ==========================================
const updateNursingSection = async (req, res) => {
    try {
        // Frontend sends: title, subtitle, introduction
        const { title, subtitle, introduction } = req.body;

        let updateData = { 
            title, 
            subtitle, 
            introduction // ✅ Updated Key to match frontend
        };

        // Handle Images
        if (req.files && req.files.length > 0) {
            updateData.images = req.files.map(file => `/uploads/homepage/${file.filename}`);
        }

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'nursing' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Nursing section updated', data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getNursingSection = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'nursing' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};



// ==========================================
// 8. FEATURED PRODUCTS (MEDICINE) SECTION
// ==========================================
const updateFeaturedProducts = async (req, res) => {
    try {
        const { title, subtitle, introduction } = req.body;
        let updateData = { title, subtitle, introduction };

        // Handle Images
        if (req.files && req.files.length > 0) {
            updateData.images = req.files.map(file => `/uploads/homepage/${file.filename}`);
        }

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'featuredProducts' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Featured Products section updated', data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getFeaturedProducts = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'featuredProducts' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


// ==========================================
// 9. LABORATORY SECTION
// ==========================================
const updateLaboratory = async (req, res) => {
    try {
        const { title, subtitle, introduction } = req.body;
        let updateData = { title, subtitle, introduction };

        // Handle Images
        if (req.files && req.files.length > 0) {
            updateData.images = req.files.map(file => `/uploads/homepage/${file.filename}`);
        }

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'laboratory' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Laboratory section updated', data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getLaboratory = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'laboratory' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { res.status(500).json({ message: error.message }); }
};




module.exports = {
    updateAboutUs,
    getAboutUs,
    updateAmbulance,
    getAmbulance,

    updateAppSection, getAppSection,
    updateHospitalSection, getHospitalSection,
    updateNursingSection, getNursingSection,
     updateHomepageSection, getHomepageSection,
    updateIntroductionSection, getIntroductionSection ,
    updateFeaturedProducts, getFeaturedProducts,
    updateLaboratory, getLaboratory,
};