const Role = require('../../models/Role');
const Admin = require('../../models/Admin'); // 👈 Import Missing tha, ise add kiya
const Doctor = require('../../models/Doctor');
const { getLocationFilter } = require('../../middleware/authMiddleware');

// 1. Create Role (Master Role बनाना - इसमें आप [1, 2, 28, 31] जैसी multiple IDs डाल सकते हैं)
const createRole = async (req, res) => {
    try {
        // Safe check: Agar req.body hi nahi aaya
        if (!req.body || Object.keys(req.body).length === 0) {
            return res.status(400).json({ message: "Request body is missing or empty" });
        }

        const { name, role_ids, description } = req.body;

        if (!name) return res.status(400).json({ message: "Role name is required" });

        const role = await Role.create({ name, role_ids, description });
        res.status(201).json({ success: true, data: role });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
// 2. Get All Roles
const getRolesList = async (req, res) => {
    try {
        const roles = await Role.find();
        res.json({ success: true, data: roles });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. Assign Role to Admin (Admin Model के 'roleType' के हिसाब से)
const assignRolesToAdmin = async (req, res) => {
    try {
        const { adminId, roleTypeId } = req.body; // 👈 मॉडल में 'roleType' है, इसलिए single ID लेंगे

        // 1. Check if Admin exists
        const admin = await Admin.findById(adminId);
        if (!admin) return res.status(404).json({ message: "Admin not found" });

        // 2. Check if Role exists
        const roleExists = await Role.findById(roleTypeId);
        if (!roleExists) return res.status(404).json({ message: "Role not found" });

        // 3. Update 'roleType' field
        admin.roleType = roleTypeId;
        await admin.save();

        res.json({ 
            success: true, 
            message: "Role assigned successfully to Admin",
            roleName: roleExists.name 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 4. Get Doctor Vendors (With Location Filter)
const getDoctorVendors = async (req, res) => {
    try {
        const filter = getLocationFilter(req); 
        const doctors = await Doctor.find({ ...filter });
        res.json({ success: true, data: doctors });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { createRole, getRolesList, getDoctorVendors, assignRolesToAdmin };