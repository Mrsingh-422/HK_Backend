const Specialization = require('../../../models/Specialization');
const Qualification = require('../../../models/Qualification');

// --- 1. SPECIALIZATION APIs ---

// Add (Admin Only)
// endpoint: POST /admin/doctor-data/add-specialization
const addSpecialization = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ message: "Name is required" });

        // Duplicate Check
        const exists = await Specialization.findOne({ name });
        if (exists) return res.status(400).json({ message: "Specialization already exists" });

        const data = await Specialization.create({ name });
        res.status(201).json({ success: true, message: "Specialization Added", data });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get List (For Dropdown - Public)
// endpoint: GET /admin/doctor-data/specializations
const getSpecializations = async (req, res) => {
    try {
        const list = await Specialization.find({ isActive: true }).select('name _id');
        res.json({ success: true, data: list });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 2. QUALIFICATION APIs ---

// Add (Admin Only)
// endpoint: POST /admin/doctor-data/add-qualification
const addQualification = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ message: "Name is required" });

        const exists = await Qualification.findOne({ name });
        if (exists) return res.status(400).json({ message: "Qualification already exists" });

        const data = await Qualification.create({ name });
        res.status(201).json({ success: true, message: "Qualification Added", data });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Get List (For Dropdown - Public)
// endpoint: GET /admin/doctor-data/qualifications
const getQualifications = async (req, res) => {
    try {
        const list = await Qualification.find({ isActive: true }).select('name _id');
        res.json({ success: true, data: list });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    addSpecialization,
    getSpecializations,
    addQualification,
    getQualifications
};