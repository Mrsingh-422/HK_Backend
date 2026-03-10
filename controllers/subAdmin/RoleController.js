// controllers/subAdmin/RoleController.js
const Role = require('../../models/Role');
const Tab = require('../../models/Tab');
const Admin = require('../../models/Admin');

// 1. Saare available Tabs (Permissions) dikhane ke liye - UI me checkbox banane ke kaam aayega
// endpoint GET /admin/roles/tabs
const getAllTabs = async (req, res) => {
    try {
        const tabs = await Tab.find().sort({ tabId: 1 });
        res.json({ success: true, data: tabs });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. Naya Role Template banana (PHP: roleTabs insert)
// endpoint POST /admin/roles/create
const createRoleTemplate = async (req, res) => {
    try {
        const { name, tabIds, description } = req.body; // tabIds: [1, 2, 28]

        const roleExists = await Role.findOne({ name });
        if (roleExists) return res.status(400).json({ message: "Role name already exists" });

        const newRole = await Role.create({ name, tabIds, description });
        res.status(201).json({ success: true, data: newRole });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. Admin ko Role Assign karna
// endpoint POST /admin/roles/assign
const assignRoleToAdmin = async (req, res) => {
    try {
        const { adminId, roleId } = req.body;
        
        const updatedAdmin = await Admin.findByIdAndUpdate(
            adminId, 
            { roleType: roleId }, 
            { new: true }
        ).populate('roleType');

        res.json({ success: true, message: "Role assigned", admin: updatedAdmin });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 4. Naya Tab (Permission) add karna - Jaise ki Hospital Management ka tabId 4 hai, agar future me koi naya module add karna ho to uska tabId yahan add karenge
// endpoint POST /admin/roles/add-new-tab
const addNewTab = async (req, res) => {
    try {
        const { tabId, name, parentId, subParentId } = req.body;
        
        const tabExists = await Tab.findOne({ tabId });
        if (tabExists) return res.status(400).json({ message: "Tab ID already exists" });

        const newTab = await Tab.create({ tabId, name, parentId, subParentId });
        res.status(201).json({ success: true, data: newTab });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


// 5. Toggle Tab Status (Global Switch) for enable/disable permission without deleting it from DB
// endpoint PUT /admin/roles/toggle-tab-status
const toggleTabStatus = async (req, res) => {
    try {
        const { tabId, isActive } = req.body; // e.g., tabId: 28, isActive: false

        const updatedTab = await Tab.findOneAndUpdate(
            { tabId: Number(tabId) },
            { isActive: isActive },
            { new: true }
        );

        if (!updatedTab) return res.status(404).json({ message: "Tab not found" });

        res.json({ 
            success: true, 
            message: `Tab ${updatedTab.name} is now ${isActive ? 'Active' : 'Inactive'}`,
            data: updatedTab 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// controllers/subAdmin/RoleController.js mein ye add karein
// 6. Role Template ke permissions update karna (Tab IDs update karna)
// endpoint PUT /admin/roles/update-role-permissions
const updateRolePermissions = async (req, res) => {
    try {
        const { roleId, tabIds } = req.body; // e.g., roleId: "ID_OF_ROLE", tabIds: [1, 2, 4, 28]

        const updatedRole = await Role.findByIdAndUpdate(
            roleId,
            { tabIds: tabIds }, // Yahan [4] hona zaroori hai Hospital access ke liye
            { new: true }
        );

        res.json({ success: true, message: "Permissions updated", data: updatedRole });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


module.exports = { getAllTabs, createRoleTemplate, assignRoleToAdmin, addNewTab, toggleTabStatus, updateRolePermissions };