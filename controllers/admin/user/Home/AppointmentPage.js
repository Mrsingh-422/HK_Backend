const FrontendContent = require('../../../../models/HomePage'); 

// ==========================================
// 1. FIND MY DOCTOR SECTION
// ==========================================
const updateFindDoctor = async (req, res) => {
    try {
        const { headerTag, titlePart1, titlePart2, description } = req.body;
        
        let updateData = { headerTag, titlePart1, titlePart2, description };

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'findDoctor' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Find Doctor section updated', data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getFindDoctor = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'findDoctor' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// ==========================================
// 2. FIND CONSULTANT SECTION
// ==========================================
const updateFindConsultant = async (req, res) => {
    try {
        const { miniTitle, mainTitle, subTitle, description } = req.body;
        
        let updateData = { miniTitle, mainTitle, subTitle, description };

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'findConsultant' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Consultant section updated', data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getFindConsultant = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'findConsultant' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// ==========================================
// 3. DOCTORS PRIORITY SECTION
// ==========================================
const updateDoctorsPriority = async (req, res) => {
    try {
        const { title, description, points } = req.body;
        
        let updateData = { title, description };

        // Parse JSON string array from FormData
        if (points) {
            updateData.points = typeof points === 'string' ? JSON.parse(points) : points;
        }

        // Handle Images (Path same as homepage since you are using contentUploads)
        if (req.files && req.files.length > 0) {
            updateData.images = req.files.map(file => `/uploads/homepage/${file.filename}`);
        }

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'doctorsPriority' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Doctors Priority section updated', data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getDoctorsPriority = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'doctorsPriority' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// ==========================================
// 4. HOW TO SECURE SECTION
// ==========================================
const updateHowToSecure = async (req, res) => {
    try {
        const { header, title, items } = req.body;
        
        let updateData = { header, title };

        // Parse JSON string array of objects from FormData
        if (items) {
            updateData.items = typeof items === 'string' ? JSON.parse(items) : items;
        }

        const content = await FrontendContent.findOneAndUpdate(
            { section: 'howToSecure' },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Security section updated', data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

const getHowToSecure = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'howToSecure' });
        res.status(200).json({ success: true, data: content });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

module.exports = {
    updateFindDoctor, getFindDoctor,
    updateFindConsultant, getFindConsultant,
    updateDoctorsPriority, getDoctorsPriority,
    updateHowToSecure, getHowToSecure
};