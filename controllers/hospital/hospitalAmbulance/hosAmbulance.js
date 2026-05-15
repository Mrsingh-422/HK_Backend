const Ambulance = require('../../../models/Ambulance'); 
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Helper: Generate Token
const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// --- 1. ADD AMBULANCE (By Hospital Admin with Full Documents) ---
// Endpoint: POST /api/hospital/ambulance/add
// --- 1. ADD AMBULANCE (Figma Aligned) ---
const addHospitalAmbulance = async (req, res) => {
    try {
        const { 
            name, email, phone, password, address, ambulanceNumber, vehicleType,
            fixedPrice, distance, perKMPrice, 
            accidentalService, emergencyService, referralService, 
            defaultService, optionalService,
            fullName, department, dob,
            // 👇 Supporting Staff Fields
            hasNurse, nursePrice, 
            hasDoctor, doctorPrice 
        } = req.body;

        if (!password) return res.status(400).json({ message: "Password is required" });
        const hashedPassword = await bcrypt.hash(String(password), 10);

        const files = req.files || {};
        const getPath = (key) => (files[key] ? `/uploads/ambulances/${files[key][0].filename}` : null);

        const newAmbulance = await Ambulance.create({
            hospitalId: req.user.id,
            name: fullName, 
            email: email, 
            phone: phone,
            password: hashedPassword,
            address: address,
            ambulanceNumber: ambulanceNumber,
            vehicleType: vehicleType,
            role: 'hospital-ambulance',
            profileStatus: 'Approved', // Hospital's own ambulance is usually pre-approved
            
            pricing: {
                fixedPrice: Number(fixedPrice || 0),
                baseDistance: Number(distance || 0),
                pricePerKM: Number(perKMPrice || 0)
            },

            // 👇 New Support Staff Logic
            supportStaff: {
                nurse: { 
                    available: hasNurse === 'true' || hasNurse === true, 
                    price: Number(nursePrice || 0) 
                },
                doctor: { 
                    available: hasDoctor === 'true' || hasDoctor === true, 
                    price: Number(doctorPrice || 0) 
                }
            },
            
            freeServices: {
                accidental: accidentalService === 'true' || accidentalService === true,
                emergency: emergencyService === 'true' || emergencyService === true,
                referral: referralService === 'true' || referralService === true
            },
            
            defaultService: defaultService,
            optionalServices: optionalService ? JSON.parse(optionalService) : [],
            
            driverInfo: {
                fullName: fullName,
                department: department,
                dob: dob
            },
            
            documents: {
                rcFile: getPath('rcFile'),
                drivingLicenseFile: getPath('drivingLicenseFile'),
                insuranceFile: getPath('insuranceFile'),
                fitnessCertificate: getPath('fitnessCertificate'),
                ambulancePermit: getPath('ambulancePermit')
            }
        });

        res.status(201).json({ success: true, data: newAmbulance });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 2. GET ALL AMBULANCES ---
const getMyHospitalAmbulances = async (req, res) => {
    try {
        const ambulances = await Ambulance.find({ hospitalId: req.user.id });
        res.json({ success: true, data: ambulances });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 3. UPDATE AMBULANCE (Figma Aligned) ---
const updateHospitalAmbulance = async (req, res) => {
    try {
        const { id } = req.params;
        const { optionalService, accidentalService, emergencyService, referralService, ...otherData } = req.body;
        
        const files = req.files || {};
        let updateData = { ...otherData };

        // Handle Toggles
        if (accidentalService !== undefined) updateData['freeServices.accidental'] = accidentalService === 'true';
        if (emergencyService !== undefined) updateData['freeServices.emergency'] = emergencyService === 'true';
        if (referralService !== undefined) updateData['freeServices.referral'] = referralService === 'true';

        // Handle Optional Services Array
        if (optionalService) updateData.optionalServices = JSON.parse(optionalService);

        // Handle File Updates
        if (files.rcFile) updateData['documents.rcFile'] = `/uploads/ambulances/${files.rcFile[0].filename}`;
        if (files.drivingLicenseFile) updateData['documents.drivingLicenseFile'] = `/uploads/ambulances/${files.drivingLicenseFile[0].filename}`;

        const ambulance = await Ambulance.findOneAndUpdate(
            { _id: id, hospitalId: req.user.id },
            { $set: updateData },
            { new: true }
        );

        if (!ambulance) return res.status(404).json({ message: "Ambulance not found" });
        res.json({ success: true, message: "Updated successfully", data: ambulance });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// --- 4. DELETE AMBULANCE ---
const deleteHospitalAmbulance = async (req, res) => {
    try {
        const ambulance = await Ambulance.findOneAndDelete({ _id: req.params.id, hospitalId: req.user.id });
        if (!ambulance) return res.status(404).json({ message: "Not found" });
        res.json({ success: true, message: "Ambulance removed" });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// --- 5. LOGIN HOSPITAL AMBULANCE ---
const loginHospitalAmbulance = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        let query = email ? { email: email.toLowerCase() } : { phone };

        const ambulance = await Ambulance.findOne(query).select('+password');
        if (!ambulance || !(await bcrypt.compare(String(password), ambulance.password))) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        if (!ambulance.isActive) return res.status(403).json({ message: 'Account Deactivated' });

        let token = (process.env.NODE_ENV === 'development') ? ambulance.token : null;
        if (!token) {
            token = generateToken(ambulance._id, ambulance.role);
            ambulance.token = token;
            await ambulance.save();
        }

        ambulance.password = undefined;
        res.json({ success: true, token, role: ambulance.role, data: ambulance });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { 
    addHospitalAmbulance, 
    getMyHospitalAmbulances, 
    updateHospitalAmbulance, 
    deleteHospitalAmbulance, 
    loginHospitalAmbulance 
};