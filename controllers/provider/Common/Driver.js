const Driver = require('../../../models/Driver');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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

module.exports = { registerDriver, loginDriver };