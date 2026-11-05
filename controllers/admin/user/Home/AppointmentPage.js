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

// 3. DOCTORS PRIORITY SECTION (Crash-Proof JSON Parser)
const updateDoctorsPriority = async (req, res) => {
    try {
        const { title, description, points } = req.body;
        
        let updateData = { title, description };

        if (points !== undefined) {
            if (typeof points === 'string') {
                try { updateData.points = JSON.parse(points); } catch (e) { updateData.points = points.split(',').map(s => s.trim()); }
            } else {
                updateData.points = points;
            }
        }

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

// 4. HOW TO SECURE SECTION (Crash-Proof JSON Parser)
const updateHowToSecure = async (req, res) => {
    try {
        const { header, title, items } = req.body;
        
        let updateData = { header, title };

        if (items !== undefined) {
            if (typeof items === 'string') {
                try { updateData.items = JSON.parse(items); } catch (e) { updateData.items = []; }
            } else {
                updateData.items = items;
            }
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

const getDoctorsPriority = async (req, res) => {
    try {
        const content = await FrontendContent.findOne({ section: 'doctorsPriority' });
        res.status(200).json({ success: true, data: content });
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