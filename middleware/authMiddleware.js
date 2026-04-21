const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const User = require('../models/User');
const Doctor = require('../models/Doctor');
const Hospital = require('../models/Hospital');
const Lab = require('../models/Lab');
const Pharmacy = require('../models/Pharmacy');
const Nurse = require('../models/Nurse');
const Ambulance = require('../models/Ambulance');
const Driver = require('../models/Driver');
const Tab = require('../models/Tab'); // Tab model for global tab status check
const FireHQ = require('../models/FireHQ');
const FireStation = require('../models/FireStation');
const FireStaff = require('../models/FireStaff');


// 1. Verify Token & Identify User Type
const protect = (modelType) => async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];

            // --- Development Mode: No Expiry Check ---
            const verifyOptions = process.env.NODE_ENV === 'development' ? { ignoreExpiration: true } : {};
            const decoded = jwt.verify(token, process.env.JWT_SECRET, verifyOptions);

            let user;
            
            // Model Selection Logic based on modelType or JWT role
            switch (modelType) {
                case 'admin':
                    user = await Admin.findById(decoded.id).populate('roleType');
                    break;
                case 'user':
                    user = await User.findById(decoded.id);
                    break;
                case 'doctor':
                case 'hospital-doctor':
                    user = await Doctor.findById(decoded.id);
                    break;
                case 'hospital':
                    user = await Hospital.findById(decoded.id);
                    break;
                case 'lab':
                    user = await Lab.findById(decoded.id);
                    break;
                case 'pharmacy':
                    user = await Pharmacy.findById(decoded.id);
                    break;
                case 'nurse':
                    user = await Nurse.findById(decoded.id);
                    break;
                case 'driver':
                    user = await Driver.findById(decoded.id);
                    break;
    case 'provider':
    // Hum teeno models ko check karenge (Priority order mein)
    user = await Lab.findById(decoded.id) || 
           await Pharmacy.findById(decoded.id) || 
           await Nurse.findById(decoded.id);
    break;
                case 'ambulance':
                case 'hospital-ambulance':
                    user = await Ambulance.findById(decoded.id);
                    break;
                // fire models
                    case 'fire-hq':
                    user = await FireHQ.findById(decoded.id);
                    break;
                case 'fire-station':
                    user = await FireStation.findById(decoded.id);
                    break;
                case 'fire-staff':
                    user = await FireStaff.findById(decoded.id);
                    break;
                // police models
                case 'police-hq':
                    user = await PoliceHQ.findById(decoded.id);
                    break;
                case 'police-station':
                    user = await PoliceStation.findById(decoded.id);
                    break;
                case 'police-staff':
                    user = await PoliceStaff.findById(decoded.id);
                    break;

                default:
                    return res.status(400).json({ message: 'Invalid Model Type in Middleware' });
            }

            if (!user) return res.status(401).json({ message: 'User not found' });

            // --- Deactivation Check (Common for all) ---
            if (user.isActive === false) {
                return res.status(403).json({ message: 'Account is deactivated' });
            }

            req.user = user; 
            next();
        } catch (error) {
            console.error("Auth Error:", error.message);
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