const Doctor = require('../../../models/Doctor'); // Unified Model
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
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

        // 🚀 SYNC FIX: Standard web-accessible URL paths instead of OS raw file.path
        const profileImagePath = req.files?.profileImage 
            ? `/uploads/doctors/${req.files.profileImage[0].filename}` 
            : null;

        const certificatePaths = req.files?.certificates 
            ? req.files.certificates.map(f => `/uploads/doctors/${f.filename}`) 
            : [];

        const doctor = await Doctor.create({
            hospitalId: req.user.id,
            name, 
            email: email?.toLowerCase(), 
            phone,
            password: hashedPassword,
            country, state, city, address,
            speciality, qualification, licenseNumber, councilNumber, councilName, about,
            role: 'hospital-doctor',
            profileStatus: 'Approved',
            department: {
                isNormal: isNormal === 'true' || isNormal === true,
                isEmergency: isEmergency === 'true' || isEmergency === true
            },
            profileImage: profileImagePath,
            documents: certificatePaths
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

      const { email, password } = req.body;

      // CHECK INPUTS
      if (!email || !password) {
         return res.status(400).json({
            success:false,
            message:"Email and password required"
         });
      }

      // FIND DOCTOR
      const doctor = await Doctor
         .findOne({ email })
         .select("+password");

      // DOCTOR EXISTS?
      if (!doctor) {
         return res.status(404).json({
            success:false,
            message:"Doctor not found"
         });
      }

      // ONLY HOSPITAL DOCTOR ALLOWED
      if (doctor.role !== "hospital-doctor") {
         return res.status(403).json({
            success:false,
            message:"Only hospital doctors can login"
         });
      }

      // ACCOUNT ACTIVE?
      if (!doctor.isActive) {
         return res.status(403).json({
            success:false,
            message:"Account deactivated"
         });
      }

      // PASSWORD MATCH
      const isMatch = await bcrypt.compare(
         password,
         doctor.password
      );

      if (!isMatch) {
         return res.status(401).json({
            success:false,
            message:"Invalid password"
         });
      }

      // TOKEN
      const token = jwt.sign(
         {
            id: doctor._id,
            role: doctor.role
         },
         process.env.JWT_SECRET,
         {
            expiresIn: "7d"
         }
      );

      // SUCCESS
      res.status(200).json({
         success:true,
         message:"Login successful",
         token,
         doctor
      });

   } catch (error) {

      res.status(500).json({
         success:false,
         message:error.message
      });

   }

};

// @desc    Hospital Admin Sets Doctor's OPD Cabin Room, Slot Duration & Schedule (Safe Self-Healing)
// @route   PUT /api/hospital/doctors/configure-opd/:doctorId
// @access  Private (Hospital Admin)
const configureDoctorOpdScheduleByHospital = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { doctorId } = req.params;
        const { roomNumber, slotDuration, opdFee, availability, isOpdEnabled } = req.body;

        const doctor = await Doctor.findOne({ _id: doctorId, hospitalId }).lean();
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found in this hospital." });
        }

        const safeObjectParse = (val, defaultVal = {}) => {
            if (!val) return defaultVal;
            if (typeof val === 'object' && val !== null) return val;
            if (typeof val === 'string') {
                try {
                    const parsed = JSON.parse(val);
                    if (typeof parsed === 'object' && parsed !== null) return parsed;
                } catch (e) {}
            }
            return defaultVal;
        };

        let currentConsultation = safeObjectParse(doctor.consultationStatus, { online: true, clinic: true, home: true });
        if (isOpdEnabled !== undefined) {
            currentConsultation.clinic = (isOpdEnabled === true || isOpdEnabled === 'true');
        }

        let currentFees = safeObjectParse(doctor.fees, { online: 0, clinic: 500, home: 0 });
        if (opdFee !== undefined) {
            currentFees.clinic = Math.max(0, parseInt(opdFee) || 0);
        }

        let currentDepartment = safeObjectParse(doctor.department, { isNormal: true, isEmergency: false, roomNumber: "Cabin 1" });
        if (roomNumber !== undefined) {
            currentDepartment.roomNumber = String(roomNumber).trim();
        }

        const updatePayload = {
            consultationStatus: currentConsultation,
            fees: currentFees,
            department: currentDepartment
        };

        if (slotDuration !== undefined) {
            updatePayload.slotDuration = Math.max(5, parseInt(slotDuration) || 15);
        }

        if (availability !== undefined) {
            updatePayload.availability = Array.isArray(availability)
                ? availability
                : (typeof availability === 'string' ? safeObjectParse(availability, []) : []);
        }

        // Direct Native MongoDB Update to overwrite any corrupted string in database
        await Doctor.collection.updateOne(
            { _id: new mongoose.Types.ObjectId(doctorId) },
            { $set: updatePayload }
        );

        const updatedDoctor = await Doctor.findById(doctorId)
            .select('name speciality fees department slotDuration availability consultationStatus')
            .lean();

        res.status(200).json({
            success: true,
            message: `OPD Configuration saved for Dr. ${updatedDoctor.name}.`,
            data: updatedDoctor
        });

    } catch (error) {
        console.error("Configure Doctor OPD Schedule Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


module.exports = { addHospitalDoctor, getMyHospitalDoctors, updateHospitalDoctor, deleteHospitalDoctor, loginHospitalDoctor,
    configureDoctorOpdScheduleByHospital
 };