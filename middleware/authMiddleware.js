const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const User = require('../models/User');
const Doctor = require('../models/Doctor');
const Hospital = require('../models/Hospital');
const Provider = require('../models/Provider');
const HospitalDoctor = require('../models/HospitalDoctor'); // Naya model yahan import kiya
const Tab = require('../models/Tab'); // Tab model for global tab status check


// 1. Verify Token & Identify User Type
const protect = (modelType) => async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            let user;
            if (modelType === 'admin') {
                // Admin ke sath uska Role Template (tabIds) bhi load karo
                user = await Admin.findById(decoded.id).populate('roleType');
            } 
            else if (modelType === 'user') user = await User.findById(decoded.id);
            else if (modelType === 'doctor') user = await Doctor.findById(decoded.id);
            else if (modelType === 'hospital') user = await Hospital.findById(decoded.id);
            else if (modelType === 'provider') user = await Provider.findById(decoded.id);
            // --- Naya logic yahan add kiya gaya hai ---
            else if (modelType === 'hospital-doctor') {
                user = await HospitalDoctor.findById(decoded.id);
            }

            if (!user) return res.status(401).json({ message: 'User not found' });

            // Check if account is active (for Admin/Vendors/HospitalDoctors)
            if (user.isActive === false) {
                return res.status(403).json({ message: 'Account is deactivated' });
            }

            req.user = user; 
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
            if (req.user.role === 'superadmin') return next();

            // 1. Global Check
            const globalTab = await Tab.findOne({ tabId: Number(tabId), isActive: true });
            if (!globalTab) return res.status(403).json({ message: "...disabled by Admin" });

            // 2. Role Check
            const roleType = req.user.roleType;
            
            // --- DEBUG LOG START ---
            console.log("Admin Name:", req.user.name);
            console.log("Checking for TabId:", tabId);
            console.log("Admin's Assigned Permissions (tabIds):", roleType ? roleType.tabIds : "No Role Found");
            // --- DEBUG LOG END ---

            if (!roleType || !roleType.tabIds) {
                return res.status(403).json({ message: "Access Denied: No Role Assigned" });
            }

            // includes() check
            const hasAccess = roleType.tabIds.includes(Number(tabId));
            
            if (!hasAccess) {
                return res.status(403).json({ 
                    success: false, 
                    message: "Access Denied: You do not have permission for this module." 
                });
            }
            next();
        } catch (error) { res.status(500).json({ message: error.message }); }
    };
};

// 3. Location Filter Helper (For Controller use)
const getLocationFilter = (req) => {
    // SuperAdmin can see everything
    if (req.user.role === 'superadmin') return {};

    const access = req.user.locationAccess;
    if (!access) return {}; // Default empty filter if no location restricted

    let filter = {};
    if (access.country) filter.country = access.country;
    if (access.state) filter.state = access.state;
    if (access.city) filter.city = access.city;
    
    return filter;
};


module.exports = { protect, checkRoleAccess, getLocationFilter };