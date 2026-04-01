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


// endpoint: PUT /admin/doctor-data/update-specialization/:id
const updateSpecialization = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, isActive } = req.body;

        const specialization = await Specialization.findById(id);
        if (!specialization) {
            return res.status(404).json({ message: "Specialization not found" });
        }

        // Duplicate check (if name is changing)
        if (name && name !== specialization.name) {
            const exists = await Specialization.findOne({ name });
            if (exists) {
                return res.status(400).json({ message: "Specialization already exists" });
            }
        }

        specialization.name = name || specialization.name;
        if (typeof isActive !== "undefined") {
            specialization.isActive = isActive;
        }

        await specialization.save();

        res.json({ success: true, message: "Specialization updated", data: specialization });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
// endpoint: DELETE /admin/doctor-data/delete-specialization/:id
const deleteSpecialization = async (req, res) => {
    try {
        const { id } = req.params;

        const specialization = await Specialization.findById(id);
        if (!specialization) {
            return res.status(404).json({ message: "Specialization not found" });
        }

        // Soft delete
        specialization.isActive = false;
        await specialization.save();

        res.json({ success: true, message: "Specialization deleted (soft)" });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// endpoint: PUT /admin/doctor-data/update-qualification/:id
const updateQualification = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, isActive } = req.body;

        const qualification = await Qualification.findById(id);
        if (!qualification) {
            return res.status(404).json({ message: "Qualification not found" });
        }

        // Duplicate check
        if (name && name !== qualification.name) {
            const exists = await Qualification.findOne({ name });
            if (exists) {
                return res.status(400).json({ message: "Qualification already exists" });
            }
        }

        qualification.name = name || qualification.name;
        if (typeof isActive !== "undefined") {
            qualification.isActive = isActive;
        }

        await qualification.save();

        res.json({ success: true, message: "Qualification updated", data: qualification });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// endpoint: DELETE /admin/doctor-data/delete-qualification/:id
const deleteQualification = async (req, res) => {
    try {
        const { id } = req.params;

        const qualification = await Qualification.findById(id);
        if (!qualification) {
            return res.status(404).json({ message: "Qualification not found" });
        }

        // Soft delete
        qualification.isActive = false;
        await qualification.save();

        res.json({ success: true, message: "Qualification deleted (soft)" });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
module.exports = {
    addSpecialization,
    getSpecializations,
    addQualification,
    getQualifications,
    updateSpecialization,
    deleteSpecialization,
    updateQualification,
    deleteQualification
};