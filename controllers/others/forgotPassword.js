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
const firebaseAdmin = require("firebase-admin"); 
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

// Helper: Find ALL matching accounts by Phone
const findAllAccountsByPhone = async (phone) => {
    const cleanPhone = phone.trim();
    const matchedProfiles = [];

    for (let item of modelsList) {
        const query = {};
        query[item.phoneKey] = cleanPhone;
        const account = await item.model.findOne(query);
        if (account) {
            matchedProfiles.push({
                id: account._id,
                name: account.name || account.fullName || account.stationName || account.hqName || "Verified Partner",
                role: item.name,
                email: account.email || account.officialEmail || "N/A"
            });
        }
    }
    return matchedProfiles;
};

// =========================================================================
// ✉️ EMAIL FLOW (Brevo OTP - Preserved)
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

// A. Check phone and return list of ALL associated accounts
const forgotPasswordPhone = async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ success: false, message: "Phone number is required." });

        const accounts = await findAllAccountsByPhone(phone);
        if (accounts.length === 0) {
            return res.status(404).json({ success: false, message: "No account registered with this phone number." });
        }

        res.json({ 
            success: true, 
            message: `${accounts.length} account(s) found. Select profile to reset.`, 
            accounts 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// B. Verify idToken and save secure reset token specifically for selectedRole account
const verifyFirebaseOtp = async (req, res) => {
    try {
        const { phone, idToken, selectedRole } = req.body;

        if (!phone || !idToken || !selectedRole) {
            return res.status(400).json({ success: false, message: "Phone, idToken and selectedRole are required." });
        }

        const authInstance = getAuth();

        let decodedToken;
        try {
            decodedToken = await authInstance.verifyIdToken(idToken);
        } catch (authError) {
            console.error("Firebase token verification failed:", authError.message);
            return res.status(401).json({ success: false, message: "Invalid or expired Firebase ID token." });
        }

        const firebasePhone = decodedToken.phone_number; 
        const cleanReqPhone = phone.replace(/\D/g, "");
        const cleanFirebasePhone = firebasePhone.replace(/\D/g, "");

        if (!cleanFirebasePhone.includes(cleanReqPhone)) {
            return res.status(400).json({ success: false, message: "Security Block: Phone number mismatch." });
        }

        const targetMeta = modelsList.find(m => m.name === selectedRole);
        if (!targetMeta) {
            return res.status(400).json({ success: false, message: "Invalid model role selected." });
        }

        const query = {};
        query[targetMeta.phoneKey] = phone.trim();
        
        const account = await targetMeta.model.findOne(query);
        if (!account) {
            return res.status(404).json({ success: false, message: `Account not found under role: ${selectedRole}` });
        }

        const secureResetToken = crypto.randomBytes(20).toString('hex');
        
        const updateData = {
            resetPasswordOtp: secureResetToken,
            resetPasswordExpires: new Date(Date.now() + 2 * 60 * 60 * 1000) // 2-Hours Expiry to prevent timezone offsets
        };

        // 🚨 CRITICAL BYPASS: Use MongoDB native direct write (updateOne) to bypass Mongoose Schema restrictions!
        await targetMeta.model.collection.updateOne(
            { _id: account._id },
            { $set: updateData }
        );

        res.json({
            success: true,
            message: "OTP Verified by Firebase successfully!",
            resetToken: secureResetToken,
            accountInfo: {
                name: account.name || account.fullName || account.stationName || account.hqName || "Verified Partner",
                role: selectedRole,
                email: account.email || account.officialEmail || "N/A"
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// C. Reset Password strictly for the selectedRole account using Reset Token
const resetPasswordPhone = async (req, res) => {
    try {
        const { phone, resetToken, selectedRole, newPassword, confirmPassword } = req.body;

        if (!phone || !resetToken || !newPassword || !selectedRole) {
            return res.status(400).json({ success: false, message: "Validation Block: Phone, resetToken, selectedRole and newPassword are required." });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ success: false, message: "Validation Block: Passwords do not match." });
        }

        const targetMeta = modelsList.find(m => m.name === selectedRole);
        if (!targetMeta) {
            return res.status(400).json({ success: false, message: "Invalid model role selected." });
        }

        const query = {};
        query[targetMeta.phoneKey] = phone.trim();

        // 🚨 CRITICAL BYPASS: Use MongoDB native direct read (findOne) to bypass Mongoose schema select exclusions!
        const rawAccount = await targetMeta.model.collection.findOne(query);
        if (!rawAccount) {
            return res.status(404).json({ success: false, message: `Account not found under role: ${selectedRole}` });
        }

        const savedToken = String(rawAccount.resetPasswordOtp || "").trim();
        const receivedToken = String(resetToken || "").trim();

        console.log(`[Reset Audit] DB Saved Token: ${savedToken} | Received Token: ${receivedToken}`);

        // Verify token matches
        if (savedToken !== receivedToken) {
            return res.status(400).json({ success: false, message: "Access Denied: Invalid Reset Token." });
        }

        const dbExpiryTime = rawAccount.resetPasswordExpires ? new Date(rawAccount.resetPasswordExpires).getTime() : 0;
        const currentTime = Date.now();

        console.log(`[Reset Audit] DB Expiry: ${dbExpiryTime} | Current Time: ${currentTime}`);

        if (dbExpiryTime < currentTime) {
            return res.status(400).json({ success: false, message: "Access Denied: Reset Token has expired." });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // 🚨 CRITICAL BYPASS: Save password and completely clean up temporary fields using $unset!
        await targetMeta.model.collection.updateOne(
            { _id: rawAccount._id },
            {
                $set: { password: hashedPassword },
                $unset: { resetPasswordOtp: "", resetPasswordExpires: "" } // Removes temp keys from DB document
            }
        );

        res.json({
            success: true,
            message: "Password Reset Successfully. Please Login."
        });

    } catch (error) {
        console.error("Critical Reset Password Error:", error);
        res.status(500).json({ success: false, message: "Server Error: " + error.message });
    }
};

module.exports = { 
    forgotPassword, verifyOtp, resetPassword,
    forgotPasswordPhone, verifyFirebaseOtp, resetPasswordPhone 
};