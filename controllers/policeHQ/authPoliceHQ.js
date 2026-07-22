const PoliceHQ = require('../../models/PoliceHQ');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { deleteFile } = require('../../utils/fileHandler');
const ProfileUpdateRequest = require('../../models/ProfileUpdateRequest');


// 🚨 HELPER FUNCTION: Extract and standardize uploaded image paths (Added here)
const getImagePath = (req) => {
    let filePath = null;

    if (req.file) {
        filePath = req.file.path;
    } else if (req.files) {
        if (req.files.profileImage && req.files.profileImage[0]) {
            filePath = req.files.profileImage[0].path;
        } else if (Array.isArray(req.files)) {
            const found = req.files.find(f => f.fieldname === 'profileImage');
            if (found) filePath = found.path;
        }
    }

    if (!filePath) return null;

    // Convert Windows backslashes (\) to forward slashes (/)
    filePath = filePath.replace(/\\/g, '/');

    // Strip 'public/' from the static path
    if (filePath.startsWith('public/')) {
        filePath = filePath.replace('public/', '/');
    } else if (!filePath.startsWith('/')) {
        filePath = '/' + filePath;
    }

    return filePath;
};

const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// 1. REGISTER POLICE HQ
const registerPoliceHQ = async (req, res) => {
    try {
        const { hqName, commissionerName, email, phone, password, country, state, city, address, lat, lng } = req.body;
        const exists = await PoliceHQ.findOne({ $or: [{ email }, { phone }] });
        if (exists) return res.status(400).json({ message: "Police HQ already exists" });

        const hashedPassword = await bcrypt.hash(password, 10);
        await PoliceHQ.create({
            hqName, commissionerName, email, phone, country, state, city, address,
            location: { lat, lng },
            password: hashedPassword
        });
        res.status(201).json({ success: true, message: "Police HQ Registered Successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. LOGIN POLICE HQ
const loginPoliceHQ = async (req, res) => {
    try {
        const { email, password } = req.body;
        const hq = await PoliceHQ.findOne({ email }).select('+password');
        if (!hq || !(await bcrypt.compare(password, hq.password))) {
            return res.status(401).json({ message: "Invalid credentials" });
        }
        const token = generateToken(hq._id, 'Police-HQ');
        hq.token = token;
        await hq.save();
        res.json({ success: true, token, data: hq });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. UPDATE PROFILE (With Staging Flow & Image Cleanup)
const updatePoliceHQProfile = async (req, res) => {
    try {
        const id = req.user.id;
        const updates = { ...req.body };

        const current = await PoliceHQ.findById(id);
        if (!current) {
            return res.status(404).json({ success: false, message: "Police HQ profile not found." });
        }

        // SECURITY LOCKS: Protect sensitive fields
        delete updates.password;
        delete updates.email;
        delete updates.phone;
        delete updates.role;
        delete updates.token;

        // Resolve static web path (stripping 'public/') using helper
        const newImage = getImagePath(req);
        if (newImage) {
            updates.profileImage = newImage;
        }

        // DISK CLEANUP: Delete unapproved files from any existing PENDING request
        const existingPending = await ProfileUpdateRequest.findOne({ 
            vendorId: id, 
            vendorModel: 'PoliceHQ', 
            status: 'Pending' 
        });

        if (existingPending) {
            if (updates.profileImage && existingPending.updatedFields?.profileImage) {
                deleteFile(existingPending.updatedFields.profileImage);
            }
            await ProfileUpdateRequest.findByIdAndDelete(existingPending._id);
        }

        // Save staged update request
        const request = await ProfileUpdateRequest.create({
            vendorId: id,
            vendorModel: 'PoliceHQ',
            updatedFields: updates,
            status: 'Pending'
        });

        res.json({ 
            success: true, 
            message: "Profile changes submitted to Admin for review. Your profile will update once approved.", 
            data: request 
        });
    } catch (error) { 
        console.error("Police HQ Update Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 3. Append this function to fetch status tracking:
const getLatestPoliceHQProfileRequest = async (req, res) => {
    try {
        const latestRequest = await ProfileUpdateRequest.findOne({
            vendorId: req.user.id,
            vendorModel: 'PoliceHQ'
        })
        .sort({ createdAt: -1 })
        .lean();

        res.json({ success: true, data: latestRequest || null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


/**
 * 5. SEND PASSWORD RESET REQUEST (forgot password)
 * Figma Link: Screen 18 (Forgot Password email popup submit)
 */
const forgotPasswordRequest = async (req, res) => {
    try {
        const { email } = req.body;
        const hq = await PoliceHQ.findOne({ email });
        if (!hq) {
            return res.status(404).json({ success: false, message: "Police HQ with this email does not exist" });
        }

        // Generate a 4-Digit OTP for Testing
        const testOtp = Math.floor(1000 + Math.random() * 9000).toString();
        hq.otp = testOtp;
        hq.otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes expiry
        await hq.save();

        res.json({
            success: true,
            message: "OTP sent successfully to your email (Testing Bypass)",
            otp: testOtp // Testing bypass ke liye response me return kiya hai
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 6. VERIFY OTP
 * Figma Link: Screen 19 (4-Digit OTP input verify click)
 */
const verifyOtpRequest = async (req, res) => {
    try {
        const { email, otp } = req.body;
        const hq = await PoliceHQ.findOne({ email, otp }).select('+otpExpires');

        if (!hq || hq.otpExpires < Date.now()) {
            return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
        }

        // OTP Valid, use temporary reset access
        hq.otp = null; 
        hq.otpExpires = null;
        await hq.save();

        res.json({
            success: true,
            message: "OTP Verified successfully. You can reset your password now."
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 7. RESET PASSWORD AFTER OTP VERIFICATION
 */
const resetPasswordAfterVerification = async (req, res) => {
    try {
        const { email, newPassword } = req.body;
        if (!newPassword) {
            return res.status(400).json({ success: false, message: "newPassword is required" });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const hq = await PoliceHQ.findOneAndUpdate(
            { email },
            { $set: { password: hashedPassword } },
            { new: true }
        );

        if (!hq) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        res.json({
            success: true,
            message: "Password reset successfully. Please login with new password."
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET: Fetch currently logged-in Police HQ profile details
const getHQProfile = async (req, res) => {
    try {
        const hq = await PoliceHQ.findById(req.user.id).select('-password');
        if (!hq) {
            return res.status(404).json({ success: false, message: "Police HQ profile not found." });
        }
        res.json({ success: true, data: hq });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// PUT: Change logged-in Police HQ account password
const changePasswordHQ = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ success: false, message: "Both oldPassword and newPassword are required." });
        }

        const hq = await PoliceHQ.findById(req.user.id).select('+password');
        if (!hq) {
            return res.status(404).json({ success: false, message: "Police HQ account not found." });
        }

        const isMatch = await bcrypt.compare(oldPassword, hq.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Current password is wrong" });
        }

        hq.password = await bcrypt.hash(newPassword, 10);
        await hq.save();

        res.json({ success: true, message: "Password updated successfully" });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};
module.exports = { registerPoliceHQ, loginPoliceHQ, updatePoliceHQProfile ,forgotPasswordRequest,
    verifyOtpRequest,
    resetPasswordAfterVerification,
    getLatestPoliceHQProfileRequest,
    getHQProfile,
    changePasswordHQ };