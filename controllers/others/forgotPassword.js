const Admin = require("../../models/Admin");
const Doctor = require("../../models/Doctor");
const Hospital = require("../../models/Hospital");
const Provider = require("../../models/Provider");
const User = require("../../models/User");
const bcrypt = require("bcryptjs");
const { sendEmailOTP } = require("../../utils/emailService");

// A. FORGOT PASSWORD - SEND OTP
// endpoint: POST /api/password/forgot-password
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        // Sirf User model mein dhoond rahe hain (baaki abhi ke liye disabled)
        const account = await User.findOne({ email });

        if (!account) {
            return res.status(404).json({ message: "User not found with this email" });
        }

        const otp = Math.floor(1000 + Math.random() * 9000).toString();

        account.resetPasswordOtp = otp;
        account.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 mins
        await account.save();

        const emailSent = await sendEmailOTP(email, otp);

        if (!emailSent) {
            // 🔥 BYPASS: Email fail hua toh bhi terminal mein OTP dikhao aur aage badho
            console.log("-----------------------------------------");
            console.log(`⚠️  BREVO BLOCKED IP, BUT TESTING OTP IS: ${otp}`);
            console.log("-----------------------------------------");
            
            return res.json({ 
                success: true, 
                message: "OTP generated. Check server terminal since email is blocked locally.",
                testOtp: otp // Postman mein bhi OTP dikhega testing ke liye
            });
        }

        res.json({ success: true, message: "OTP sent to email" });

    } catch (error) {
        console.error("Forgot Password Error:", error);
        res.status(500).json({ message: error.message });
    }
};
 
// B. VERIFY OTP
// endpoint: POST /api/password/verify-otp
const verifyOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;

        let account =
            await Hospital.findOne({
                email,
                resetPasswordOtp: otp,
                resetPasswordExpires: { $gt: Date.now() }
            }) ||
            await User.findOne({
                email,
                resetPasswordOtp: otp,
                resetPasswordExpires: { $gt: Date.now() }
            }) ||
            await Admin.findOne({
                email,
                resetPasswordOtp: otp,
                resetPasswordExpires: { $gt: Date.now() }
            }) ||
            await Provider.findOne({
                email,
                resetPasswordOtp: otp,
                resetPasswordExpires: { $gt: Date.now() }
            }) ||
            await Doctor.findOne({
                email,
                resetPasswordOtp: otp,
                resetPasswordExpires: { $gt: Date.now() }
            });

        if (!account) {
            return res.status(400).json({ message: "Invalid or Expired OTP" });
        }

        res.json({ success: true, message: "OTP Verified Successfully" });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// C. RESET PASSWORD
// endpoint: POST /api/password/reset-password
const resetPassword = async (req, res) => {
    try {
        const { email, newPassword, confirmPassword } = req.body;

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ message: "Passwords do not match" });
        }

        let account =
            await Hospital.findOne({ email }) ||
            await User.findOne({ email }) ||
            await Admin.findOne({ email }) ||
            await Provider.findOne({ email }) ||
            await Doctor.findOne({ email });

        if (!account) {
            return res.status(404).json({ message: "User not found" });
        }

        // Hash new password
        account.password = await bcrypt.hash(newPassword, 10);

        // Clear OTP fields
        account.resetPasswordOtp = undefined;
        account.resetPasswordExpires = undefined;

        await account.save();

        res.json({
            success: true,
            message: "Password Reset Successfully. Please Login."
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { forgotPassword, verifyOtp, resetPassword };