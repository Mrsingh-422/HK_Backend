const User = require('../../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); // Built-in Node module for random numbers
const sendEmailOTP = require('../../utils/emailService'); // Email sending utility

// Helper: Generate Token
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// ==========================================
// 1. REGISTER USER (Matches Figma Register Screen)
// endpoint: POST /api/auth/user/register
const registerUser = async (req, res) => {
    try {
        const { 
            name, email, phone, 
            country, state, city, 
            password, confirmPassword 
        } = req.body;

        // 1. Basic Validation
        if (!email && !phone) return res.status(400).json({ message: 'Email or Phone required' });
        if (!password) return res.status(400).json({ message: 'Password is required' });
        
        // Confirm Password Check (Optional if frontend handles it, but good for security)
        if (confirmPassword && password !== confirmPassword) {
            return res.status(400).json({ message: 'Passwords do not match' });
        }

        // 2. Duplicate Check
        const exists = await User.findOne({ $or: [{ email }, { phone }] });
        if (exists) return res.status(400).json({ message: 'User already exists with this Email or Phone' });

        // 3. Hash Password
        const hashedPassword = await bcrypt.hash(password, 10);

        // 4. Create User
        const user = await User.create({
            name,
            email: email || undefined,
            phone: phone || undefined,
            country,
            state,
            city,
            password: hashedPassword,
            role: 'user',
            profileStatus: 'Approved'
        });

        // 5. Generate Token
        const token = generateToken(user._id);

        res.status(201).json({ 
            success: true, 
            message: "User Registered Successfully",
            token, 
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                location: `${user.city}, ${user.state}, ${user.country}`
            } 
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ==========================================
// 2. LOGIN USER (Matches Figma Login Screen)
// endpoint: POST /api/auth/user/login
const loginUser = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        
        let query = {};
        if (email) query = { email };
        else if (phone) query = { phone };
        else return res.status(400).json({ message: 'Provide Email or Phone' });

        // 1. Find User
        const user = await User.findOne(query).select('+password');
        
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        let token = null;

        // --- DEVELOPMENT MODE LOGIC (Reuse Token) ---
        if (process.env.NODE_ENV === 'development') {
            if (user.token) {
                try {
                    // Check if token is still valid
                    jwt.verify(user.token, process.env.JWT_SECRET);
                    token = user.token;
                    console.log("Development Mode: Using Existing Token");
                } catch (err) {
                    token = null; // Token expired or invalid
                }
            }
        }

        // --- GENERATE NEW TOKEN (If not reused) ---
        if (!token) {
            token = generateToken(user._id);
            
            // Save new token to DB
            user.token = token;
            await user.save();
            console.log("New User Token Generated");
        }
        user.password = undefined; // Hide password in response

        res.json({ success: true, token, user });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ==========================================
// 3. FORGOT PASSWORD FLOW (Figma Screens)

// A. SEND OTP (Screen: Forgot Password -> Enter Email -> Submit)
// endpoint: POST /api/auth/user/forgot-password
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });

        if (!user) return res.status(404).json({ message: 'User not found with this email' });

        // --- ENV LOGIC FOR OTP ---
        let otp;
        if (process.env.NODE_ENV === 'development') {
            otp = '1111'; // Dev Mode: Fixed OTP
            console.log(`🟨 [DEV MODE] OTP for ${email} is: ${otp}`);
        } else {
            otp = Math.floor(100000 + Math.random() * 900000).toString(); // Prod Mode: Random 6 Digit
        }

        // Save OTP to DB
        user.resetPasswordOtp = otp;
        user.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 Minutes
        await user.save();

        // Send Email (Only in Production)
        if (process.env.NODE_ENV === 'production') {
            const emailSent = await sendEmailOTP(email, otp);
            if (!emailSent) {
                return res.status(500).json({ message: "Failed to send email" });
            }
        }

        res.json({ success: true, message: 'OTP sent to your email' });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// B. VERIFY OTP (Only for Forgot Password)
// endpoint: POST /api/auth/user/verify-otp
const verifyOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;

        // Find user with matching Email AND OTP AND Not Expired
        const user = await User.findOne({
            email,
            resetPasswordOtp: otp,
            resetPasswordExpires: { $gt: Date.now() } 
        });

        if (!user) {
            return res.status(400).json({ message: 'Invalid or Expired OTP' });
        }

        // OTP Verified
        res.json({ success: true, message: 'OTP Verified Successfully' });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// C. RESET PASSWORD (Final Step)
// endpoint: POST /api/auth/user/reset-password
const resetPassword = async (req, res) => {
    try {
        const { email, newPassword, confirmPassword } = req.body;

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ message: 'Passwords do not match' });
        }

        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Update Password
        user.password = await bcrypt.hash(newPassword, 10);

        // Clear OTP fields
        user.resetPasswordOtp = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        res.json({ success: true, message: 'Password Reset Successfully. Please Login.' });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Update Profile (Existing Code)
// endpoint: PUT /api/auth/user/update
const updateUserProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { phone, email, insuranceId, country, state, city } = req.body;

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { phone, email, insuranceId, country, state, city },
            { new: true }
        );
        res.json({ success: true, message: "Profile Updated", user: updatedUser });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    registerUser, 
    loginUser, 
    updateUserProfile,
    forgotPassword,
    verifyOtp,
    resetPassword
};