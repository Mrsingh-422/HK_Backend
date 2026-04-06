const { MasterCondition, MasterAllergy } = require('../../../models/MasterMedical');

const addMasterCondition = async (req, res) => {
    try {
        const item = await MasterCondition.create(req.body);
        res.status(201).json({ success: true, data: item });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const addMasterAllergy = async (req, res) => {
    try {
        const item = await MasterAllergy.create(req.body);
        res.status(201).json({ success: true, data: item });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Frontend (Admin & User dono ke liye dropdown list)
// 1. Get All Conditions (Non-Major)
const getConditions = async (req, res) => {
    try {
        const data = await MasterCondition.find({ isActive: true, isMajor: false });
        res.json({ success: true, data });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. Get All Allergies
const getAllergies = async (req, res) => {
    try {
        const data = await MasterAllergy.find({ isActive: true });
        res.json({ success: true, data });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. Get Major Conditions (For Screen 13 - Asthma/Diabetes Yes/No)
const getMajorConditions = async (req, res) => {
    try {
        const data = await MasterCondition.find({ isActive: true, isMajor: true });
        res.json({ success: true, data });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { addMasterCondition, addMasterAllergy, getConditions, getAllergies, getMajorConditions };