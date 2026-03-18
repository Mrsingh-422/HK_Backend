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
// 3. SEPARATE UPLOAD DOCS: LAB
// endpoint: PUT /api/auth/provider/upload-docs/lab
// ==========================================
const uploadLabDocs = async (req, res) => {
    try {
        const labId = req.user.id;
        const { documentState, issuingAuthority, gstNumber, experience, drugLicenseType, about } = req.body;
        const files = req.files;

        // 1. Pehle pura documents object taiyar karein (Dot notation ki jagah nested object)
        const documentsObj = {
            documentState,
            issuingAuthority,
            gstNumber,
            experience,
            drugLicenseType,
            labImages: files?.labImages ? files.labImages.map(f => f.path) : [],
            labCertificates: files?.labCertificates ? files.labCertificates.map(f => f.path) : [],
            labLicenses: files?.labLicenses ? files.labLicenses.map(f => f.path) : [],
            gstCertificates: files?.gstCertificates ? files.gstCertificates.map(f => f.path) : [],
            drugLicenses: files?.drugLicenses ? files.drugLicenses.map(f => f.path) : [],
            otherCertificates: files?.otherCertificates ? files.otherCertificates.map(f => f.path) : []
        };

        // 2. Database update
        const updatedLab = await Lab.findByIdAndUpdate(
            labId, 
            { 
                $set: { 
                    about,
                    profileStatus: 'Pending',
                    rejectionReason: null,
                    documents: documentsObj, // 👈 Pura object replace hoga, array conflict khatam
                    ...(files?.profileImage && { profileImage: files.profileImage[0].path })
                } 
            }, 
            { new: true, runValidators: true }
        );

        res.json({ success: true, message: "Documents uploaded.", data: updatedLab });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ==========================================
// 4. SEPARATE UPLOAD DOCS: PHARMACY
// endpoint: PUT /api/auth/provider/upload-docs/pharmacy
// ==========================================
const uploadPharmacyDocs = async (req, res) => {
    try {
        const pharmacyId = req.user.id;
        const { documentState, issuingAuthority, gstNumber, drugLicenseType, about, isHomeDeliveryAvailable, is24x7 } = req.body;
        const files = req.files;

        // 1. Prepare entire documents object (Overwrites any old array)
        const documentsObj = {
            documentState,
            issuingAuthority,
            gstNumber,
            drugLicenseType,
            pharmacyImages: files?.pharmacyImages ? files.pharmacyImages.map(f => f.path) : [],
            pharmacyCertificates: files?.pharmacyCertificates ? files.pharmacyCertificates.map(f => f.path) : [],
            pharmacyLicenses: files?.pharmacyLicenses ? files.pharmacyLicenses.map(f => f.path) : [],
            gstCertificates: files?.gstCertificates ? files.gstCertificates.map(f => f.path) : [],
            drugLicenses: files?.drugLicenses ? files.drugLicenses.map(f => f.path) : [],
            otherCertificates: files?.otherCertificates ? files.otherCertificates.map(f => f.path) : []
        };

        // 2. Perform Atomic update
        const updatedPharmacy = await Pharmacy.findByIdAndUpdate(
            pharmacyId, 
            { 
                $set: { 
                    about,
                    isHomeDeliveryAvailable,
                    is24x7,
                    profileStatus: 'Pending',
                    rejectionReason: null,
                    documents: documentsObj,
                    ...(files?.profileImage && { profileImage: files.profileImage[0].path })
                } 
            }, 
            { new: true, runValidators: true }
        );

        res.json({ success: true, message: "Pharmacy documents submitted for review.", data: updatedPharmacy });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ==========================================
// 5. SEPARATE UPLOAD DOCS: NURSE
// endpoint: PUT /api/auth/provider/upload-docs/nurse
// ==========================================
const uploadNurseDocs = async (req, res) => {
    try {
        const nurseId = req.user.id;
        const { 
            documentState, issuingAuthority, gstNumber, 
            experience, about, experienceYears, speciality, gender 
        } = req.body;
        const files = req.files;

        // 1. Prepare entire documents object as per Figma Labels
        const documentsObj = {
            documentState,
            issuingAuthority,
            gstNumber,
            experience,
            nursingCertificates: files?.nursingCertificates ? files.nursingCertificates.map(f => f.path) : [],
            licensePhotos: files?.licensePhotos ? files.licensePhotos.map(f => f.path) : [],
            gstCertificates: files?.gstCertificates ? files.gstCertificates.map(f => f.path) : [],
            experienceCertificates: files?.experienceCertificates ? files.experienceCertificates.map(f => f.path) : [],
            otherCertificates: files?.otherCertificates ? files.otherCertificates.map(f => f.path) : []
        };

        // 2. Atomic update: Overwrite 'documents' field to convert from Array to Object
        const updatedNurse = await Nurse.findByIdAndUpdate(
            nurseId, 
            { 
                $set: { 
                    about,
                    experienceYears,
                    speciality,
                    gender,
                    profileStatus: 'Pending',
                    rejectionReason: null,
                    documents: documentsObj, 
                    ...(files?.profileImage && { profileImage: files.profileImage[0].path })
                } 
            }, 
            { new: true, runValidators: true }
        );

        res.json({ success: true, message: "Nursing documents submitted for review.", data: updatedNurse });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { registerProvider, loginProvider, uploadLabDocs, uploadPharmacyDocs, uploadNurseDocs };