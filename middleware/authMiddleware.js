const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const User = require('../models/User');
const Doctor = require('../models/Doctor');
const Hospital = require('../models/Hospital');
const Provider = require('../models/Provider');

// 1. Verify Token & Identify User Type
const protect = (modelType) => async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // Model Type ke hisab se user dhundo
            let user;
            if (modelType === 'admin') user = await Admin.findById(decoded.id);
            else if (modelType === 'user') user = await User.findById(decoded.id);
            else if (modelType === 'doctor') user = await Doctor.findById(decoded.id);
            else if (modelType === 'hospital') user = await Hospital.findById(decoded.id);
            else if (modelType === 'provider') user = await Provider.findById(decoded.id);

            if (!user) return res.status(401).json({ message: 'User not found' });

            req.user = user; // Attach user to request
            next();
        } catch (error) {
            res.status(401).json({ message: 'Not authorized, invalid token' });
        }
    } else {
        res.status(401).json({ message: 'Not authorized, no token' });
    }
};

// 2. PHP Style Tab ID Check (SQL IDs like 1, 28, 31...)
const checkRoleAccess = (tabId) => {
    return async (req, res, next) => {
        try {
            // SuperAdmin को सब एक्सेस है
            if (req.user.role === 'superadmin') return next();

            // Admin को populate करके 'roleType' निकालें
            const admin = await Admin.findById(req.user._id).populate('roleType');
            
            if (!admin.roleType || !admin.roleType.role_ids.includes(tabId)) {
                return res.status(403).json({ 
                    message: `Access Denied: You don't have permission for Tab ID ${tabId}` 
                });
            }

            next();
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    };
};

// 3. Location Filter Helper (For Controller use)
const getLocationFilter = (req) => {
    if (req.user.role === 'superadmin') return {};

    const { country, state, city } = req.user.locationAccess;
    let filter = {};
    if (country) filter.country = country;
    if (state) filter.state = state;
    if (city) filter.city = city;
    
    return filter;
};

module.exports = { protect, checkRoleAccess, getLocationFilter };