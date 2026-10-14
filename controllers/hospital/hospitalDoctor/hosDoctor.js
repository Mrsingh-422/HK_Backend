const Doctor = require('../../../models/Doctor'); // Unified Model
const Availability = require('../../../models/Availability');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
// Helper: Generate Token (Non-expiring for Dev)
const generateToken = (id, role) => {
    const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '30d';
    return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: expiry });
};

// @desc    Hospital Admin Adds New Doctor (With OPD Room Number, Fee & Slot Duration in Single Step)
// @route   POST /api/hospital/doctors/add
// @access  Private (Hospital Admin)
const addHospitalDoctor = async (req, res) => {
    try {
        const { 
            name, email, phone, password, speciality, qualification, 
            licenseNumber, councilNumber, councilName, about,
            country, state, city, address, isNormal, isEmergency,
            roomNumber, opdFee, clinicFee, slotDuration // 👈 OPD specific parameters integrated
        } = req.body;

        const exists = await Doctor.findOne({ $or: [{ email: email?.toLowerCase() }, { phone }] });
        if (exists) return res.status(400).json({ message: "Doctor already exists with this email or phone number." });

        const hashedPassword = await bcrypt.hash(String(password || '123456'), 10);

        const profileImagePath = req.files?.profileImage 
            ? `/uploads/doctors/${req.files.profileImage[0].filename}` 
            : null;

        const certificatePaths = req.files?.certificates 
            ? req.files.certificates.map(f => `/uploads/doctors/${f.filename}`) 
            : [];

        const finalOpdFee = Math.max(0, parseInt(opdFee || clinicFee || 500));
        const finalSlotDuration = Math.max(5, parseInt(slotDuration || 15));

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
            fees: {
                clinic: finalOpdFee,
                online: 0,
                home: 0
            },
            consultationStatus: {
                clinic: true,
                online: false,
                home: false
            },
            slotDuration: finalSlotDuration,
            department: {
                isNormal: isNormal === 'true' || isNormal === true,
                isEmergency: isEmergency === 'true' || isEmergency === true,
                roomNumber: roomNumber ? String(roomNumber).trim() : "Cabin 1"
            },
            availability: [
                { day: "Mon", startTime: "09:00", endTime: "17:00" },
                { day: "Tue", startTime: "09:00", endTime: "17:00" },
                { day: "Wed", startTime: "09:00", endTime: "17:00" },
                { day: "Thu", startTime: "09:00", endTime: "17:00" },
                { day: "Fri", startTime: "09:00", endTime: "17:00" },
                { day: "Sat", startTime: "09:00", endTime: "13:00" }
            ],
            profileImage: profileImagePath,
            documents: certificatePaths
        });

        res.status(201).json({ 
            success: true, 
            message: `Hospital Doctor added successfully with OPD Room (${doctor.department.roomNumber}) and Fee (₹${finalOpdFee}).`, 
            data: doctor 
        });
    } catch (error) {
        console.error("Add Hospital Doctor Error:", error);
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

// @desc    Hospital Admin Updates Doctor Info (Includes OPD Room, Slot Duration & Fees)
// @route   PUT /api/hospital/doctors/update/:id
// @access  Private (Hospital Admin)
const updateHospitalDoctor = async (req, res) => {
    try {
        const { id } = req.params;
        const hospitalId = req.user.id;
        const files = req.files;
        let updateData = { ...req.body };

        if (files?.profileImage) updateData.profileImage = `/uploads/doctors/${files.profileImage[0].filename}`;
        if (files?.certificates) updateData.documents = files.certificates.map(f => `/uploads/doctors/${f.filename}`);

        if (req.body.password && req.body.password.trim() !== '') {
            updateData.password = await bcrypt.hash(String(req.body.password), 10);
        }

        // Support OPD Room, Fee & Duration directly
        if (req.body.roomNumber) {
            updateData['department.roomNumber'] = req.body.roomNumber.trim();
        }
        if (req.body.opdFee !== undefined || req.body.clinicFee !== undefined) {
            updateData['fees.clinic'] = Math.max(0, parseInt(req.body.opdFee || req.body.clinicFee));
        }
        if (req.body.slotDuration) {
            updateData.slotDuration = Math.max(5, parseInt(req.body.slotDuration));
        }

        const doctor = await Doctor.findOneAndUpdate(
            { _id: id, hospitalId },
            { $set: updateData },
            { new: true }
        );

        if (!doctor) return res.status(404).json({ message: "Doctor not found or unauthorized access." });

        res.status(200).json({ success: true, message: "Doctor updated successfully with OPD details.", data: doctor });
    } catch (error) {
        console.error("Update Hospital Doctor Error:", error);
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

// @desc    Hospital Admin Sets Doctor's OPD Cabin Room, Fee, Schedule & Premium Slots
// @route   PUT /api/hospital/doctors/configure-opd/:doctorId
// @access  Private (Hospital Admin)
const configureDoctorOpdScheduleByHospital = async (req, res) => {
    try {
        const hospitalId = req.user.id;
        const { doctorId } = req.params;
        const { roomNumber, slotDuration, opdFee, availability, isOpdEnabled, premiumSlots } = req.body;

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

        // Update Doctor Document
        await Doctor.collection.updateOne(
            { _id: new mongoose.Types.ObjectId(doctorId) },
            { $set: updatePayload }
        );

        // Update Premium Slots in Availability Collection
        if (premiumSlots !== undefined) {
            const formattedPremiumSlots = Array.isArray(premiumSlots) ? premiumSlots : safeObjectParse(premiumSlots, []);
            await Availability.findOneAndUpdate(
                { vendorId: doctorId, vendorType: 'Doctor' },
                { $set: { premiumSlots: formattedPremiumSlots } },
                { upsert: true, new: true }
            );
        }

        const updatedDoctor = await Doctor.findById(doctorId)
            .select('name speciality fees department slotDuration availability consultationStatus')
            .lean();

        res.status(200).json({
            success: true,
            message: `OPD Configuration and Premium Slots saved for Dr. ${updatedDoctor.name}.`,
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