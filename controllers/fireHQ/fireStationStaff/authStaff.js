const FireStaff = require('../../../models/FireStaff');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { deleteFile } = require('../../../utils/fileHandler');

const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// 1. LOGIN STAFF
const loginStaff = async (req, res) => {
    try {
        const { email, password } = req.body;
        const staff = await FireStaff.findOne({ officialEmail: email }).select('+password');
        if (!staff || !(await bcrypt.compare(password, staff.password))) {
            return res.status(401).json({ message: "Invalid Official Credentials" });
        }
        const token = generateToken(staff._id, 'Fire-Staff');
        staff.token = token;
        await staff.save();
        res.json({ success: true, token, data: staff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. UPDATE STAFF PROFILE
const updateStaffProfile = async (req, res) => {
    try {
        const staffId = req.user.id;
        const { fullName, rank, mobileNumber, address } = req.body;
        
        let updateData = { fullName, rank, mobileNumber, address };

        // Profile Image replacement logic
        if (req.file) {
            const currentStaff = await FireStaff.findById(staffId);
            if (currentStaff.profileImage) deleteFile(currentStaff.profileImage);
            updateData.profileImage = req.file.path;
        }

        const updatedStaff = await FireStaff.findByIdAndUpdate(
            staffId, 
            { $set: updateData }, 
            { new: true, runValidators: true }
        );

        res.json({ success: true, message: "Profile Updated Successfully!", data: updatedStaff });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const staff = await FireStaff.findOne({ officialEmail: email });

        if (!staff) return res.status(404).json({ success: false, message: "Staff not found with this email" });

        // Generate 4 digit OTP (Figma Screen 19 boxes)
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        staff.otp = otp;
        staff.otpExpires = Date.now() + 10 * 60 * 1000; // 10 mins validity
        await staff.save();

        // Note: Real production mein yahan nodemailer se email jayega
        res.json({ success: true, message: "OTP sent to your official email", otp }); // OTP response mein sirf testing ke liye bhej raha hun
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. VERIFY OTP (Figma Screen 19 - OTP Verify Button)
const verifyOTP = async (req, res) => {
    try {
        const { email, otp } = req.body;
        const staff = await FireStaff.findOne({ 
            officialEmail: email, 
            otp: otp, 
            otpExpires: { $gt: Date.now() } 
        });

        if (!staff) return res.status(400).json({ success: false, message: "Invalid or expired OTP" });

        res.json({ success: true, message: "OTP Verified. Now you can set a new password." });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 5. RESET PASSWORD - Final Step (Figma Screen 19 - Update Password Modal)
const resetPassword = async (req, res) => {
    try {
        const { email, newPassword } = req.body;
        const staff = await FireStaff.findOne({ officialEmail: email });

        if (!staff) return res.status(404).json({ message: "Staff not found" });

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        staff.password = await bcrypt.hash(newPassword, salt);
        
        // Clear OTP fields
        staff.otp = undefined;
        staff.otpExpires = undefined;
        await staff.save();

        res.json({ success: true, message: "Password updated successfully. Please login with your new password." });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// Missing: Authenticated Change Password (Figma Screen Settings)
const changePassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const staff = await FireStaff.findById(req.user.id).select('+password');

        // Check if old password is correct
        const isMatch = await bcrypt.compare(oldPassword, staff.password);
        if (!isMatch) return res.status(400).json({ success: false, message: "Old password does not match" });

        // Hash and Save new password
        const salt = await bcrypt.genSalt(10);
        staff.password = await bcrypt.hash(newPassword, salt);
        await staff.save();

        res.json({ success: true, message: "Password updated successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};


module.exports = { loginStaff, updateStaffProfile, forgotPassword, verifyOTP, resetPassword, changePassword };