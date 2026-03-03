const Provider = require('../../models/Provider');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// --- 1. REGISTER PROVIDER ---
// Endpoint: POST /api/auth/provider/register
const registerProvider = async (req, res) => {
    try {
        const { 
            name, email, phone, gender, category, location, password 
        } = req.body;

        // 1. Validation: Kam se kam ek contact method hona chahiye
        if (!email && !phone) {
            return res.status(400).json({ message: 'Email or Phone is required' });
        }

        // 2. Dynamic Duplicate Check
        // Check array banayenge taaki 'undefined' values DB query me na jaayein
        let query = [];
        if (email) query.push({ email });
        if (phone) query.push({ phone });

        if (query.length > 0) {
            const exists = await Provider.findOne({ $or: query });
            if (exists) {
                return res.status(400).json({ message: 'Provider already registered with this Email or Phone' });
            }
        }

        // 3. Create Provider
        const hashedPassword = await bcrypt.hash(password, 10);

        await Provider.create({
            email: email || undefined, // Sparse index ke liye zaroori
            phone: phone || undefined, 
            password: hashedPassword,
            name, gender, category, location,
            profileStatus: 'Pending'
        });

        res.status(201).json({ success: true, message: 'Provider Registered. Waiting for Approval.' });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 2. LOGIN PROVIDER ---
// Endpoint: POST /api/auth/provider/login
const loginProvider = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        
        let query = {};
        if (email) query = { email };
        else if (phone) query = { phone };
        else return res.status(400).json({ message: 'Provide Email or Phone' });

        const provider = await Provider.findOne(query).select('+password');
        if (!provider || !(await bcrypt.compare(password, provider.password))) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        if (provider.profileStatus === 'Pending') return res.status(403).json({ message: 'Pending Approval' });
        if (provider.profileStatus === 'Rejected') return res.status(403).json({ message: 'Application Rejected' });

        let token = null;

        // --- DEVELOPMENT MODE: Token Reuse ---
        if (process.env.NODE_ENV === 'development') {
            if (provider.token) {
                try {
                    jwt.verify(provider.token, process.env.JWT_SECRET);
                    token = provider.token;
                    console.log("Dev Mode: Reusing Provider Token");
                } catch (err) {
                    token = null;
                }
            }
        }

        // --- NEW TOKEN GENERATION ---
        if (!token) {
            token = jwt.sign({ id: provider._id, role: 'provider' }, process.env.JWT_SECRET, { expiresIn: '30d' });
            provider.token = token;
            await provider.save();
            console.log("New Provider Token Generated");
        }

        res.json({ success: true, token, role: 'provider', data: provider });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 3. UPDATE PROVIDER PROFILE (NEW) ---
// Login ke baad apna Email/Phone add/update karne ke liye
const updateProviderProfile = async (req, res) => {
    try {
        const providerId = req.user.id; // Auth Middleware se aayega
        const { email, phone, name, location, category } = req.body;

        // Check 1: Agar Email update ho raha hai, to unique check karo
        if (email) {
            const emailExists = await Provider.findOne({ email });
            if (emailExists && emailExists._id.toString() !== providerId) {
                return res.status(400).json({ message: 'Email already used by another provider' });
            }
        }

        // Check 2: Agar Phone update ho raha hai, to unique check karo
        if (phone) {
            const phoneExists = await Provider.findOne({ phone });
            if (phoneExists && phoneExists._id.toString() !== providerId) {
                return res.status(400).json({ message: 'Phone already used by another provider' });
            }
        }

        // Update Fields
        const updatedProvider = await Provider.findByIdAndUpdate(
            providerId,
            {
                ...(email && { email }),
                ...(phone && { phone }),
                ...(name && { name }),
                ...(location && { location }),
                ...(category && { category })
            },
            { new: true } // Return updated data
        );

        res.json({ success: true, message: "Profile Updated", data: updatedProvider });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
 
module.exports = { registerProvider, loginProvider, updateProviderProfile };