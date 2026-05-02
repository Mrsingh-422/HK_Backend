const FireHQ = require('../../models/FireHQ');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { deleteFile } = require('../../utils/fileHandler');
const FireStation = require('../../models/FireStation');
const FireStaff = require('../../models/FireStaff');

// Updated Token Generator
const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// 1. REGISTER HQ
const registerHQ = async (req, res) => {
    try {
        const { stationName, email, phone, password, captainName, state, city } = req.body;
        const exists = await FireHQ.findOne({ $or: [{ email }, { phone }] });
        if (exists) return res.status(400).json({ message: "HQ already exists" });

        const hashedPassword = await bcrypt.hash(password, 10);
        await FireHQ.create({
            stationName, captainName, email, phone, state, city,
            password: hashedPassword
        });
        res.status(201).json({ success: true, message: "HQ Registered Successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. LOGIN HQ
const loginHQ = async (req, res) => {
    try {
        const { email, password } = req.body;
        const hq = await FireHQ.findOne({ email }).select('+password');
        if (!hq || !(await bcrypt.compare(password, hq.password))) {
            return res.status(401).json({ message: "Invalid credentials" });
        }
        const token = generateToken(hq._id, 'Fire-HQ');
        hq.token = token;
        await hq.save();
        res.json({ success: true, token, data: hq });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. UPDATE HQ PROFILE (Added File Deletion Logic)
const updateHQProfile = async (req, res) => {
    try {
        const hqId = req.user.id;
        const updates = req.body;
        const currentHQ = await FireHQ.findById(hqId);
        if (!currentHQ) return res.status(404).json({ message: "HQ not found" });

        if (req.file) {
            if (currentHQ.profileImage) deleteFile(currentHQ.profileImage);
            updates.profileImage = req.file.path;
        }

        const updatedHQ = await FireHQ.findByIdAndUpdate(hqId, updates, { new: true });
        res.json({ success: true, message: "HQ Profile Updated", data: updatedHQ });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const changePassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const hq = await FireHQ.findById(req.user.id).select('+password');

        const isMatch = await bcrypt.compare(oldPassword, hq.password);
        if (!isMatch) return res.status(400).json({ message: "Old password does not match" });

        hq.password = await bcrypt.hash(newPassword, 10);
        await hq.save();

        res.json({ success: true, message: "Password updated successfully" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// const loginFireAll = async (req, res) => {
//     try {
//         const { email, password, type } = req.body; // type: 'hq', 'station', 'staff'

//         if (!email || !password || !type) {
//             return res.status(400).json({ message: "Please provide email, password and type" });
//         }

//         let user;
//         let role;

//         // 1. Identify Model based on Type
//         switch (type.toLowerCase()) {
//             case 'hq':
//                 user = await FireHQ.findOne({ email }).select('+password');
//                 role = 'fire-hq';
//                 break;
//             case 'station':
//                 user = await FireStation.findOne({ email }).select('+password');
//                 role = 'fire-station';
//                 break;
//             case 'staff':
//                 // Staff model uses 'officialEmail' as per your previous code
//                 user = await FireStaff.findOne({ officialEmail: email }).select('+password');
//                 role = 'fire-staff';
//                 break;
//             default:
//                 return res.status(400).json({ message: "Invalid login type" });
//         }

//         // 2. Validate User & Password
//         if (!user || !(await bcrypt.compare(password, user.password))) {
//             return res.status(401).json({ message: "Invalid Credentials" });
//         }

//         // 3. Check Activation Status
//         if (user.isActive === false) {
//             return res.status(403).json({ message: "Account is deactivated" });
//         }

//         // 4. Generate Token
//         const token = generateToken(user._id, role);
//         user.token = token;
//         await user.save();

//         user.password = undefined; // Security
//         res.json({
//             success: true,
//             type: type.toLowerCase(),
//             role: role,
//             token,
//             data: user
//         });

//     } catch (error) {
//         res.status(500).json({ message: error.message });
//     }
// };


const loginFireAll = async (req, res) => {
    try {
        const { email, password, type } = req.body; // 'hq', 'station', 'staff'

        if (!email || !password || !type) {
            return res.status(400).json({ success: false, message: "Email, Password and Type are required" });
        }

        let user = null;
        let role = "";
        let userTypeResponse = "";

        // 1. Logic based on Type
        switch (type.toLowerCase()) {
            case 'hq':
                user = await FireHQ.findOne({ email }).select('+password');
                role = "Fire-HQ";
                userTypeResponse = "fire-hq";
                break;

            case 'station':
                user = await FireStation.findOne({ email }).select('+password');
                role = "Fire-Station";
                userTypeResponse = "fire-station";
                break;

            case 'staff':
                // Schema use officialEmail
                user = await FireStaff.findOne({ officialEmail: email }).select('+password');
                role = "Fire-Staff";
                userTypeResponse = "fire-staff";
                break;

            default:
                return res.status(400).json({ success: false, message: "Invalid login type. Use 'hq', 'station', or 'staff'." });
        }

        // 2. Validate User
        if (!user) {
            return res.status(401).json({ success: false, message: "Invalid Credentials" });
        }

        // 3. Password Match
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: "Invalid Credentials" });
        }

        // 4. Status/Activation Check
        // Staff has 'status', HQ/Station have 'isActive'
        if (user.isActive === false || user.status === 'Inactive') {
            return res.status(403).json({ success: false, message: "Your account is deactivated" });
        }

        // 5. Token Generation
        const token = generateToken(user._id, role);
        user.token = token;
        await user.save();

        user.password = undefined;

        // 6. Final Response
        res.status(200).json({
            success: true,
            message: "Login successful",
            type: userTypeResponse,
            token: token,
            data: user
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// Forgot & Reset same rahenge (Bas token gen update ho gaya hai)
module.exports = { registerHQ, loginHQ, updateHQProfile, changePassword , loginFireAll};