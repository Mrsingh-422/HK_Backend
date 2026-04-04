const Driver = require('../../../models/Driver');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// 1. REGISTER DRIVER (By Vendor)
// endpoint: POST /api/provider/driver/add
const registerDriver = async (req, res) => {
    try {
        const vendorId = req.user.id; 
        const vendorType = req.user.role; // Lab, Pharmacy, ya Nurse

        const { name, phone, password, username, ...details } = req.body;
        const files = req.files;

        // Duplicate Check
        const exists = await Driver.findOne({ username });
        if (exists) return res.status(400).json({ message: "Username already taken" });

        const hashedPassword = await bcrypt.hash(String(password), 10);

        const driver = await Driver.create({
            vendorId,
            vendorType,
            name, phone,
            password: hashedPassword,
            username,
            ...details,
            // Multer files mapping
            profilePic: files?.profilePic ? files.profilePic[0].path : null,
            documents: {
                certificate: files?.certificate ? files.certificate[0].path : null,
                license: files?.license ? files.license[0].path : null,
                rcImage: files?.rcImage ? files.rcImage[0].path : null
            }
        });

        res.status(201).json({ success: true, message: "Driver added successfully", data: driver });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. LOGIN DRIVER
// endpoint: POST /api/provider/driver/login
const loginDriver = async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ message: "Username and Password required" });

        const driver = await Driver.findOne({ username }).select('+password');
        if (!driver || !(await bcrypt.compare(String(password), driver.password))) {
            return res.status(400).json({ message: "Invalid credentials" });
        }

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
            await driver.save();
        }

        driver.password = undefined;
        res.json({ success: true, token, data: driver });
    } catch (error) { res.status(500).json({ message: error.message }); }
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
const toggleDriverStatus = async (req, res) => {
    try {
        const { status } = req.body; // Available, Busy, Offline
        const driver = await Driver.findOneAndUpdate(
            { _id: req.params.id, vendorId: req.user.id },
            { status },
            { new: true }
        );
        if (!driver) return res.status(404).json({ message: "Driver not found" });
        res.json({ success: true, message: `Status updated to ${status}`, data: driver });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { 
    registerDriver, 
    loginDriver, 
    getVendorDrivers, 
    searchDrivers, 
    getDriverById, 
    updateDriver, 
    deleteDriver,
    toggleDriverStatus 
};