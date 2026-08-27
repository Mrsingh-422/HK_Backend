const Driver = require('../../../models/Driver');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// 1. REGISTER DRIVER (By Vendor)
// endpoint: POST /provider/driver/add
const registerDriver = async (req, res) => {
    try {
        const vendorId = req.user.id; 
        const { name, phone, password, username, ...details } = req.body;
        const files = req.files;

        // 1. JWT Role value ko strict Schema Enum casing me normalize karna (Casing Fix)
        const roleMapping = {
            'lab': 'Lab', 'pharmacy': 'Pharmacy', 'nurse': 'Nurse', 'hospital': 'Hospital', 'ambulance': 'Ambulance',
            'Lab': 'Lab', 'Pharmacy': 'Pharmacy', 'Nurse': 'Nurse', 'Hospital': 'Hospital', 'Ambulance': 'Ambulance'
        };
        const vendorType = roleMapping[req.user.role] || req.user.role;

        // Validation: Required fields check
        if (!name || !phone || !password || !username) {
            return res.status(400).json({ 
                success: false, 
                message: "Name, Phone, Password, and Username are required fields" 
            });
        }

        // 2. Dynamic query array setup to prevent undefined null match bugs (Mongoose Duplicate Query Fix)
        const queryConditions = [];
        if (username) queryConditions.push({ username });
        if (phone) queryConditions.push({ phone });

        if (queryConditions.length > 0) {
            const exists = await Driver.findOne({ $or: queryConditions });
            if (exists) {
                if (username && exists.username === username) {
                    return res.status(400).json({ success: false, message: "Username already taken" });
                }
                if (phone && exists.phone === phone) {
                    return res.status(400).json({ success: false, message: "Phone number already registered" });
                }
            }
        }

        const hashedPassword = await bcrypt.hash(String(password), 10);

        // Files reference safety check
        const profilePicPath = files?.profilePic ? files.profilePic[0].path : null;
        const certPath = files?.certificate ? files.certificate[0].path : null;
        const licensePath = files?.license ? files.license[0].path : null;
        const rcPath = files?.rcImage ? files.rcImage[0].path : null;

        const driver = await Driver.create({
            vendorId, 
            vendorType, 
            name, 
            phone,
            password: hashedPassword,
            username,
            ...details,
            profilePic: profilePicPath,
            documents: {
                certificate: certPath,
                license: licensePath,
                rcImage: rcPath
            }
        });

        // Hide password in response
        driver.password = undefined;

        res.status(201).json({ success: true, message: "Driver added successfully", data: driver });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// LOGIN DRIVER (Username ya Phone + fcmToken capture)
// Endpoint: POST /provider/driver/login
const loginDriver = async (req, res) => {
    try {
        const { identifier, password, fcmToken } = req.body;

        if (!identifier || !password) {
            return res.status(400).json({ success: false, message: "Username/Phone and Password are required" });
        }

        // Find by Username or Phone
        const driver = await Driver.findOne({
            $or: [
                { username: identifier.trim() },
                { phone: identifier.trim().replace(/\D/g, "").slice(-10) }
            ]
        }).select('+password');

        if (!driver || !(await bcrypt.compare(String(password), driver.password))) {
            return res.status(400).json({ success: false, message: "Invalid credentials" });
        }

        // 🚨 Block login if Driver is suspended/inactive
        if (driver.isActive === false) {
            return res.status(403).json({ 
                success: false, 
                message: "Access Denied: Your driver profile is suspended. Please contact your manager." 
            });
        }

        // Generate Token
        let token = null;
        if (process.env.NODE_ENV === 'development' && driver.token) {
            try {
                jwt.verify(driver.token, process.env.JWT_SECRET);
                token = driver.token;
            } catch (err) { token = null; }
        }

        if (!token) {
            token = generateToken(driver._id, 'driver');
            driver.token = token;
        }

        // 🚨 CRITICAL FIX: Save mobile device FCM Token for real-time order alerts
        if (fcmToken) {
            driver.fcmToken = fcmToken;
        }
        await driver.save();

        driver.password = undefined;

        res.json({ 
            success: true, 
            message: "Driver logged in successfully",
            token, 
            vendorType: driver.vendorType, 
            data: driver 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// 1. GET ALL DRIVERS (Vendor Specific + Pagination)
const getVendorDrivers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10; // Per page drivers
        const skip = (page - 1) * limit;

        const total = await Driver.countDocuments({ vendorId: req.user.id });
        const drivers = await Driver.find({ vendorId: req.user.id })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.json({
            success: true,
            total,
            page,
            pages: Math.ceil(total / limit),
            data: drivers
        });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. SEARCH DRIVERS (POST Request as requested)
const searchDrivers = async (req, res) => {
    try {
        const { query } = req.body; // Search keyword from body
        if (!query) return res.status(400).json({ message: "Search query required" });

        const drivers = await Driver.find({
            vendorId: req.user.id,
            $or: [
                { name: { $regex: query, $options: 'i' } },
                { phone: { $regex: query, $options: 'i' } },
                { username: { $regex: query, $options: 'i' } }
            ]
        });

        res.json({ success: true, count: drivers.length, data: drivers });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. GET SINGLE DRIVER DETAILS
const getDriverById = async (req, res) => {
    try {
        const driver = await Driver.findOne({ _id: req.params.id, vendorId: req.user.id });
        if (!driver) return res.status(404).json({ message: "Driver not found" });
        res.json({ success: true, data: driver });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. UPDATE DRIVER (Handle Files + Data)
const updateDriver = async (req, res) => {
    try {
        const { id } = req.params;
        const driver = await Driver.findOne({ _id: id, vendorId: req.user.id });
        if (!driver) return res.status(404).json({ message: "Driver not found" });

        const { password, ...updateData } = req.body;
        const files = req.files;

        // If password is being changed
        if (password) {
            updateData.password = await bcrypt.hash(String(password), 10);
        }

        // Handle File Updates (Profile Pic)
        if (files?.profilePic) {
            updateData.profilePic = files.profilePic[0].path;
        }

        // Handle Documents Updates
        if (files) {
            updateData.documents = {
                certificate: files.certificate ? files.certificate[0].path : driver.documents.certificate,
                license: files.license ? files.license[0].path : driver.documents.license,
                rcImage: files.rcImage ? files.rcImage[0].path : driver.documents.rcImage
            };
        }

        const updatedDriver = await Driver.findByIdAndUpdate(id, { $set: updateData }, { new: true });
        res.json({ success: true, message: "Driver updated", data: updatedDriver });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 5. DELETE DRIVER (And Clean Up Files)
const deleteDriver = async (req, res) => {
    try {
        const driver = await Driver.findOne({ _id: req.params.id, vendorId: req.user.id });
        if (!driver) return res.status(404).json({ message: "Driver not found" });

        // Delete associated files from storage
        const filesToDelete = [
            driver.profilePic,
            driver.documents.certificate,
            driver.documents.license,
            driver.documents.rcImage
        ];

        filesToDelete.forEach(file => {
            if (file && fs.existsSync(file)) fs.unlinkSync(file);
        });

        await Driver.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Driver deleted successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 6. TOGGLE STATUS (Online/Offline/Busy)
// Endpoint: PATCH /provider/driver/status/:id
const toggleDriverStatus = async (req, res) => {
    try {
        const { status } = req.body; // Available, Busy, Offline

        if (!status || !['Available', 'Busy', 'Offline'].includes(status)) {
            return res.status(400).json({ 
                success: false, 
                message: "Valid status value ('Available', 'Busy', 'Offline') is required." 
            });
        }

        // Synchronize 'isOnline' boolean state based on dynamic string status transition:
        // status is 'Offline'           => isOnline becomes false
        // status is 'Available' / 'Busy' => isOnline becomes true
        const isOnline = status !== 'Offline';

        const driver = await Driver.findOneAndUpdate(
            { _id: req.params.id, vendorId: req.user.id },
            { 
                $set: { 
                    status, 
                    isOnline: Boolean(isOnline) 
                } 
            },
            { new: true }
        );

        if (!driver) {
            return res.status(404).json({ success: false, message: "Driver profile not found." });
        }

        res.json({ 
            success: true, 
            message: `Driver status successfully updated to ${status}.`, 
            isOnline: driver.isOnline,
            status: driver.status,
            data: driver 
        });

    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};

const vendorResetDriverPassword = async (req, res) => {
    try {
        const { id } = req.params; // Driver ID
        const { newPassword } = req.body;
        const vendorId = req.user.id; // Logged in Vendor ID

        if (!newPassword) return res.status(400).json({ message: "New password is required" });

        const hashedPassword = await bcrypt.hash(String(newPassword), 10);

        // Sirf wahi vendor update kar sake jisne driver add kiya tha
        const driver = await Driver.findOneAndUpdate(
            { _id: id, vendorId: vendorId },
            { password: hashedPassword, token: null },
            { new: true }
        );

        if (!driver) {
            return res.status(404).json({ message: "Driver not found or you are not authorized" });
        }

        res.json({ success: true, message: "Driver password reset successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 7. GET DRIVER PROFILE (Logged-in Driver details)
// endpoint: GET /driver/profile
const getDriverProfile = async (req, res) => {
    try {
        // req.user.id JWT token protect('driver') middleware se decode hokar aata hai
        const driver = await Driver.findById(req.user.id).populate({
            path: 'vendorId',
            select: 'name email phone profileImage' // Jo details dynamic vendor model se read karni hain unhe select karein
        });

        if (!driver) {
            return res.status(404).json({ success: false, message: "Driver profile not found" });
        }

        res.json({ 
            success: true, 
            data: driver 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};


module.exports = { 
    registerDriver, 
    loginDriver, 
    getDriverProfile,

    getVendorDrivers, 
    searchDrivers, 
    getDriverById, 
    updateDriver, 
    deleteDriver,
    toggleDriverStatus ,
    vendorResetDriverPassword
};