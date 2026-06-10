const PoliceHQ = require('../../models/PoliceHQ');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { deleteFile } = require('../../utils/fileHandler');

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

// 3. UPDATE HQ PROFILE
const updatePoliceHQProfile = async (req, res) => {
    try {
        const id = req.user.id;
        const updates = req.body;
        const current = await PoliceHQ.findById(id);

        if (req.files && req.files.profileImage) {
            if (current.profileImage) deleteFile(current.profileImage);
            updates.profileImage = req.files.profileImage[0].path;
        }

        const updated = await PoliceHQ.findByIdAndUpdate(id, updates, { new: true });
        res.json({ success: true, message: "Profile Updated", data: updated });
    } catch (error) { res.status(500).json({ message: error.message }); }
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
module.exports = { registerPoliceHQ, loginPoliceHQ, updatePoliceHQProfile ,forgotPasswordRequest,
    verifyOtpRequest,
    resetPasswordAfterVerification};