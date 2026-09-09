const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Doctor = require('../models/Doctor');
const Hospital = require('../models/Hospital');
const Lab = require('../models/Lab');
const Pharmacy = require('../models/Pharmacy');
const Nurse = require('../models/Nurse');
const Ambulance = require('../models/Ambulance');
const Driver = require('../models/Driver');
// 🚒 Fire Models
const FireHQ = require('../models/FireHQ');
const FireStation = require('../models/FireStation');
const FireStaff = require('../models/FireStaff');
// 🚓 Police Models
const PoliceHQ = require('../models/PoliceHQ');
const PoliceStation = require('../models/PoliceStation');
const PoliceStaff = require('../models/PoliceStaff');

const protectIssueReporter = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];

            const verifyOptions = process.env.NODE_ENV === 'development' ? { ignoreExpiration: true } : {};
            const decoded = jwt.verify(token, process.env.JWT_SECRET, verifyOptions);

            const entityId = decoded.id || decoded._id;
            if (!entityId) {
                return res.status(401).json({ message: "Invalid token: missing ID" });
            }

            let matchedEntity = null;
            let matchedModelName = 'User';

            // =========================================================================
            // 🎯 STEP 1: JWT Token ke 'role' se pehle direct match karein
            // =========================================================================
            const tokenRole = decoded.role ? String(decoded.role).toLowerCase() : null;

            if (tokenRole === 'lab') {
                matchedEntity = await Lab.findById(entityId);
                if (matchedEntity) matchedModelName = 'Lab';
            } else if (tokenRole === 'provider') {
                // Provider role me pehle Lab check karo, fir Pharmacy, fir Nurse
                matchedEntity = await Lab.findById(entityId);
                if (matchedEntity) {
                    matchedModelName = 'Lab';
                } else {
                    matchedEntity = await Pharmacy.findById(entityId);
                    if (matchedEntity) matchedModelName = 'Pharmacy';
                    else {
                        matchedEntity = await Nurse.findById(entityId);
                        if (matchedEntity) matchedModelName = 'Nurse';
                    }
                }
            } else if (tokenRole === 'doctor' || tokenRole === 'hospital-doctor') {
                matchedEntity = await Doctor.findById(entityId);
                if (matchedEntity) matchedModelName = 'Doctor';
            } else if (tokenRole === 'hospital') {
                matchedEntity = await Hospital.findById(entityId);
                if (matchedEntity) matchedModelName = 'Hospital';
            } else if (tokenRole === 'ambulance' || tokenRole === 'hospital-ambulance') {
                matchedEntity = await Ambulance.findById(entityId);
                if (matchedEntity) matchedModelName = 'Ambulance';
            } else if (tokenRole === 'driver') {
                matchedEntity = await Driver.findById(entityId);
                if (matchedEntity) matchedModelName = 'Driver';
            } else if (tokenRole === 'fire-hq') {
                matchedEntity = await FireHQ.findById(entityId);
                if (matchedEntity) matchedModelName = 'FireHQ';
            } else if (tokenRole === 'fire-station') {
                matchedEntity = await FireStation.findById(entityId);
                if (matchedEntity) matchedModelName = 'FireStation';
            } else if (tokenRole === 'fire-staff') {
                matchedEntity = await FireStaff.findById(entityId);
                if (matchedEntity) matchedModelName = 'FireStaff';
            } else if (tokenRole === 'police-hq') {
                matchedEntity = await PoliceHQ.findById(entityId);
                if (matchedEntity) matchedModelName = 'PoliceHQ';
            } else if (tokenRole === 'police-station') {
                matchedEntity = await PoliceStation.findById(entityId);
                if (matchedEntity) matchedModelName = 'PoliceStation';
            } else if (tokenRole === 'police-staff') {
                matchedEntity = await PoliceStaff.findById(entityId);
                if (matchedEntity) matchedModelName = 'PoliceStaff';
            } else if (tokenRole === 'user') {
                matchedEntity = await User.findById(entityId);
                if (matchedEntity) matchedModelName = 'User';
            }

            // =========================================================================
            // 🎯 STEP 2: Fallback agar role specify nahi tha token me
            // =========================================================================
            if (!matchedEntity) {
                const fallbackModels = [
                    { name: 'Lab', model: Lab },
                    { name: 'Pharmacy', model: Pharmacy },
                    { name: 'Nurse', model: Nurse },
                    { name: 'Doctor', model: Doctor },
                    { name: 'Hospital', model: Hospital },
                    { name: 'Ambulance', model: Ambulance },
                    { name: 'Driver', model: Driver },
                    { name: 'FireHQ', model: FireHQ },
                    { name: 'FireStation', model: FireStation },
                    { name: 'FireStaff', model: FireStaff },
                    { name: 'PoliceHQ', model: PoliceHQ },
                    { name: 'PoliceStation', model: PoliceStation },
                    { name: 'PoliceStaff', model: PoliceStaff },
                    { name: 'User', model: User }
                ];

                for (const item of fallbackModels) {
                    const entity = await item.model.findById(entityId);
                    if (entity) {
                        matchedEntity = entity;
                        matchedModelName = item.name;
                        break;
                    }
                }
            }

            if (!matchedEntity) {
                return res.status(401).json({ message: "Account not found for this token" });
            }

            if (matchedEntity.isActive === false) {
                return res.status(403).json({ message: "Account is deactivated" });
            }

            // 🖨️ Debug print in backend terminal
            console.log(`\n🔍 [ISSUE REPORTER MATCHED] -> ID: ${entityId} | Detected Model: [${matchedModelName}] | Name: "${matchedEntity.name || 'N/A'}"\n`);

            req.user = matchedEntity;
            req.reporterModel = matchedModelName;
            next();
        } catch (error) {
            console.error("Issue Auth Error:", error.message);
            return res.status(401).json({ message: "Not authorized, invalid token" });
        }
    } else {
        return res.status(401).json({ message: "Not authorized, no token provided" });
    }
};

module.exports = { protectIssueReporter };