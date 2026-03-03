const Hospital = require('../../models/Hospital');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sendEmailOTP = require('../../utils/emailService'); // Ensure this utility exists


// Helper: Generate Token
const generateToken = (id) => {
    return jwt.sign({ id, role: 'hospital' }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// 1. REGISTER HOSPITAL (Matches Figma)
// endpoint: POST /api/auth/hospital/register
const registerHospital = async (req, res) => {
    try {
        const { 
            name, email, phone, 
            country, state, city, 
            password, confirmPassword, 
            type // 'Charity', 'Govt', or 'Private'
        } = req.body;

        // 1. Validation
        if (!email && !phone) return res.status(400).json({ message: 'Email or Phone required' });
        if (!password) return res.status(400).json({ message: 'Password is required' });
        
        if (confirmPassword && password !== confirmPassword) {
            return res.status(400).json({ message: 'Passwords do not match' });
        }

        // 2. Duplicate Check (Dynamic: checks email OR phone)
        let query = [];
        if (email) query.push({ email });
        if (phone) query.push({ phone });

        if (query.length > 0) {
            const exists = await Hospital.findOne({ $or: query });
            if (exists) {
                return res.status(400).json({ message: 'Hospital already exists with this Email or Phone' });
            }
        }

        // 3. Hash Password
        const hashedPassword = await bcrypt.hash(password, 10);

        // 4. Create Hospital
        const newHospital = await Hospital.create({
            name,
            email: email || undefined,
            phone: phone || undefined,
            country,
            state,
            city,
            type, // Default to Private if empty
            password: hashedPassword,
            profileStatus: 'Incomplete' // Admin needs to approve
        });

        // 5. Generate Token (Optional: Depends if you want them logged in immediately)
        const token = generateToken(newHospital._id);
        newHospital.token = token;
        await newHospital.save();

        res.status(201).json({ 
            success: true, 
            message: 'Hospital Registered. Please upload documents.',
            token,
            data: newHospital 
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. LOGIN HOSPITAL
// endpoint: POST /api/auth/hospital/login
const loginHospital = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        
        // Dynamic Query
        let query = {};
        if (email) query = { email };
        else if (phone) query = { phone };
        else return res.status(400).json({ message: 'Provide Email or Phone' });

        const hospital = await Hospital.findOne(query).select('+password');
        
        if (!hospital || !(await bcrypt.compare(password, hospital.password))) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        // Check Status
        // if (hospital.profileStatus === 'Rejected') {
        //     return res.status(403).json({ message: `Application Rejected: ${hospital.rejectionReason}` });
        // }

        let token = null;

        // --- DEVELOPMENT MODE: Reuse Token ---
        if (process.env.NODE_ENV === 'development' && hospital.token) {
            try {
                jwt.verify(hospital.token, process.env.JWT_SECRET);
                token = hospital.token;
            } catch (err) { token = null; }
        }

        // --- NEW TOKEN ---
        if (!token) {
            token = generateToken(hospital._id);
            hospital.token = token;
            await hospital.save();
        }

        // 👇 YAHAN CHANGE KIYA HAI: Password ko undefined set karein taki wo response me na jaye
        hospital.password = undefined;

        res.json({ success: true, token, role: 'hospital', data: hospital });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


// 4. UPDATE PROFILE & DOCUMENTS
const updateHospitalProfile = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const updates = req.body; // Text fields (name, address, etc.)

        // --- Handle File Uploads ---
        if (req.files) {
            
            // 1. Hospital Images
            if (req.files.hospitalImage) {
                const imgPaths = req.files.hospitalImage.map(file => `/uploads/hospitals/${file.filename}`);
                updates.hospitalImage = imgPaths; 
            }

            // 2. License Documents
            if (req.files.licenseDocument) {
                const licensePaths = req.files.licenseDocument.map(file => `/uploads/hospitals/${file.filename}`);
                updates.licenseDocument = licensePaths;
            }

            // 3. Other Documents
            if (req.files.otherDocuments) {
                const otherPaths = req.files.otherDocuments.map(file => `/uploads/hospitals/${file.filename}`);
                updates.otherDocuments = otherPaths;
            }

            // ============================================================
            // --- 🚀 NEW LOGIC: AUTO CHANGE STATUS TO PENDING ---
            // ============================================================
            // Check karein agar Hospital Image AND License Document dono upload huye hain
            const hasImage = req.files.hospitalImage && req.files.hospitalImage.length > 0;
            const hasLicense = req.files.licenseDocument && req.files.licenseDocument.length > 0;

            if (hasImage && hasLicense) {
                updates.profileStatus = 'Pending';
                
                // Optional: Agar rejection reason tha to use clear kar dein
                updates.rejectionReason = null; 
                
                console.log(`Hospital ${hospitalId}: Documents uploaded. Status updated to Pending.`);
            }
            // ============================================================
        }

        // --- Validate Unique Email/Phone (Existing Logic) ---
        if (updates.email) {
            const exists = await Hospital.findOne({ email: updates.email });
            if (exists && exists._id.toString() !== hospitalId) {
                return res.status(400).json({ message: 'Email already taken' });
            }
        }
        if (updates.phone) {
            const exists = await Hospital.findOne({ phone: updates.phone });
            if (exists && exists._id.toString() !== hospitalId) {
                return res.status(400).json({ message: 'Phone already taken' });
            }
        }

        // --- Final DB Update ---
        const updatedHospital = await Hospital.findByIdAndUpdate(
            hospitalId,
            { $set: updates }, // $set ensures baaki fields delete na ho
            { new: true }
        );

        res.json({ 
            success: true, 
            message: "Profile & Documents Updated", 
            data: updatedHospital 
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    registerHospital, 
    loginHospital,
    updateHospitalProfile 
};