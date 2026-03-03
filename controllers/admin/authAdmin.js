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

// --- 2. ADMIN LOGIN (Updated for Email OR Phone) ---
const loginAdmin = async (req, res) => {
    try {
        const { email, phone, password } = req.body;

        // Dynamic Query Builder
        let query = {};
        if (email) query = { email };
        else if (phone) query = { phone };
        else return res.status(400).json({ message: 'Provide Email or Phone' });

        // 1. Admin Find & Check Password
        const admin = await Admin.findOne(query).select('+password');
        
        if (!admin || !(await bcrypt.compare(password, admin.password))) {
            return res.status(400).json({ message: 'Invalid Admin Credentials' });
        }
        if (!admin.isActive) return res.status(403).json({ message: 'Account Deactivated' });

        let token = null;

        // --- DEVELOPMENT MODE LOGIC (Same as you requested) ---
        if (process.env.NODE_ENV === 'development') {
            if (admin.token) {
                try {
                    jwt.verify(admin.token, process.env.JWT_SECRET);
                    token = admin.token;
                    console.log("Development Mode: Using Existing Token");
                } catch (err) {
                    token = null;
                }
            }
        }

        // --- TOKEN GENERATION ---
        if (!token) {
            token = jwt.sign(
                { id: admin._id, role: admin.role }, 
                process.env.JWT_SECRET, 
                { expiresIn: '30d' }
            );

            // Token saving logic
            admin.token = token;
            await admin.save();
            console.log("New Token Generated");
        }

        res.json({
            success: true,
            token,
            admin: {
                id: admin._id,
                name: admin.name,
                role: admin.role,
                permissions: admin.permissions 
            }
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 3. CREATE SUB-ADMIN (Updated) ---
const createSubAdmin = async (req, res) => {
    try {
        const { name, email, phone, password, roleTypeId, locationAccess } = req.body;

        if (!email && !phone) return res.status(400).json({ message: 'Email or Phone required' });

        const hashedPassword = await bcrypt.hash(password, 10);

        const subAdmin = await Admin.create({
            name,
            email: email || undefined,
            phone: phone || undefined,
            password: hashedPassword,
            role: 'subadmin',
            roleType: roleTypeId, // Role model की ID
            locationAccess: {
                country: locationAccess?.country || null,
                state: locationAccess?.state || null,
                city: locationAccess?.city || null
            }
        });

        res.status(201).json({ success: true, message: 'Sub-Admin created with specific Role & Location' });
    } catch (error) {
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



module.exports = { registerSuperAdmin, loginAdmin, createSubAdmin, updateAdminProfile };