const Driver = require('../../../models/Driver');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Register Driver
// 
const registerDriver = async (req, res) => {
    try {
        const vendorId = req.user.id; 
        const vendorType = req.user.role; // e.g., 'Lab', 'Pharmacy', 'Nurse'

        const { name, phone, password, username, ...details } = req.body;
        const files = req.files;

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


module.exports = { registerDriver };