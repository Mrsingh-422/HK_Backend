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

// @desc    Hospital Admin Adds New Doctor (Safe array-based duplicate checking & clean defaults)
// @route   POST /api/hospital/doctors/add
// @access  Private (Hospital Admin)
const addHospitalDoctor = async (req, res) => {
    try {
        const { 
            name, email, phone, password, speciality, qualification, 
            licenseNumber, councilNumber, councilName, about,
            country, state, city, address, isNormal, isEmergency,
            roomNumber, opdFee, clinicFee, slotDuration
        } = req.body;

        if (!name || !password) {
            return res.status(400).json({ success: false, message: "Doctor Name and Password are required." });
        }

        const cleanPhone = phone ? String(phone).trim().replace(/\D/g, "").slice(-10) : null;
        const cleanEmail = email ? email.toLowerCase().trim() : null;

        // Safe duplicate query array prevents matching undefined/null fields
        const duplicateConditions = [];
        if (cleanEmail) duplicateConditions.push({ email: cleanEmail });
        if (cleanPhone) duplicateConditions.push({ phone: cleanPhone });

        if (duplicateConditions.length > 0) {
            const exists = await Doctor.findOne({ $or: duplicateConditions });
            if (exists) {
                return res.status(400).json({ 
                    success: false, 
                    message: "Doctor with this email or phone number already exists." 
                });
            }
        }

        const hashedPassword = await bcrypt.hash(String(password || '123456'), 10);

        const profileImagePath = req.files?.profileImage 
            ? `/uploads/doctors/${req.files.profileImage[0].filename}` 
            : null;

        const certificatePaths = req.files?.certificates 
            ? req.files.certificates.map(f => `/uploads/doctors/${f.filename}`) 
            : [];

        const finalOpdFee = Math.max(0, parseInt(opdFee || clinicFee || 500));
        const finalSlotDuration = Math.max(5, parseInt(slotDuration || 15));
        const finalRoom = roomNumber && String(roomNumber).trim() !== "" ? String(roomNumber).trim() : "Cabin 1";

        const doctor = await Doctor.create({
            hospitalId: req.user.id,
            name: name.trim(), 
            email: cleanEmail || undefined, 
            phone: cleanPhone || undefined,
            password: hashedPassword,
            country: country || null, 
            state: state || null, 
            city: city || null, 
            address: address || null,
            speciality: speciality ? speciality.trim() : "General Physician", 
            qualification: qualification ? qualification.trim() : "MBBS", 
            licenseNumber: licenseNumber || null, 
            councilNumber: councilNumber || null, 
            councilName: councilName || null, 
            about: about || "",
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
                roomNumber: finalRoom
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

        // Initialize availability config for seamless slot generator lookups
        await Availability.findOneAndUpdate(
            { vendorId: doctor._id, vendorType: 'Doctor' },
            {
                $set: {
                    vendorId: doctor._id,
                    vendorType: 'Doctor',
                    startTime: "09:00",
                    endTime: "17:00",
                    slotDuration: finalSlotDuration,
                    offDays: ["Sunday"],
                    unavailableSlots: []
                }
            },
            { upsert: true, new: true }
        );

        res.status(201).json({ 
            success: true, 
            message: `Hospital Doctor added successfully with OPD Room (${doctor.department.roomNumber}) and Fee (₹${finalOpdFee}).`, 
            data: doctor 
        });
    } catch (error) {
        console.error("Add Hospital Doctor Error:", error);
        res.status(500).json({ success: false, message: error.message });
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

// @desc    Hospital Admin Updates Doctor (Safe multipart JSON array parsing & ID validation)
// @route   PUT /api/hospital/doctors/update/:id
// @access  Private (Hospital Admin)
const updateHospitalDoctor = async (req, res) => {
    try {
        const { id } = req.params;
        const hospitalId = req.user.id;
        const files = req.files;
        let updateData = { ...req.body };

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ success: false, message: "Invalid Doctor ID format." });
        }

        if (files?.profileImage && files.profileImage[0]) {
            updateData.profileImage = `/uploads/doctors/${files.profileImage[0].filename}`;
        }
        if (files?.certificates && files.certificates.length > 0) {
            updateData.documents = files.certificates.map(f => `/uploads/doctors/${f.filename}`);
        }

        if (req.body.password && req.body.password.trim() !== '') {
            updateData.password = await bcrypt.hash(String(req.body.password), 10);
        }

        if (req.body.roomNumber) {
            updateData['department.roomNumber'] = req.body.roomNumber.trim();
        }
        if (req.body.opdFee !== undefined || req.body.clinicFee !== undefined) {
            updateData['fees.clinic'] = Math.max(0, parseInt(req.body.opdFee || req.body.clinicFee));
        }
        if (req.body.slotDuration) {
            updateData.slotDuration = Math.max(5, parseInt(req.body.slotDuration));
        }

        // Parse availability if passed as stringified JSON via multipart form-data
        if (typeof updateData.availability === 'string') {
            try {
                updateData.availability = JSON.parse(updateData.availability);
            } catch (e) {}
        }

        const doctor = await Doctor.findOneAndUpdate(
            { _id: id, hospitalId },
            { $set: updateData },
            { new: true }
        ).select('-password');

        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found or unauthorized access." });
        }

        res.status(200).json({ 
            success: true, 
            message: "Doctor updated successfully.", 
            data: doctor 
        });
    } catch (error) {
        console.error("Update Hospital Doctor Error:", error);
        res.status(500).json({ success: false, message: error.message });
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

// @desc    Hospital Doctor Login (Supports Email or Phone, saves FCM push token, sets isOnline)
// @route   POST /api/hospital/doctors/login
// @access  Public
const loginHospitalDoctor = async (req, res) => {
    try {
        const { email, phone, password, fcmToken } = req.body;

        if ((!email && !phone) || !password) {
            return res.status(400).json({
                success: false,
                message: "Email or Phone number and password are required."
            });
        }

        const cleanEmail = email ? email.toLowerCase().trim() : null;
        const cleanPhone = phone ? String(phone).trim().replace(/\D/g, "").slice(-10) : null;

        const query = [];
        if (cleanEmail) query.push({ email: cleanEmail });
        if (cleanPhone) query.push({ phone: cleanPhone });

        const doctor = await Doctor.findOne({ $or: query }).select("+password");

        if (!doctor) {
            return res.status(404).json({
                success: false,
                message: "Doctor credentials not found."
            });
        }

        if (doctor.role !== "hospital-doctor") {
            return res.status(403).json({
                success: false,
                message: "Access Denied: Only registered Hospital Doctors can login through this portal."
            });
        }

        if (doctor.isActive === false) {
            return res.status(403).json({
                success: false,
                message: "Your doctor account has been deactivated. Please contact hospital administrator."
            });
        }

        const isMatch = await bcrypt.compare(String(password), doctor.password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid password credentials."
            });
        }

        const expiry = process.env.NODE_ENV === 'development' ? '36500d' : '7d';
        const token = jwt.sign(
            { id: doctor._id, role: doctor.role },
            process.env.JWT_SECRET,
            { expiresIn: expiry }
        );

        doctor.token = token;
        doctor.isOnline = true;
        if (fcmToken) {
            doctor.fcmToken = String(fcmToken).trim();
        }
        await doctor.save();

        doctor.password = undefined;

        res.status(200).json({
            success: true,
            message: "Login successful.",
            token,
            doctor
        });

    } catch (error) {
        console.error("Login Hospital Doctor Error:", error);
        res.status(500).json({
            success: false,
            message: error.message
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