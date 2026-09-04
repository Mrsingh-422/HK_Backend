// controllers/provider/authProvider.js
const Lab = require('../../models/Lab');
const Pharmacy = require('../../models/Pharmacy');
const Nurse = require('../../models/Nurse');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); 
const sendEmailOTP = require('../../utils/emailService'); 
const { deleteFile } = require('../../utils/fileHandler');
const { verifyFirebasePhoneToken } = require('../../utils/firebaseAuthHelper');
const { checkAndConsumeOtpLimit } = require('../../utils/otpRateLimiterHelper');


// Helper: Token Generation
const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// Helper: Category to Model Mapping
const getModelByCategory = (category) => {
    const map = { 'Lab': Lab, 'Pharmacy': Pharmacy, 'Nurse': Nurse };
    return map[category];
};

// ==========================================
// PROVIDER PRE-CHECK (Already-Registered Check FIRST, Limiter Check SECOND)
// Endpoint: POST /api/auth/provider/check-exists
// ==========================================
const checkProviderExists = async (req, res) => {
    try {
        const { phone, email, category } = req.body;

        if (!phone && !email) {
            return res.status(400).json({ success: false, message: "Phone or Email is required." });
        }

        const Model = getModelByCategory(category);
        if (!Model) {
            return res.status(400).json({ success: false, message: "Please specify category (Lab/Pharmacy/Nurse)." });
        }

        const cleanPhone = phone ? String(phone).trim().replace(/\D/g, "").slice(-10) : null;
        const normalizedEmail = email ? email.toLowerCase().trim() : null;

        const clientIp = req.headers['cf-connecting-ip'] || 
                         req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                         req.socket.remoteAddress;

        // 1. STEP A: Check Database First (Category-Scoped)
        const query = [];
        if (cleanPhone) query.push({ phone: cleanPhone });
        if (normalizedEmail) query.push({ email: normalizedEmail });

        const exists = await Model.findOne({ $or: query });

        if (exists) {
            return res.status(200).json({ 
                success: false, 
                exists: true, 
                message: `This phone/email is already registered as a ${category}. Please login instead.` 
            });
        }

        // 2. STEP B: Check 'Registration-OTP' Rate Limit
        if (cleanPhone) {
            const limitCheck = await checkAndConsumeOtpLimit(cleanPhone, 'phone', 'Registration-OTP', clientIp);
            if (!limitCheck.allowed) {
                return res.status(limitCheck.statusCode).json({
                    success: false,
                    errorType: "OTP_LIMIT_EXCEEDED",
                    message: limitCheck.message
                });
            }
        }

        res.status(200).json({ 
            success: true, 
            exists: false, 
            message: `Available for registration as ${category}.` 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ==========================================
// 1. REGISTER PROVIDER (Category-Specific Registration)
// Endpoint: POST /api/auth/provider/register
// ==========================================
const registerProvider = async (req, res) => {
    try {
        const { name, email, phone, countryCode, password, category, country, state, city, idToken } = req.body;

        // 1. Validations
        if (!name || !phone || !password || !category) {
            return res.status(400).json({ 
                success: false, 
                message: "Name, Phone, Password, and Category are required." 
            });
        }

        const Model = getModelByCategory(category);
        if (!Model) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid category. Choose Lab, Pharmacy or Nurse." 
            });
        }

        const normalizedEmail = email ? email.toLowerCase().trim() : null;
        const cleanPhone = phone.trim().replace(/\D/g, "").slice(-10);

        // 2. 🚨 CATEGORY-SCOPED DUPLICATE CHECK (Sirf Selected Category me check karega)
        const query = [{ phone: cleanPhone }];
        if (normalizedEmail) query.push({ email: normalizedEmail });

        const isAlreadyRegisteredInCategory = await Model.findOne({ $or: query });

        if (isAlreadyRegisteredInCategory) {
            return res.status(400).json({ 
                success: false, 
                message: `This mobile number or email is already registered as a ${category}. Please Login or select another category.` 
            });
        }

        // 3. 🚨 Firebase Phone Verification Check
        if (process.env.NODE_ENV === 'production' || (idToken && idToken.trim() !== "")) {
            if (!idToken) {
                return res.status(400).json({ 
                    success: false, 
                    message: "Firebase idToken is required for phone verification." 
                });
            }

            const fullPhoneToVerify = countryCode ? `${countryCode}${cleanPhone}` : cleanPhone;
            const verification = await verifyFirebasePhoneToken(idToken, fullPhoneToVerify);

            if (!verification.success) {
                return res.status(400).json({ success: false, message: verification.message });
            }
        }

        // 4. Hash Password
        const hashedPassword = await bcrypt.hash(password, 10);

        // 5. Create Provider in the selected Category Collection
        const newProvider = await Model.create({
            name, 
            email: normalizedEmail || undefined, 
            phone: cleanPhone,
            countryCode: countryCode || "+91",
            password: hashedPassword,
            category,
            role: category, 
            country: country || null, 
            state: state || null, 
            city: city || null,
            isPhoneVerified: true,
            profileStatus: 'Incomplete'
        });

        // 6. Generate Session Token
        const token = generateToken(newProvider._id, category);
        newProvider.token = token;
        await newProvider.save();

        res.status(201).json({ 
            success: true, 
            message: `${category} account registered & phone verified successfully. Please upload documents.`, 
            token,
            category,
            providerId: newProvider._id,
            profileStatus: 'Incomplete' 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
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

        // 🚨 SECURITY LOCK: Block login if Provider is inactive/disabled by Admin
        if (provider.isActive === false) {
            return res.status(403).json({ 
                success: false, 
                message: `Access Denied: Your ${category} partner account is inactive. Please contact support.` 
            });
        }

        if (provider.profileStatus === 'Pending') {
            return res.status(200).json({ 
                success: true, 
                fullAccess: false,
                profileStatus: 'Pending',
                message: 'Your profile is under review. Please wait for Admin approval.' 
            });
        }

        if (provider.profileStatus === 'Incomplete') {
            const token = provider.token || generateToken(provider._id, category);
            
            if (!provider.token) {
                await Model.findByIdAndUpdate(provider._id, { $set: { token: token } });
            }

            return res.status(200).json({ 
                success: true, 
                fullAccess: false, 
                token, 
                profileStatus: 'Incomplete',
                message: 'Profile incomplete. Please upload documents to proceed.' 
            });
        }

        if (provider.profileStatus === 'Rejected') {
            const token = provider.token || generateToken(provider._id, category);
            
            if (!provider.token) {
                await Model.findByIdAndUpdate(provider._id, { $set: { token: token } });
            }

            return res.status(200).json({ 
                success: true, 
                fullAccess: false, 
                token, 
                profileStatus: 'Rejected',
                rejectionReason: provider.rejectionReason,
                message: `Application Rejected: ${provider.rejectionReason}. Please re-upload documents.` 
            });
        }

        let token = null;
        if (process.env.NODE_ENV === 'development' && provider.token) {
            try {
                jwt.verify(provider.token, process.env.JWT_SECRET);
                token = provider.token;
            } catch (err) { token = null; }
        }

        if (!token) {
            token = generateToken(provider._id, category);
            await Model.findByIdAndUpdate(provider._id, { $set: { token: token } });
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

// 2. NEW PROVIDER STATUS TOGGLE API
const toggleProviderOnlineStatus = async (req, res) => {
    try {
        const { isOnline } = req.body;
        const providerId = req.user.id;
        const role = req.user.role; // e.g., 'Lab', 'Pharmacy', 'Nurse'

        if (isOnline === undefined) {
            return res.status(400).json({ success: false, message: "isOnline status value is required." });
        }

        const Model = getModelByCategory(role);
        if (!Model) return res.status(400).json({ success: false, message: "Invalid Provider Role" });

        const updatedProvider = await Model.findByIdAndUpdate(
            providerId,
            { $set: { isOnline: Boolean(isOnline) } },
            { new: true }
        ).select('-password');

        res.json({
            success: true,
            message: `Your status has been updated to ${isOnline ? 'Online' : 'Offline'}.`,
            isOnline: updatedProvider.isOnline
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
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

        // Purane documents lookup aur delete karne ke liye load karein
        const existingLab = await Lab.findById(labId);
        if (!existingLab) {
            return res.status(404).json({ success: false, message: "Lab not found." });
        }

        // Pura documents object taiyar karein
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

        // ==========================================
        // 💾 DELETE OLD FILES (LAB CLEANUP)
        // ==========================================
        if (files?.profileImage && existingLab.profileImage) {
            deleteFile(existingLab.profileImage);
        }

        if (existingLab.documents) {
            const documentFields = [
                'labImages', 'labCertificates', 'labLicenses', 
                'gstCertificates', 'drugLicenses', 'otherCertificates'
            ];

            documentFields.forEach(field => {
                const oldFileList = existingLab.documents[field];
                if (Array.isArray(oldFileList)) {
                    oldFileList.forEach(filePath => {
                        if (filePath) deleteFile(filePath);
                    });
                }
            });
        }
        // ==========================================

        const updatedLab = await Lab.findByIdAndUpdate(
            labId, 
            { 
                $set: { 
                    about,
                    profileStatus: 'Pending',
                    rejectionReason: null,
                    documents: documentsObj,
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
        const { 
            documentState, issuingAuthority, gstNumber, tanNumber, panNumber, cinNumber,
            drugLicenseType, about, isHomeDeliveryAvailable, is24x7,
            drugLicenseNumber, foodLicenseNumber 
        } = req.body;
        const files = req.files;

        // 🚨 1. VALIDATION: CIN Number is strictly COMPULSORY
        if (!cinNumber || cinNumber.trim() === "") {
            return res.status(400).json({ 
                success: false, 
                message: "CIN Number (Corporate Identity Number) is compulsory." 
            });
        }

        // 🚨 2. VALIDATION: Either GST Number OR (TAN + PAN) is COMPULSORY
        const hasGst = gstNumber && gstNumber.trim() !== "";
        const hasTanAndPan = (tanNumber && tanNumber.trim() !== "") && (panNumber && panNumber.trim() !== "");

        if (!hasGst && !hasTanAndPan) {
            return res.status(400).json({ 
                success: false, 
                message: "Compliance Error: You must provide either a valid 'GST Number' OR both 'TAN Number and PAN Number'." 
            });
        }

        const existingPharmacy = await Pharmacy.findById(pharmacyId);
        if (!existingPharmacy) {
            return res.status(404).json({ success: false, message: "Pharmacy not found." });
        }

        const documentsObj = {
            documentState,
            issuingAuthority,
            cinNumber: cinNumber.trim().toUpperCase(),
            gstNumber: hasGst ? gstNumber.trim().toUpperCase() : "",
            tanNumber: hasTanAndPan ? tanNumber.trim().toUpperCase() : "",
            panNumber: hasTanAndPan ? panNumber.trim().toUpperCase() : "",
            drugLicenseType,
            drugLicenseNumber: drugLicenseNumber ? drugLicenseNumber.trim() : "",
            foodLicenseNumber: foodLicenseNumber ? foodLicenseNumber.trim() : "",
            signatureImage: files?.signatureImage ? files.signatureImage[0].path.replace(/\\/g, "/") : null,
            pharmacyImages: files?.pharmacyImages ? files.pharmacyImages.map(f => f.path.replace(/\\/g, "/")) : [],
            pharmacyCertificates: files?.pharmacyCertificates ? files.pharmacyCertificates.map(f => f.path.replace(/\\/g, "/")) : [],
            pharmacyLicenses: files?.pharmacyLicenses ? files.pharmacyLicenses.map(f => f.path.replace(/\\/g, "/")) : [],
            gstCertificates: files?.gstCertificates ? files.gstCertificates.map(f => f.path.replace(/\\/g, "/")) : [],
            drugLicenses: files?.drugLicenses ? files.drugLicenses.map(f => f.path.replace(/\\/g, "/")) : [],
            otherCertificates: files?.otherCertificates ? files.otherCertificates.map(f => f.path.replace(/\\/g, "/")) : []
        };

        // File cleanup
        if (files?.profileImage && existingPharmacy.profileImage) {
            deleteFile(existingPharmacy.profileImage);
        }
        if (files?.signatureImage && existingPharmacy.documents?.signatureImage) {
            deleteFile(existingPharmacy.documents.signatureImage);
        }

        const updatedPharmacy = await Pharmacy.findByIdAndUpdate(
            pharmacyId, 
            { 
                $set: { 
                    about,
                    isHomeDeliveryAvailable: isHomeDeliveryAvailable === 'true',
                    is24x7: is24x7 === 'true',
                    profileStatus: 'Pending',
                    rejectionReason: null,
                    documents: documentsObj,
                    ...(files?.profileImage && { profileImage: files.profileImage[0].path.replace(/\\/g, "/") })
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

        // Purane files lookup karne ke liye details fetch karein
        const existingNurse = await Nurse.findById(nurseId);
        if (!existingNurse) {
            return res.status(404).json({ success: false, message: "Nurse not found." });
        }

        // Prepare documents object matching Nurse Schemas
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

        // ==========================================
        // 💾 DELETE OLD FILES (NURSE CLEANUP)
        // ==========================================
        if (files?.profileImage && existingNurse.profileImage) {
            deleteFile(existingNurse.profileImage);
        }

        if (existingNurse.documents) {
            const documentFields = [
                'nursingCertificates', 'licensePhotos', 'gstCertificates', 
                'experienceCertificates', 'otherCertificates'
            ];

            documentFields.forEach(field => {
                const oldFileList = existingNurse.documents[field];
                if (Array.isArray(oldFileList)) {
                    oldFileList.forEach(filePath => {
                        if (filePath) deleteFile(filePath);
                    });
                }
            });
        }
        // ==========================================

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

// Helper to find provider across any model by Email
const findProviderByEmail = async (email) => {
    const models = [Lab, Pharmacy, Nurse];
    for (let Model of models) {
        const provider = await Model.findOne({ email: email.toLowerCase() });
        if (provider) return { provider, Model };
    }
    return null;
};

// ==========================================
// FORGOT PASSWORD (Common for all Providers)
// ==========================================
const forgotPasswordProvider = async (req, res) => {
    try {
        const { email } = req.body;
        const result = await findProviderByEmail(email);

        if (!result) return res.status(404).json({ message: 'Provider not found' });

        const { provider } = result;

        let otp = process.env.NODE_ENV === 'development' ? '1111' : Math.floor(100000 + Math.random() * 900000).toString();

        provider.resetPasswordOtp = otp;
        provider.resetPasswordExpires = Date.now() + 10 * 60 * 1000;
        await provider.save();

        if (process.env.NODE_ENV === 'production') {
            await sendEmailOTP(email, otp);
        }

        res.json({ success: true, message: 'OTP sent to your registered email' });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// RESET PASSWORD (Common for all Providers)
// ==========================================
const resetPasswordProvider = async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        const result = await findProviderByEmail(email);

        if (!result) return res.status(404).json({ message: 'Provider not found' });
        const { provider } = result;

        if (provider.resetPasswordOtp !== otp || provider.resetPasswordExpires < Date.now()) {
            return res.status(400).json({ message: 'Invalid or Expired OTP' });
        }

        provider.password = await bcrypt.hash(newPassword, 10);
        provider.resetPasswordOtp = undefined;
        provider.resetPasswordExpires = undefined;
        await provider.save();

        res.json({ success: true, message: 'Password reset successful. Please login.' });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ==========================================
// 6. GET PROVIDER PROFILE (Unified)
// endpoint: GET /api/auth/provider/profile
// ==========================================
const getProviderProfile = async (req, res) => {
    try {
        const { id, role } = req.user; 
        const Model = getModelByCategory(role); 

        if (!Model) return res.status(400).json({ message: "Invalid Provider Role" });

        const profile = await Model.findById(id);

        if (!profile) return res.status(404).json({ message: "Profile not found" });

        res.json({ 
            success: true, 
            data: profile 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    registerProvider, checkProviderExists,
    loginProvider, toggleProviderOnlineStatus,
    uploadLabDocs, 
    uploadPharmacyDocs, 
    uploadNurseDocs,
    forgotPasswordProvider, 
    resetPasswordProvider, 
    getProviderProfile 
};