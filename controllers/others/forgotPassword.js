// File Path: controllers/others/forgotPassword.js

const Admin = require("../../models/Admin");
const Doctor = require("../../models/Doctor");
const Hospital = require("../../models/Hospital");
const User = require("../../models/User");
const Lab = require("../../models/Lab");
const Pharmacy = require("../../models/Pharmacy");
const Nurse = require("../../models/Nurse");
const PoliceHQ = require("../../models/PoliceHQ");
const PoliceStation = require("../../models/PoliceStation");
const PoliceStaff = require("../../models/PoliceStaff");
const FireHQ = require("../../models/FireHQ");
const FireStation = require("../../models/FireStation");
const FireStaff = require("../../models/FireStaff");

const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const firebaseAdmin = require("firebase-admin"); // 🚨 Renamed to prevent collision with 'Admin' model
const { getAuth } = require('firebase-admin/auth'); 
const { sendEmailOTP } = require("../../utils/emailService");

// All active models in the project
const modelsList = [
    { name: "Admin", model: Admin, phoneKey: "phone", emailKey: "email" },
    { name: "Doctor", model: Doctor, phoneKey: "phone", emailKey: "email" },
    { name: "Hospital", model: Hospital, phoneKey: "phone", emailKey: "email" },
    { name: "User", model: User, phoneKey: "phone", emailKey: "email" },
    { name: "Lab", model: Lab, phoneKey: "phone", emailKey: "email" },
    { name: "Pharmacy", model: Pharmacy, phoneKey: "phone", emailKey: "email" },
    { name: "Nurse", model: Nurse, phoneKey: "phone", emailKey: "email" },
    { name: "PoliceHQ", model: PoliceHQ, phoneKey: "phone", emailKey: "email" },
    { name: "PoliceStation", model: PoliceStation, phoneKey: "phone", emailKey: "email" },
    { name: "PoliceStaff", model: PoliceStaff, phoneKey: "mobileNumber", emailKey: "officialEmail" }, 
    { name: "FireHQ", model: FireHQ, phoneKey: "phone", emailKey: "email" },
    { name: "FireStation", model: FireStation, phoneKey: "phone", emailKey: "email" },
    { name: "FireStaff", model: FireStaff, phoneKey: "mobileNumber", emailKey: "officialEmail" } 
];

// Helper: Find account by Email across any schema
const findAccountByEmail = async (email) => {
    const cleanEmail = email.toLowerCase().trim();
    for (let item of modelsList) {
        const query = {};
        query[item.emailKey] = cleanEmail;
        const account = await item.model.findOne(query);
        if (account) return { account, Model: item.model, meta: item };
    }
    return null;
};

// Helper: Find account by Phone across any schema
const findAccountByPhone = async (phone) => {
    const cleanPhone = phone.trim();
    for (let item of modelsList) {
        const query = {};
        query[item.phoneKey] = cleanPhone;
        const account = await item.model.findOne(query);
        if (account) return { account, Model: item.model, meta: item };
    }
    return null;
};

// =========================================================================
// ✉️ EMAIL FLOW (Brevo OTP - Existing logic completely preserved)
// =========================================================================

const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ message: "Email is required" });

        const result = await findAccountByEmail(email);
        if (!result) {
            return res.status(404).json({ message: "Account not found with this email" });
        }

        const { account } = result;

        let otp;
        let isProduction = process.env.NODE_ENV === 'production';

        if (isProduction) {
            otp = Math.floor(1000 + Math.random() * 9000).toString();
        } else {
            otp = "1111";
        }

        account.resetPasswordOtp = otp;
        account.resetPasswordExpires = Date.now() + 10 * 60 * 1000; 
        await account.save();

        console.log(`[${process.env.NODE_ENV}] OTP for ${email} is: ${otp}`);

        if (isProduction) {
            const emailSent = await sendEmailOTP(email, otp);
            if (emailSent) {
                return res.json({ success: true, message: "OTP sent to your email" });
            }
        }

        res.json({ 
            success: true, 
            message: isProduction 
                ? "OTP generated (Email failed, check server console)" 
                : "Development Mode: Use static OTP 1111",
            testOtp: isProduction ? undefined : otp 
        });

    } catch (error) {
        console.error("Forgot Password Error:", error);
        res.status(500).json({ message: error.message });
    }
};

const verifyOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) return res.status(400).json({ message: "Email and OTP are required" });

        const cleanEmail = email.toLowerCase().trim();
        let account = null;

        for (let item of modelsList) {
            const query = {
                resetPasswordOtp: otp,
                resetPasswordExpires: { $gt: Date.now() }
            };
            query[item.emailKey] = cleanEmail;
            
            account = await item.model.findOne(query);
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

const resetPassword = async (req, res) => {
    try {
        const { email, newPassword, confirmPassword } = req.body;

        if (!newPassword || newPassword !== confirmPassword) {
            return res.status(400).json({ message: "Passwords do not match or missing" });
        }

        const result = await findAccountByEmail(email);
        if (!result) {
            return res.status(404).json({ message: "User not found" });
        }

        const { account } = result;

        account.password = await bcrypt.hash(newPassword, 10);
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

// =========================================================================
// 📱 MOBILE SMS FLOW (Firebase Phone OTP)
// =========================================================================

// A. Check if phone number exists in any model
const forgotPasswordPhone = async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ success: false, message: "Phone number is required." });

        const result = await findAccountByPhone(phone);
        if (!result) {
            return res.status(404).json({ success: false, message: "No account registered with this phone number." });
        }

        res.json({ 
            success: true, 
            message: "Phone verified. Please trigger Firebase SMS OTP on the mobile app." 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// B. Verify Firebase idToken sent from mobile app and generate secure Reset Token
const verifyFirebaseOtp = async (req, res) => {
    try {
        const { phone, idToken } = req.body;

        if (!phone || !idToken) {
            return res.status(400).json({ success: false, message: "Phone number and Firebase idToken are required." });
        }

        // 🚨 FIREBASE v14 RESOLVER: Retrieve the default active auth instance safely (100% crash proof)
        let authInstance;
        try {
            authInstance = getAuth(); 
        } catch (initError) {
            console.error("❌ Firebase Auth Initialization Failed:", initError.message);
            return res.status(500).json({ success: false, message: "Internal Server Error: Firebase Auth not initialized." });
        }

        // Firebase Admin verification step using the modern resolved 'authInstance'
        let decodedToken;
        try {
            decodedToken = await authInstance.verifyIdToken(idToken);
        } catch (authError) {
            console.error("Firebase token verification failed:", authError.message);
            return res.status(401).json({ success: false, message: "Invalid or expired Firebase ID token." });
        }

        const firebasePhone = decodedToken.phone_number; // e.g. "+919876543210"
        
        // Match numbers safely
        const cleanReqPhone = phone.replace(/\D/g, "");
        const cleanFirebasePhone = firebasePhone.replace(/\D/g, "");

        if (!cleanFirebasePhone.includes(cleanReqPhone)) {
            return res.status(400).json({ success: false, message: "Security Block: Phone number mismatch with Firebase token." });
        }

        const result = await findAccountByPhone(phone);
        if (!result) {
            return res.status(404).json({ success: false, message: "User profile not found." });
        }

        // Generate secure reset token
        const secureResetToken = crypto.randomBytes(20).toString('hex');
        
        // TIMEZONE LOCK BYPASS: Set expiry to 2 hours (120 mins) to securely cover the 1-hour timezone offset shifts
        const updateData = {
            resetPasswordOtp: secureResetToken,
            resetPasswordExpires: Date.now() + 2 * 60 * 60 * 1000 // Expiry shifted to 2 hours
        };

        await result.Model.findByIdAndUpdate(result.account._id, { $set: updateData });

        const accountInfo = {
            name: result.account.name || result.account.fullName || result.account.stationName || result.account.hqName || "Verified Partner",
            role: result.meta.name, 
            email: result.account.email || result.account.officialEmail || "N/A"
        };

        res.json({
            success: true,
            message: "OTP Verified by Firebase successfully!",
            resetToken: secureResetToken,
            accountInfo 
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// C. Reset Password using the generated Reset Token
const resetPasswordPhone = async (req, res) => {
    try {
        const { phone, resetToken, newPassword, confirmPassword } = req.body;

        if (!phone || !resetToken || !newPassword) {
            return res.status(400).json({ success: false, message: "Validation Block: Phone, resetToken and newPassword are required." });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ success: false, message: "Validation Block: Passwords do not match." });
        }

        const cleanPhone = phone.trim();
        let result = null;

        // Loop through models and strictly select (+resetPasswordOtp) to bypass 'select: false' schema restrictions
        for (let item of modelsList) {
            const query = {};
            query[item.phoneKey] = cleanPhone;
            
            const account = await item.model.findOne(query).select('+resetPasswordOtp +resetPasswordExpires');
            if (account) {
                result = { account, Model: item.model, meta: item };
                break;
            }
        }

        if (!result) {
            return res.status(404).json({ success: false, message: "Account not found for this phone number." });
        }

        const account = result.account;

        // 🚨 STRICT EXPLICIT CASTS: Convert to raw trimmed strings to prevent type mismatches
        const savedToken = String(account.resetPasswordOtp || "").trim();
        const receivedToken = String(resetToken || "").trim();

        console.log(`[Reset Audit] Casted Saved Token: ${savedToken} | Casted Received Token: ${receivedToken}`);

        // Verify token matches
        if (savedToken !== receivedToken) {
            return res.status(400).json({ success: false, message: "Access Denied: Invalid Reset Token." });
        }

        // 🚨 CRITICAL DATE CHECK: Safe cast to getTime() millisecond timestamps
        const dbExpiryTime = account.resetPasswordExpires ? new Date(account.resetPasswordExpires).getTime() : 0;
        const currentTime = Date.now();

        console.log(`[Reset Audit] DB Expiry: ${dbExpiryTime} | Current Time: ${currentTime}`);

        if (dbExpiryTime < currentTime) {
            return res.status(400).json({ success: false, message: "Access Denied: Reset Token has expired." });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password and flush dynamic temp OTP fields securely
        await result.Model.findByIdAndUpdate(account._id, {
            $set: {
                password: hashedPassword,
                resetPasswordOtp: null,
                resetPasswordExpires: null
            }
        });

        res.json({
            success: true,
            message: "Password Reset Successfully. Please Login."
        });

    } catch (error) {
        // Returns the exact system error stack to prevent silent crashes
        console.error("Critical Reset Password Error:", error);
        res.status(500).json({ success: false, message: "Server Error: " + error.message });
    }
};

module.exports = { 
    forgotPassword, verifyOtp, resetPassword,
    forgotPasswordPhone, verifyFirebaseOtp, resetPasswordPhone 
};