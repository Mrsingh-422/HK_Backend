const Doctor = require('../../../models/Doctor'); // Unified Model
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Helper: Generate Token (Non-expiring for Dev)
const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// --- 1. ADD DOCTOR (By Hospital) ---
// Endpoint: POST /api/hospital/doctors/add
const addHospitalDoctor = async (req, res) => {
    try {
        const { 
            name, email, phone, password, speciality, qualification, 
            licenseNumber, councilNumber, councilName, about,
            country, state, city, address, isNormal, isEmergency 
        } = req.body;

        const exists = await Doctor.findOne({ $or: [{ email: email?.toLowerCase() }, { phone }] });
        if (exists) return res.status(400).json({ message: "Doctor already exists" });

        const hashedPassword = await bcrypt.hash(String(password || '123456'), 10);

        const doctor = await Doctor.create({
            hospitalId: req.user.id,
            name, 
            email: email?.toLowerCase(), 
            phone,
            password: hashedPassword,
            country, state, city, address,
            speciality, qualification, licenseNumber, councilNumber, councilName, about,
            role: 'hospital-doctor', // Hospital Linked Role
            profileStatus: 'Approved', // Pre-approved
            department: {
                isNormal: isNormal === 'true' || isNormal === true,
                isEmergency: isEmergency === 'true' || isEmergency === true
            },
            profileImage: req.files?.profileImage ? req.files.profileImage[0].path : null,
            documents: req.files?.certificates ? req.files.certificates.map(f => f.path) : []
        });

        res.status(201).json({ success: true, message: "Hospital Doctor Added Successfully", data: doctor });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 2. GET ALL DOCTORS OF A HOSPITAL ---
// Endpoint: GET /api/hospital/doctors/my-doctors
const getMyHospitalDoctors = async (req, res) => {
    try {
        const doctors = await Doctor.find({ hospitalId: req.user.id });
        res.json({ success: true, data: doctors });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 3. UPDATE DOCTOR DETAILS (Screenshot 3 Flow) ---
// Endpoint: PUT /api/hospital/doctors/update/:id
const updateHospitalDoctor = async (req, res) => {
    try {
        const { id } = req.params;
        const files = req.files;
        let updateData = { ...req.body };

        if (files?.profileImage) updateData.profileImage = files.profileImage[0].path;
        if (files?.certificates) updateData.documents = files.certificates.map(f => f.path);

        if (req.body.password) updateData.password = await bcrypt.hash(String(req.body.password), 10);

        // Security: hospitalId check taaki koi dusra hospital edit na kar sake
        const doctor = await Doctor.findOneAndUpdate(
            { _id: id, hospitalId: req.user.id },
            { $set: updateData },
            { new: true }
        );

        if (!doctor) return res.status(404).json({ message: "Doctor not found or unauthorized" });

        res.json({ success: true, message: "Updated successfully", data: doctor });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 4. DELETE DOCTOR ---
// Endpoint: DELETE /api/hospital/doctors/delete/:id
const deleteHospitalDoctor = async (req, res) => {
    try {
        const doctor = await Doctor.findOneAndDelete({ _id: req.params.id, hospitalId: req.user.id });
        if (!doctor) return res.status(404).json({ message: "Doctor not found or unauthorized" });
        res.json({ success: true, message: "Doctor removed from hospital" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 5. LOGIN HOSPITAL DOCTOR ---
// Endpoint: POST /api/hospital/doctors/login
const loginHospitalDoctor = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        if (!password) return res.status(400).json({ message: 'Please provide a password' });

        let query = email ? { email: email.toLowerCase() } : { phone };
        const doctor = await Doctor.findOne(query).select('+password');
        
        if (!doctor || !(await bcrypt.compare(String(password), doctor.password))) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        if (!doctor.isActive) return res.status(403).json({ message: 'Account Deactivated' });

        let token = null;
        if (process.env.NODE_ENV === 'development' && doctor.token) {
            try {
                jwt.verify(doctor.token, process.env.JWT_SECRET);
                token = doctor.token;
            } catch (err) { token = null; }
        }

        if (!token) {
            token = generateToken(doctor._id, 'hospital-doctor');
            doctor.token = token;
            await doctor.save();
        }

        doctor.password = undefined;
        res.json({ success: true, token, role: 'hospital-doctor', data: doctor });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { addHospitalDoctor, getMyHospitalDoctors, updateHospitalDoctor, deleteHospitalDoctor, loginHospitalDoctor };