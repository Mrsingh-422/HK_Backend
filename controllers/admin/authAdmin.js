const Admin = require('../../models/Admin');
const Role = require('../../models/Role');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// --- 1. REGISTER SUPER ADMIN (One Time Setup) ---
const registerSuperAdmin = async (req, res) => {
    try {
        const { name, email, phone, password } = req.body;

        // Validation: Kam se kam ek contact info honi chahiye
        if (!email && !phone) return res.status(400).json({ message: 'Email or Phone is required' });

        // Dynamic Duplicate Check
        let query = [];
        if (email) query.push({ email });
        if (phone) query.push({ phone });

        if (query.length > 0) {
            const adminExists = await Admin.findOne({ $or: query });
            if (adminExists) return res.status(403).json({ message: 'Admin with this Email or Phone already exists!' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const admin = await Admin.create({
            name,
            email: email || undefined, // Sparse ke liye undefined bhejna zaroori hai
            phone: phone || undefined,
            password: hashedPassword,
            role: 'superadmin',
            permissions: {} 
        });

        res.status(201).json({ success: true, message: 'Super Admin Created Successfully' });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const loginAdmin = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
 
        let query = {};
        if (email) query = { email };
        else if (phone) query = { phone };
        else return res.status(400).json({ message: 'Provide Email or Phone' });
 
        // DATABASE SE DATA NIKAL RAHE HAIN
        const admin = await Admin.findOne(query).select('+password').populate('roleType');
       
        if (!admin || !(await bcrypt.compare(password, admin.password))) {
            return res.status(400).json({ message: 'Invalid Admin Credentials' });
        }
        if (!admin.isActive) return res.status(403).json({ message: 'Account Deactivated' });
 
        // TERMINAL MEIN PRINT KARKE DEKHENGE KI DATA KYA AAYA
        console.log("===== LOGIN DEBUG =====");
        console.log("Admin Name:", admin.name);
        console.log("Populated RoleType:", admin.roleType);
 
        let token = null;
        if (!token) {
            token = jwt.sign({ id: admin._id, role: admin.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
            admin.token = token;
            await admin.save();
        }
 
        // TABS NIKALNE KA LOGIC
        let allowedTabs = [];
       
        if (admin.role === 'superadmin') {
            allowedTabs = ['ALL'];
        } else if (admin.roleType && Array.isArray(admin.roleType)) {
            admin.roleType.forEach(role => {
                // Role model me jo bhi naam ho, sab check kar lenge
                const tabs = role.tabIds || role.tabs || role.permissions || [];
                if (tabs.length > 0) {
                    allowedTabs = [...allowedTabs, ...tabs];
                }
            });
            allowedTabs = [...new Set(allowedTabs)];
        } else if (admin.roleType) {
            // Agar array nahi, single object hai
            const tabs = admin.roleType.tabIds || admin.roleType.tabs || admin.roleType.permissions || [];
            allowedTabs = [...tabs];
        }
 
        console.log("Final Allowed Tabs Jo Frontend jayenge:", allowedTabs);
        console.log("=======================");
 
        // RESPONSE TO FRONTEND
        res.json({
            success: true,
            token,
            admin: {
                id: admin._id,
                name: admin.name,
                role: admin.role,
                allowedTabs: allowedTabs
            }
        });
 
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ message: error.message });
    }
};
 
 
// --- 3. CREATE SUB-ADMIN (Updated for Multiple Roles) ---
const createSubAdmin = async (req, res) => {
    try {
        const { name, email, phone, password, roleTypeId, locationAccess } = req.body;
 
        if (!email && !phone) {
            return res.status(400).json({ message: 'Email or Phone required' });
        }
 
        // Check if roleTypeId is provided and is an array
        if (!roleTypeId || !Array.isArray(roleTypeId) || roleTypeId.length === 0) {
            return res.status(400).json({ message: 'At least one Authority Role must be selected' });
        }
 
        const hashedPassword = await bcrypt.hash(password, 10);
 
        const subAdmin = await Admin.create({
            name,
            email: email || undefined,
            phone: phone || undefined,
            password: hashedPassword,
            role: 'subadmin',
            roleType: roleTypeId, // Frontend se array aayega ['id1', 'id2'] aur direct save ho jayega
            locationAccess: {
                country: locationAccess?.country || null,
                state: locationAccess?.state || null,
                city: locationAccess?.city || null
            }
        });
 
        res.status(201).json({ success: true, message: 'Sub-Admin created with specific Roles & Location' });
    } catch (error) {
        // Handle unique email/phone error from MongoDB
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Email or Phone already exists' });
        }
        res.status(500).json({ message: error.message });
    }
};
 

// --- 4. UPDATE ADMIN PROFILE (NEW) ---
// Admin khud login hone ke baad apna missing Email/Phone add kar sake
const updateAdminProfile = async (req, res) => {
    try {
        const adminId = req.user.id;
        const { email, phone, name } = req.body;

        // Check Email Duplicate
        if (email) {
            const emailExists = await Admin.findOne({ email });
            if (emailExists && emailExists._id.toString() !== adminId) {
                return res.status(400).json({ message: 'Email already in use' });
            }
        }

        // Check Phone Duplicate
        if (phone) {
            const phoneExists = await Admin.findOne({ phone });
            if (phoneExists && phoneExists._id.toString() !== adminId) {
                return res.status(400).json({ message: 'Phone already in use' });
            }
        }

        const updatedAdmin = await Admin.findByIdAndUpdate(
            adminId,
            {
                ...(name && { name }),
                ...(email && { email }),
                ...(phone && { phone })
            },
            { new: true }
        );

        res.json({ success: true, message: "Profile Updated", admin: updatedAdmin });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
const getAdminsList = async (req, res) => {
    try {
        const loggedInAdminId = req.user.id; // Login admin ki ID
        const loggedInRole = req.user.role; // Login admin ka role (superadmin/subadmin)
 
        let query = {};
 
        // ROLE BASED LOGIC
        if (loggedInRole === 'superadmin') {
            // 1. Superadmin sabko dekh sakta hai (All Admins)
            query = {};
           
            // Optional: Agar superadmin kisi specific role ko search karna chahe
            if (req.query.role) query.role = req.query.role;
           
        } else if (loggedInRole === 'subadmin') {
            // 2. Subadmin sirf khud ko dekh sakta hai
            query = { _id: loggedInAdminId };
        }
 
        // Search Logic (Agar search query bheji hai)
        if (req.query.search && loggedInRole === 'superadmin') {
            query.$or = [
                { name: { $regex: req.query.search, $options: 'i' } },
                { email: { $regex: req.query.search, $options: 'i' } }
            ];
        }
 
        const admins = await Admin.find(query)
            .populate('roleType') // Permissions aur Role Title ke liye
            .sort({ createdAt: -1 });
 
        res.json({
            success: true,
            roleDetected: loggedInRole,
            count: admins.length,
            data: admins
        });
 
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
 
const editSubadmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, phone, password, roleTypeId, locationAccess } = req.body;
 
        // Duplicate Email Check (lekin khud ki ID chhodkar)
        if (email) {
            const emailExists = await Admin.findOne({ email, _id: { $ne: id } });
            if (emailExists) return res.status(400).json({ message: 'Email already in use by another admin' });
        }
 
        // Duplicate Phone Check
        if (phone) {
            const phoneExists = await Admin.findOne({ phone, _id: { $ne: id } });
            if (phoneExists) return res.status(400).json({ message: 'Phone already in use by another admin' });
        }
 
        const updateData = {
            name,
            email: email || undefined,
            phone: phone || undefined,
            roleType: roleTypeId, // Updated Array of Roles
            locationAccess: {
                country: locationAccess?.country || null,
                state: locationAccess?.state || null,
                city: locationAccess?.city || null
            }
        };
 
        // Agar password naya dala hai, toh usko encrypt karke save karo
        if (password && password.trim() !== "") {
            updateData.password = await bcrypt.hash(password, 10);
        }
 
        const updatedAdmin = await Admin.findByIdAndUpdate(id, updateData, { new: true });
       
        if (!updatedAdmin) {
            return res.status(404).json({ message: 'Subadmin not found' });
        }
 
        res.json({ success: true, message: 'Subadmin updated successfully', data: updatedAdmin });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
 


module.exports = { registerSuperAdmin, loginAdmin, createSubAdmin, updateAdminProfile ,getAdminsList, editSubadmin  };