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
        const nurseId = req.user.id;

        // Extracting all Figma Screen 42 fields
        let { 
            type, title, description, oneDayPrice, multipleDaysPrice, 
            hourlyPrice, amount, discountPercentage, consumablesUsed, 
            procedureIncluded, servicesOffered, prescriptionRequired 
        } = req.body;

        // Logic: Consumables can be sent as string (JSON) or array
        if (typeof consumablesUsed === 'string') {
            consumablesUsed = JSON.parse(consumablesUsed);
        }

        // Logic: Calculate finalPrice if not sent from frontend
        const discount = (Number(amount) * Number(discountPercentage)) / 100;
        const finalPrice = Number(amount) - discount;

        const photos = req.files && req.files['photos'] 
            ? req.files['photos'].map(f => f.path) 
            : undefined;

        const serviceData = {
            nurseId,
            type,
            title,
            description,
            oneDayPrice: Number(oneDayPrice),
            multipleDaysPrice: Number(multipleDaysPrice),
            hourlyPrice: Number(hourlyPrice),
            amount: Number(amount),
            discountPercentage: Number(discountPercentage),
            finalPrice: finalPrice,
            consumablesUsed,
            procedureIncluded,
            servicesOffered,
            prescriptionRequired: prescriptionRequired === 'true',
            ...(photos && { photos })
        };

        let service;
        if (id) {
            // Update logic
            service = await NurseService.findOneAndUpdate(
                { _id: id, nurseId }, 
                { $set: serviceData }, 
                { new: true }
            );
        } else {
            // Create logic
            service = await NurseService.create(serviceData);
        }

        res.status(201).json({ 
            success: true, 
            message: id ? "Service Updated" : "Service Added", 
            data: service 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
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
        const { status } = req.query;
        const query = { nurseId: req.user.id };
        if (status) query.status = status;

        const services = await NurseService.find(query)
            .populate('consumablesUsed')
            .sort({ createdAt: -1 });

        res.json({ success: true, data: services });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// DELETE SERVICE
const deleteService = async (req, res) => {
    try {
        const deleted = await NurseService.findOneAndDelete({ _id: req.params.id, nurseId: req.user.id });
        if (!deleted) return res.status(404).json({ message: "Service not found" });
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