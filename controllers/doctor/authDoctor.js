const Doctor = require('../../models/Doctor');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// --- 1. REGISTER DOCTOR ---
const registerDoctor = async (req, res) => {
    try {
        const { 
            email, phone, password, 
            name, address, qualification, speciality, licenseNumber, councilNumber 
        } = req.body;

        // 1. Validation: Kam se kam ek cheez honi chahiye
        if (!email && !phone) return res.status(400).json({ message: 'Email or Phone required' });

        // 2. Dynamic Duplicate Check (Jo field bheja hai sirf wahi check karo)
        let query = [];
        if (email) query.push({ email });
        if (phone) query.push({ phone });

        if (query.length > 0) {
            const exists = await Doctor.findOne({ $or: query });
            if (exists) {
                return res.status(400).json({ message: 'Doctor with this Email or Phone already exists' });
            }
        }

        // 3. Create Doctor
        const hashedPassword = await bcrypt.hash(password, 10);

        await Doctor.create({
            email: email || undefined, // Agar khali hai to undefined bhejo (Sparse ke liye zaroori)
            phone: phone || undefined,
            password: hashedPassword,
            name, address, qualification, speciality, licenseNumber, councilNumber,
            profileStatus: 'Pending'
        });

        res.status(201).json({ success: true, message: 'Doctor Registered. Waiting for Approval.' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 2. LOGIN DOCTOR ---
const loginDoctor = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        
        let query = {};
        if (email) query = { email };
        else if (phone) query = { phone };
        else return res.status(400).json({ message: 'Provide Email or Phone' });

        const doctor = await Doctor.findOne(query).select('+password');
        if (!doctor || !(await bcrypt.compare(password, doctor.password))) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        if (doctor.profileStatus === 'Pending') return res.status(403).json({ message: 'Pending Approval' });
        if (doctor.profileStatus === 'Rejected') return res.status(403).json({ message: 'Application Rejected' });

        let token = null;

        // --- DEVELOPMENT MODE: Token Reuse ---
        if (process.env.NODE_ENV === 'development') {
            if (doctor.token) {
                try {
                    jwt.verify(doctor.token, process.env.JWT_SECRET);
                    token = doctor.token;
                    console.log("Dev Mode: Reusing Doctor Token");
                } catch (err) {
                    token = null;
                }
            }
        }

        // --- NEW TOKEN GENERATION ---
        if (!token) {
            token = jwt.sign({ id: doctor._id, role: 'doctor' }, process.env.JWT_SECRET, { expiresIn: '30d' });
            doctor.token = token;
            await doctor.save();
            console.log("New Doctor Token Generated");
        }
        doctor.password = undefined; // Password ko response se hata do
        
        res.json({ success: true, token, role: 'doctor', data: doctor });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 3. UPDATE PROFILE (Isse wo baad mein Phone add kar payega) ---
const updateDoctorProfile = async (req, res) => {
    try {
        const doctorId = req.user.id; // Middleware se aayega
        const { email, phone, address, qualification } = req.body;

        // Agar Email update kar raha hai, to check karo kisi aur ka to nahi
        if (email) {
            const emailExists = await Doctor.findOne({ email });
            if (emailExists && emailExists._id.toString() !== doctorId) {
                return res.status(400).json({ message: 'Email already used by another doctor' });
            }
        }

        // Agar Phone update kar raha hai
        if (phone) {
            const phoneExists = await Doctor.findOne({ phone });
            if (phoneExists && phoneExists._id.toString() !== doctorId) {
                return res.status(400).json({ message: 'Phone already used by another doctor' });
            }
        }

        // Update Fields
        const updatedDoctor = await Doctor.findByIdAndUpdate(
            doctorId,
            {
                ...(email && { email }),
                ...(phone && { phone }),
                ...(address && { address }),
                ...(qualification && { qualification })
            },
            { new: true } // Return new updated data
        );

        res.json({ success: true, message: "Profile Updated", data: updatedDoctor });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { registerDoctor, loginDoctor, updateDoctorProfile };