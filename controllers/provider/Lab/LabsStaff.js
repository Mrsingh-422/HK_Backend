// controllers/provider/Lab/LabsStaff.js
const Phlebotomist = require('../../../models/Phlebotomist');

// 1. SAVE PHLEBOTOMIST (Add/Edit)
// endpoint: POST /api/provider/lab/staff/save
const savePhlebotomist = async (req, res) => {
    try {
        const { id, ...data } = req.body;
        if (req.files?.profilePic) data.profilePic = req.files.profilePic[0].path;

        const staff = id
            ? await Phlebotomist.findByIdAndUpdate(id, data, { new: true })
            : await Phlebotomist.create({ labId: req.user.id, ...data });

        res.json({ success: true, data: staff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. TOGGLE STATUS (Available/Offline)
// endpoint: PATCH /api/provider/lab/staff/toggle/:id
const toggleStaffStatus = async (req, res) => {
    try {
        const staff = await Phlebotomist.findById(req.params.id);
        staff.status = staff.status === 'Offline' ? 'Available' : 'Offline';
        await staff.save();
        res.json({ success: true, status: staff.status });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { savePhlebotomist, toggleStaffStatus };