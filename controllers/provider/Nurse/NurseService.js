const NurseService = require('../../../models/NurseService');

// 1. ADD SERVICE (Figma Screen 42: Daily Care/Packages)
const addNurseService = async (req, res) => {
    try {
        const { type, title, price, description, prescriptionRequired } = req.body;
        const photos = req.files ? req.files.map(f => f.path) : [];

        const service = await NurseService.create({
            nurseId: req.user.id,
            type, title, price, description, prescriptionRequired,
            photos
        });
        res.status(201).json({ success: true, message: "Service added", data: service });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. GET MY SERVICES (Figma Screen 37: My Services)
const getMyServices = async (req, res) => {
    try {
        const services = await NurseService.find({ nurseId: req.user.id });
        res.json({ success: true, data: services });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. DELETE SERVICE
const deleteService = async (req, res) => {
    try {
        await NurseService.findOneAndDelete({ _id: req.params.id, nurseId: req.user.id });
        res.json({ success: true, message: "Service removed" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { addNurseService, getMyServices, deleteService };