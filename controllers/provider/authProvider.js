const Lab = require('../../models/Lab');
const Pharmacy = require('../../models/Pharmacy');
const Nurse = require('../../models/Nurse');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Helper: Token Generation (Lifetime for Dev, 30d for Prod)
const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// Helper: Category to Model Mapping
const getModelByCategory = (category) => {
    const map = { 'Lab': Lab, 'Pharmacy': Pharmacy, 'Nurse': Nurse };
    return map[category];
};

// Helper: Global Duplicate Check
const checkGlobalExists = async (query) => {
    const models = [Lab, Pharmacy, Nurse];
    for (let Model of models) {
        const exists = await Model.findOne(query);
        if (exists) return true;
    }
    return false;
};

// ==========================================
// 1. REGISTER PROVIDER (Unified API - Storage Segmented)
// endpoint: POST /api/auth/provider/register
// ==========================================
const registerProvider = async (req, res) => {
    try {
        const { name, email, phone, password, category, country, state, city } = req.body;

        const Model = getModelByCategory(category);
        if (!Model) return res.status(400).json({ message: "Invalid category. Choose Lab, Pharmacy or Nurse." });

        const isDuplicate = await checkGlobalExists({ $or: [{ email: email?.toLowerCase() }, { phone }] });
        if (isDuplicate) return res.status(400).json({ message: 'Email or Phone already registered' });

        const hashedPassword = await bcrypt.hash(password, 10);

        const newProvider = await Model.create({
            name, 
            email: email?.toLowerCase(), 
            phone,
            password: hashedPassword,
            category,
            role: category, 
            country, state, city,
            profileStatus: 'Incomplete' // Matches Hospital Flow
        });

        const token = generateToken(newProvider._id, category);
        newProvider.token = token;
        await newProvider.save();

        res.status(201).json({ 
            success: true, 
            message: 'Registered successfully. Please login to upload documents.', 
            token,
            profileStatus: 'Incomplete' 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ==========================================
// 2. LOGIN PROVIDER (Flow-Based Logic)
// endpoint: POST /api/auth/provider/login
// ==========================================
const loginProvider = async (req, res) => {
    try {
        const { email, phone, password, category } = req.body;
        
        const Model = getModelByCategory(category);
        if (!Model) return res.status(400).json({ message: "Specify category (Lab/Pharmacy/Nurse)" });

        let query = email ? { email: email.toLowerCase() } : { phone };
        const provider = await Model.findOne(query).select('+password');

        if (!provider || !(await bcrypt.compare(String(password), provider.password))) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        // ------------------------------------------------------------
        // 🚀 STATUS BASED FLOW (Hospital Style)
        // ------------------------------------------------------------
        
        // A. PENDING: Under Review (No dashboard access)
        if (provider.profileStatus === 'Pending') {
            return res.status(200).json({ 
                success: true, 
                fullAccess: false,
                profileStatus: 'Pending',
                message: 'Your profile is under review. Please wait for Admin approval.' 
            });
        }

        // B. INCOMPLETE: Needs to upload docs (Give token)
        if (provider.profileStatus === 'Incomplete') {
            const token = provider.token || generateToken(provider._id, category);
            return res.status(200).json({ 
                success: true, 
                fullAccess: false, 
                token, 
                profileStatus: 'Incomplete',
                message: 'Profile incomplete. Please upload documents to proceed.' 
            });
        }

        // C. REJECTED: Give token to allow re-upload
        if (provider.profileStatus === 'Rejected') {
            const token = provider.token || generateToken(provider._id, category);
            return res.status(200).json({ 
                success: true, 
                fullAccess: false, 
                token, 
                profileStatus: 'Rejected',
                rejectionReason: provider.rejectionReason,
                message: `Application Rejected: ${provider.rejectionReason}. Please re-upload documents.` 
            });
        }

        // D. APPROVED: Full Login
        let token = null;
        if (process.env.NODE_ENV === 'development' && provider.token) {
            try {
                jwt.verify(provider.token, process.env.JWT_SECRET);
                token = provider.token;
            } catch (err) { token = null; }
        }

        if (!token) {
            token = generateToken(provider._id, category);
            provider.token = token;
            await provider.save();
        }

        provider.password = undefined;
        res.json({ 
            success: true, 
            fullAccess: true, 
            token, 
            profileStatus: 'Approved', 
            data: provider 
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ==========================================
// 3. UPLOAD DOCUMENTS & CHANGE STATUS
// endpoint: PUT /api/auth/provider/upload-docs
// ==========================================
const uploadProviderDocs = async (req, res) => {
    try {
        // req.user.role contains 'Lab', 'Pharmacy', or 'Nurse' from middleware
        const Model = getModelByCategory(req.user.role); 
        const updates = req.body;

        if (req.files) {
            if (req.files.profileImage) {
                updates.profileImage = `/uploads/providers/${req.files.profileImage[0].filename}`;
            }
            if (req.files.certificates) {
                updates.documents = req.files.certificates.map(f => `/uploads/providers/${f.filename}`);
                
                // Essential logic: Change status to Pending once docs are uploaded
                updates.profileStatus = 'Pending';
                updates.rejectionReason = null; 
            }
        }

        const updated = await Model.findByIdAndUpdate(
            req.user.id, 
            { $set: updates }, 
            { new: true }
        );

        res.json({ 
            success: true, 
            message: updates.profileStatus === 'Pending' ? "Documents submitted for review" : "Profile Updated", 
            data: updated 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { registerProvider, loginProvider, uploadProviderDocs };