const Driver = require('../../../models/Driver');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');



const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// Login Driver
const loginDriver = async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Validation check
        if (!username || !password) {
            return res.status(400).json({ message: "Username and Password are required" });
        }

        const driver = await Driver.findOne({ username }).select('+password');

        if (!driver || !(await bcrypt.compare(String(password), driver.password))) {
            return res.status(400).json({ message: "Invalid credentials" });
        }

        let token = null;

        // --- DEVELOPMENT MODE: Token Reuse ---
        if (process.env.NODE_ENV === 'development' && driver.token) {
            try {
                // Verify if token is still valid (ignoring expiry in Dev)
                jwt.verify(driver.token, process.env.JWT_SECRET);
                token = driver.token;
                console.log("Dev Mode: Reusing Driver Token");
            } catch (err) {
                token = null;
            }
        }

        // --- NEW TOKEN GENERATION ---
        if (!token) {
            token = generateToken(driver._id, 'driver');
            driver.token = token;
            await driver.save();
            console.log("New Driver Token Generated");
        }

        driver.password = undefined;
        res.json({ success: true, token, data: driver });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { loginDriver };