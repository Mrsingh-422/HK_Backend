const Provider = require('../../models/Provider');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const generateToken = (id, role) => {
    // Agar development hai toh 100 saal (maano expire hi nahi hoga)
    // Warna production mein sirf 30 din
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';

    return jwt.sign(
        { id, role }, 
        process.env.JWT_SECRET, 
        { expiresIn: expiry }
    );
};

// --- 1. REGISTER PROVIDER (Step 1) ---
const registerProvider = async (req, res) => {
    try {
        const { name, email, phone, password, category, country, state, city } = req.body;

        if (!email && !phone) return res.status(400).json({ message: 'Email or Phone required' });

        const exists = await Provider.findOne({ $or: [{ email: email || undefined }, { phone: phone || undefined }] });
        if (exists) return res.status(400).json({ message: 'Provider already registered' });

        const hashedPassword = await bcrypt.hash(password, 10);

        const newProvider = await Provider.create({
            name, category, country, state, city,
            email: email || undefined,
            phone: phone || undefined,
            password: hashedPassword,
            profileStatus: 'Incomplete'
        });

        const token = generateToken(newProvider._id);
        newProvider.token = token;
        await newProvider.save();

        res.status(201).json({ 
            success: true, 
            message: 'Registered! Please upload documents.', 
            token,
            profileStatus: 'Incomplete' 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 2. LOGIN PROVIDER (Flow Signals) ---
const loginProvider = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        let query = email ? { email } : { phone };

        const provider = await Provider.findOne(query).select('+password');
        if (!provider || !(await bcrypt.compare(password, provider.password))) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        // --- PRODUCTION FLOW LOGIC ---
        
        if (provider.profileStatus === 'Pending') {
            return res.status(200).json({ 
                success: true, fullAccess: false, profileStatus: 'Pending',
                message: 'Profile under review by Admin.' 
            });
        }

        if (provider.profileStatus === 'Incomplete') {
            const token = provider.token || generateToken(provider._id);
            return res.status(200).json({ 
                success: true, fullAccess: false, token, profileStatus: 'Incomplete',
                message: 'Please complete document upload.' 
            });
        }

        if (provider.profileStatus === 'Rejected') {
            const token = provider.token || generateToken(provider._id);
            return res.status(200).json({ 
                success: true, fullAccess: false, token, profileStatus: 'Rejected',
                rejectionReason: provider.rejectionReason,
                message: `Rejected: ${provider.rejectionReason}. Re-upload documents.` 
            });
        }

        // --- APPROVED / SUCCESS ---
        let token = null;
        if (process.env.NODE_ENV === 'development' && provider.token) {
            try {
                jwt.verify(provider.token, process.env.JWT_SECRET);
                token = provider.token;
            } catch (err) { token = null; }
        }

        if (!token) {
            token = generateToken(provider._id);
            provider.token = token;
            await provider.save();
        }

        provider.password = undefined;
        res.json({ success: true, fullAccess: true, token, data: provider });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 3. UPLOAD DOCUMENTS (Step 2) ---
const uploadProviderDocs = async (req, res) => {
    try {
        const providerId = req.user.id;
        const updates = req.body;

        if (req.files) {
            // Profile Image
            if (req.files.profileImage) {
                updates.profileImage = `/uploads/providers/${req.files.profileImage[0].filename}`;
            }
            // Certificates Array
            if (req.files.certificates) {
                updates.documents = req.files.certificates.map(f => `/uploads/providers/${f.filename}`);
                // Docs upload hote hi status PENDING kar do
                updates.profileStatus = 'Pending';
            }
        }

        const updated = await Provider.findByIdAndUpdate(providerId, { $set: updates }, { new: true });
        res.json({ success: true, message: "Documents submitted successfully", data: updated });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { registerProvider, loginProvider, uploadProviderDocs };