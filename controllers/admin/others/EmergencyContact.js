const EmergencyContact = require('../../../models/EmergencyContact');

// 1. ADD CONTACT
const addContact = async (req, res) => {
    try {
        const contact = await EmergencyContact.create({
            ...req.body,
            createdBy: req.user.id
        });
        res.status(201).json({ success: true, message: "Emergency contact added", data: contact });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. GET ALL CONTACTS
const getContacts = async (req, res) => {
    try {
        const list = await EmergencyContact.find().sort({ createdAt: -1 });
        res.json({ success: true, data: list });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. UPDATE CONTACT
const updateContact = async (req, res) => {
    try {
        const contact = await EmergencyContact.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true, runValidators: true }
        );
        if (!contact) return res.status(404).json({ message: "Contact not found" });
        res.json({ success: true, message: "Contact updated successfully", data: contact });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. DELETE CONTACT
const deleteContact = async (req, res) => {
    try {
        const contact = await EmergencyContact.findByIdAndDelete(req.params.id);
        if (!contact) return res.status(404).json({ message: "Contact not found" });
        res.json({ success: true, message: "Contact deleted successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { addContact, getContacts, updateContact, deleteContact };