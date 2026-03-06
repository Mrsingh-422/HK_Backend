const HospitalDoctor = require('../../../models/HospitalDoctor');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken'); // Yeh line add karein


// 1. ADD DOCTOR (By Hospital)
const addHospitalDoctor = async (req, res) => {
    try {
        const { 
            name, email, phone, password, 
            country, state, city, address,
            speciality, qualification, licenseNumber, councilNumber, councilName, about,
            isNormal, isEmergency 
        } = req.body;

        const files = req.files;

        // Duplicate Check
        let checkQuery = [];
        if (email) checkQuery.push({ email: email.toLowerCase().trim() });
        if (phone) checkQuery.push({ phone: phone.trim() });

        if (checkQuery.length > 0) {
            const exists = await HospitalDoctor.findOne({ $or: checkQuery });
            if (exists) return res.status(400).json({ message: "Email/Phone already exists" });
        }

        const hashedPassword = await bcrypt.hash(String(password || '123456'), 10);

        const doctor = await HospitalDoctor.create({
            hospitalId: req.user.id,
            name,
            email: email ? email.toLowerCase().trim() : undefined,
            phone: phone ? phone.trim() : undefined,
            password: hashedPassword,
            country, state, city, address,
            speciality, qualification, licenseNumber, 
            councilNumber, 
            councilName, // 👈 Naya Field add kiya
            about,
            department: {
                isNormal: isNormal === 'true' || isNormal === true,
                isEmergency: isEmergency === 'true' || isEmergency === true
            },
            profileImage: files?.profileImage ? files.profileImage[0].path : null,
            documents: files?.certificates ? files.certificates.map(f => f.path) : []
        });

        res.status(201).json({ success: true, message: "Doctor Added", data: doctor });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 2. GET ALL DOCTORS OF A HOSPITAL
const getMyHospitalDoctors = async (req, res) => {
    try {
        const doctors = await HospitalDoctor.find({ hospitalId: req.user.id });
        res.json({ success: true, data: doctors });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 3. UPDATE DOCTOR DETAILS (Screenshot 3 Flow)
const updateHospitalDoctor = async (req, res) => {
    try {
        const { id } = req.params;
        const files = req.files;
        let updateData = { ...req.body };

        if (files?.profileImage) updateData.profileImage = files.profileImage[0].path;
        if (files?.certificates) updateData.documents = files.certificates.map(f => f.path);

        if (req.body.password) updateData.password = await bcrypt.hash(req.body.password, 10);

        const doctor = await HospitalDoctor.findOneAndUpdate(
            { _id: id, hospitalId: req.user.id },
            updateData,
            { new: true }
        );

        res.json({ success: true, data: doctor });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// 4. DELETE DOCTOR
const deleteHospitalDoctor = async (req, res) => {
    try {
        const doctor = await HospitalDoctor.findOneAndDelete({ _id: req.params.id, hospitalId: req.user.id });
        if (!doctor) return res.status(404).json({ message: "Doctor not found" });
        res.json({ success: true, message: "Doctor removed from hospital" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- LOGIN HOSPITAL DOCTOR ---
const loginHospitalDoctor = async (req, res) => {
    try {
        const { email, phone, password } = req.body;

        // Validation: Check karein password bheja gaya hai ya nahi
        if (!password) {
            return res.status(400).json({ message: 'Please provide a password' });
        }

        let query = email ? { email } : { phone };
        if (!email && !phone) return res.status(400).json({ message: 'Provide Email or Phone' });

        // Password fetch karein
        const doctor = await HospitalDoctor.findOne(query).select('+password');
        
        // Agar doctor nahi mila
        if (!doctor) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        // bcrypt.compare() check
        const isMatch = await bcrypt.compare(String(password), doctor.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        if (!doctor.isActive) return res.status(403).json({ message: 'Account Deactivated' });

        let token = null;

        // Logic for token
        if (process.env.NODE_ENV === 'development' && doctor.token) {
            try {
                jwt.verify(doctor.token, process.env.JWT_SECRET);
                token = doctor.token;
            } catch (err) { token = null; }
        }

        if (!token) {
            token = jwt.sign(
                { id: doctor._id, role: 'hospital-doctor' }, 
                process.env.JWT_SECRET, 
                { expiresIn: '30d' }
            );
            doctor.token = token;
            await doctor.save();
        }

        doctor.password = undefined;
        res.json({ success: true, token, role: 'hospital-doctor', data: doctor });

    } catch (error) {
        console.error(error); // Debugging ke liye
        res.status(500).json({ message: error.message });
    }
};


module.exports = { addHospitalDoctor, getMyHospitalDoctors, updateHospitalDoctor, deleteHospitalDoctor, loginHospitalDoctor };