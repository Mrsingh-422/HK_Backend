const Admin = require("../../models/Admin");
const Doctor = require("../../models/Doctor");
const Hospital = require("../../models/Hospital");
const Provider = require("../../models/Provider");
const User = require("../../models/User");
const HospitalDoctor = require("../../models/HospitalDoctor");
const bcrypt = require("bcryptjs");
const { sendEmailOTP } = require("../../utils/emailService");

// Helper function to find account in any model
const findAccount = async (email) => {
    const models = [Admin, Doctor, Hospital, Provider, User, HospitalDoctor];
    for (let Model of models) {
        const account = await Model.findOne({ email: email.toLowerCase().trim() });
        if (account) return account;
    }
    return null;
};

// A. FORGOT PASSWORD - SEND OTP
// endpoint: POST /api/password/forgot-password
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ message: "Email is required" });

        const account = await findAccount(email);

        if (!account) {
            return res.status(404).json({ message: "Account not found with this email" });
        }

        let otp;
        let isProduction = process.env.NODE_ENV === 'production';

        if (isProduction) {
            // Production mein dynamic OTP
            otp = Math.floor(1000 + Math.random() * 9000).toString();
        } else {
            // Development mein static OTP
            otp = "1111";
        }

        account.resetPasswordOtp = otp;
        account.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 mins
        await account.save();

        console.log(`[${process.env.NODE_ENV}] OTP for ${email} is: ${otp}`);

        // Email sirf production mein bhejo
        if (isProduction) {
            const emailSent = await sendEmailOTP(email, otp);
            if (emailSent) {
                return res.json({ success: true, message: "OTP sent to your email" });
            }
        }

        // Dev mode ya email fail hone par bypass response
        res.json({ 
            success: true, 
            message: isProduction 
                ? "OTP generated (Email failed, check server console)" 
                : "Development Mode: Use static OTP 1111",
            testOtp: isProduction ? undefined : otp // Postman mein sirf dev mode me dikhega
        });

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
        if (!email || !otp) return res.status(400).json({ message: "Email and OTP are required" });

        // Sabhi models mein check karein
        const models = [Admin, Doctor, Hospital, Provider, User, HospitalDoctor];
        let account = null;

        for (let Model of models) {
            account = await Model.findOne({
                email: email.toLowerCase().trim(),
                resetPasswordOtp: otp,
                resetPasswordExpires: { $gt: Date.now() }
            });
            if (account) break;
        }

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

        if (!newPassword || newPassword !== confirmPassword) {
            return res.status(400).json({ message: "Passwords do not match or missing" });
        }

        const account = await findAccount(email);

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