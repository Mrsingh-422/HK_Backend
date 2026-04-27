const NurseService = require('../../../models/NurseService');
const NurseConsumable = require('../../../models/NurseConsumable');

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
const addOrUpdateService = async (req, res) => {
    try {
        const { id } = req.params;
        const { consumablesUsed } = req.body; // Array of IDs

        const serviceData = {
            nurseId: req.user.id,
            ...req.body,
            // JSON parse agar stringify hoke aa raha hai
            consumablesUsed: typeof consumablesUsed === 'string' ? JSON.parse(consumablesUsed) : consumablesUsed,
            photos: req.files ? req.files.map(f => f.path) : undefined
        };

        let service;
        if (id) {
            service = await NurseService.findByIdAndUpdate(id, serviceData, { new: true });
        } else {
            service = await NurseService.create(serviceData);
        }
        res.status(201).json({ success: true, data: service });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getServicesByStatus = async (req, res) => {
    try {
        const { status } = req.query; // 'Approved', 'Pending', 'Rejected'
        const services = await NurseService.find({ nurseId: req.user.id, status });
        res.json({ success: true, data: services });
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

const manageConsumable = async (req, res) => {
    try {
        const { itemName, category, unitType, price, id } = req.body;
        if (id) {
            const updated = await NurseConsumable.findByIdAndUpdate(id, { itemName, category, unitType, price }, { new: true });
            return res.json({ success: true, data: updated });
        }
        const created = await NurseConsumable.create({ nurseId: req.user.id, itemName, category, unitType, price });
        res.status(201).json({ success: true, data: created });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const listConsumables = async (req, res) => {
    try {
        const list = await NurseConsumable.find({ nurseId: req.user.id });
        res.json({ success: true, data: list });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


module.exports = { addNurseService, getMyServices, deleteService, addOrUpdateService, getServicesByStatus, manageConsumable, listConsumables };