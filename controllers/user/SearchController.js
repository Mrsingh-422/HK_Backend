// controllers/user/SearchController.js
const Doctor = require('../../models/Doctor');
const Hospital = require('../../models/Hospital');
const Lab = require('../../models/Lab');
const LabTest = require('../../models/LabTest');
const LabPackage = require('../../models/LabPackage');
const Medicine = require('../../models/Medicine');
const Nurse = require('../../models/Nurse');
const NurseService = require('../../models/NurseService');
const Ambulance = require('../../models/Ambulance');
const ChatSession = require('../../models/ChatSession');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- GROQ SDK IMPORT ---
const Groq = require('groq-sdk'); // 👈 Import Groq SDK

// --- OTHER LOGISTICS & TRANSACTION MODELS ---
const AmbulanceBooking = require('../../models/AmbulanceBooking');
const Appointment = require('../../models/Appointment');
const LabBooking = require('../../models/LabBooking');
const NurseBooking = require('../../models/NurseBooking');
const Pharmacy = require('../../models/Pharmacy');
const MedicineInventory = require('../../models/MedicineInventory');
const Ward = require('../../models/Ward');
const Bed = require('../../models/Bed');
const Review = require('../../models/Review');

// --- HELPER FUNCTION: CONTEXT INJECTOR ENGINE (With Deep Transaction Sync) ---
const getLocalDatabaseContext = async (message, userId) => {
    const text = message.toLowerCase();
    let context = "";

    // dynamic keywords extract karein search query ke liye
    const words = text.split(/\s+/).filter(w => w.length > 2 && !['list', 'show', 'find', 'search', 'give', 'some', 'any', 'the', 'for', 'with', 'please', 'hospital', 'doctor', 'medicine', 'lab', 'test', 'ambulance', 'nurse', 'of', 'in', 'near', 'price', 'rate', 'cost', 'track', 'my', 'status', 'ward', 'bed'].includes(w));
    const searchRegex = words.length > 0 ? new RegExp(words.join('|'), 'i') : new RegExp(text, 'i');

    const citiesList = ['mohali', 'chandigarh', 'delhi', 'noida', 'mumbai', 'panchkula', 'gurugram'];
    let targetLocation = null;
    for (let city of citiesList) {
        if (text.includes(city)) {
            targetLocation = city;
            break;
        }
    }

    // FLOW A: USER'S OWN PERSONAL TRANSACTION TRACKING (Appointments & Bookings)
    if (text.includes('my') || text.includes('track') || text.includes('order') || text.includes('booking') || text.includes('appointment') || text.includes('status')) {
        context += `\n[DATABASE CONTEXT - USER ACTIVE BOOKINGS & HISTORY]:\n`;

        const [appointments, labBookings, ambulanceBookings, nurseBookings] = await Promise.all([
            Appointment.find({ userId })
                .populate('doctorId', 'name speciality')
                .populate('hospitalId', 'name')
                .sort({ createdAt: -1 }).limit(3).lean(),
            LabBooking.find({ userId })
                .populate('labId', 'name')
                .sort({ createdAt: -1 }).limit(3).lean(),
            AmbulanceBooking.find({ userId })
                .populate('ambulanceId', 'name vehicleNumber')
                .populate('hospitalId', 'name')
                .sort({ createdAt: -1 }).limit(3).lean(),
            NurseBooking.find({ userId })
                .populate('nurseId', 'name')
                .sort({ createdAt: -1 }).limit(3).lean()
        ]);

        let hasBookings = false;

        if (appointments.length > 0) {
            hasBookings = true;
            context += `* **Doctor Appointments / Admissions:**\n` + 
                appointments.map(a => `  - ID: ${a.bookingId || 'N/A'}, Type: ${a.bookingType}, Status: **${a.status}**, Provider: ${a.doctorId?.name || a.hospitalId?.name || 'Clinic'}, Date: ${a.appointmentDate ? new Date(a.appointmentDate).toDateString() : 'N/A'}, Total: ₹${a.totalAmount || 0}`).join('\n') + "\n";
        }
        if (labBookings.length > 0) {
            hasBookings = true;
            context += `* **Lab Diagnostics Bookings:**\n` + 
                labBookings.map(l => `  - ID: ${l.bookingId}, Status: **${l.status}**, Lab: ${l.labId?.name}, Total Amount: ₹${l.billSummary?.totalAmount || 0}`).join('\n') + "\n";
        }
        if (ambulanceBookings.length > 0) {
            hasBookings = true;
            context += `* **Ambulance Bookings:**\n` + 
                ambulanceBookings.map(ab => `  - ID: ${ab.bookingId}, Service: ${ab.serviceType}, Status: **${ab.status}**, Vehicle No: ${ab.ambulanceId?.vehicleNumber || 'Searching'}, Total Fee: ₹${ab.pricing?.total || 0}`).join('\n') + "\n";
        }
        if (nurseBookings.length > 0) {
            hasBookings = true;
            context += `* **Nurse Care Bookings:**\n` + 
                nurseBookings.map(nb => `  - ID: ${nb.bookingId || 'N/A'}, Service: ${nb.serviceDetails?.title || 'Home Nurse'}, Status: **${nb.status}**, Nurse Provider: ${nb.nurseId?.name}, Price: ₹${nb.totalPrice || 0}`).join('\n') + "\n";
        }

        if (!hasBookings) {
            context += `  - You do not have any active bookings or order history registered under your account.\n`;
        }
    }

    // FLOW B: VENDOR-WISE MEDICINE PRICING & STOCK CHECK (e.g. Dolo in Mohali)
    if (text.includes('medicine') || text.includes('pharmacy') || text.includes('price') || text.includes('rate') || text.includes('stock') || text.includes('dolo') || text.includes('tablet') || text.includes('syrup')) {
        context += `\n[DATABASE CONTEXT - MEDICINES & VENDOR PRICES]:\n`;

        const medMatches = await Medicine.find({
            $or: [
                { name: searchRegex },
                { salt_composition: searchRegex }
            ]
        }).select('_id name packaging mrp').limit(5).lean();

        if (medMatches.length > 0) {
            const medIds = medMatches.map(m => m._id);
            const pharmacyQuery = { profileStatus: 'Approved', isActive: true };
            if (targetLocation) {
                pharmacyQuery.city = new RegExp(targetLocation, 'i');
            }

            const pharmacies = await Pharmacy.find(pharmacyQuery).select('_id name city address').limit(5).lean();

            if (pharmacies.length > 0) {
                const pharmacyIds = pharmacies.map(p => p._id);

                const inventories = await MedicineInventory.find({
                    medicineId: { $in: medIds },
                    pharmacyId: { $in: pharmacyIds },
                    is_available: true,
                    stock_quantity: { $gt: 0 }
                }).populate('pharmacyId', 'name city address').populate('medicineId', 'name packaging mrp').lean();

                if (inventories.length > 0) {
                    context += inventories.map(inv => `* **${inv.medicineId?.name}** (${inv.medicineId?.packaging || 'Tablet'})
  - Pharmacy Vendor: **${inv.pharmacyId?.name}** (${inv.pharmacyId?.city})
  - Vendor Selling Price: **₹${inv.vendor_price}** (MRP: ₹${inv.medicineId?.mrp || 'N/A'})
  - Current Available Stock: ${inv.stock_quantity} units
  - Pharmacy Address: ${inv.pharmacyId?.address || 'N/A'}`).join('\n') + "\n";
                } else {
                    context += `  - Medicine match found, but currently out of stock at registered pharmacies in ${targetLocation || 'your area'}.\n`;
                }
            } else {
                context += `  - Pharmacies found in master directories, but none are active or approved in ${targetLocation || 'your area'}.\n`;
            }
        } else {
            context += `  - No medicine named "${words.join(' ')}" found in our medical directories.\n`;
        }
    }

    // FLOW C: HOSPITAL BEDS & ICU WARD AVAILABILITY
    if (text.includes('hospital') || text.includes('bed') || text.includes('ward') || text.includes('icu') || text.includes('ventilator') || text.includes('admission')) {
        context += `\n[DATABASE CONTEXT - HOSPITAL BEDS & WARD STATUS]:\n`;

        const hospQuery = { profileStatus: 'Approved', isActive: true };
        if (targetLocation) {
            hospQuery.city = new RegExp(targetLocation, 'i');
        }

        const hospitals = await Hospital.find(hospQuery).select('_id name city type').limit(3).lean();

        if (hospitals.length > 0) {
            const hospitalIds = hospitals.map(h => h._id);

            const [wards, beds] = await Promise.all([
                Ward.find({ hospitalId: { $in: hospitalIds }, isActive: true }).lean(),
                Bed.find({ hospitalId: { $in: hospitalIds } }).populate('wardId', 'name').lean()
            ]);

            hospitals.forEach(hosp => {
                context += `* **${hosp.name}** (${hosp.type || 'Private'} - ${hosp.city})\n`;
                const hospWards = wards.filter(w => w.hospitalId.toString() === hosp._id.toString());
                const hospBeds = beds.filter(b => b.hospitalId.toString() === hosp._id.toString());

                if (hospWards.length > 0) {
                    hospWards.forEach(ward => {
                        const totalWardBeds = hospBeds.filter(b => b.wardId?._id.toString() === ward._id.toString());
                        const availableBeds = totalWardBeds.filter(b => b.status === 'Available');
                        const ventBeds = availableBeds.filter(b => b.isVentilatorAvailable === true);

                        context += `  - **Ward: ${ward.name}** (${ward.type})
    - Total Ward Beds: ${ward.totalBeds} (Available to book: **${ward.availableBeds}**)
    - Beds with Ventilator: **${ventBeds.length}** available\n`;
                    });
                } else {
                    context += `  - No active ward/bed structures currently configured for this hospital in directory.\n`;
                }
            });
        } else {
            context += `  - No hospitals found in matching city/location directory.\n`;
        }
    }

    // FLOW D: CLINICAL DOCTORS & DIRECT SERVICES
    if (text.includes('doctor') || text.includes('appointment') || text.includes('consult') || text.includes('specialist') || text.includes('dr')) {
        context += `\n[DATABASE CONTEXT - ACTIVE DOCTORS]:\n`;
        
        const docQuery = { isActive: true, profileStatus: 'Approved' };
        if (targetLocation) {
            docQuery.city = new RegExp(targetLocation, 'i');
        }

        const matches = await Doctor.find(docQuery)
            .select('name speciality experienceYears fees city consultationStatus averageRating')
            .limit(5).lean();

        if (matches.length > 0) {
            context += matches.map(m => `* **${m.name}**
  - Speciality: ${m.speciality}
  - Experience: ${m.experienceYears} Years (Rating: ${m.averageRating || '4.5'}/5)
  - Consultation Charges: Clinic Visit: ₹${m.fees?.clinic || 0} | Online Video: ₹${m.fees?.online || 0}
  - Available In: ${m.city || 'Punjab'}`).join('\n') + "\n";
        } else {
            context += `  - No active approved doctors matching query found in directory.\n`;
        }
    }

    // FLOW E: LAB DIAGNOSTICS TESTS & PACKAGES
    if (text.includes('lab') || text.includes('test') || text.includes('package') || text.includes('pathology') || text.includes('radiology')) {
        context += `\n[DATABASE CONTEXT - LAB TESTS & DIAGNOSTICS]:\n`;
        
        const testMatches = await LabTest.find({ isActive: true, testName: searchRegex })
            .populate('labId', 'name city')
            .limit(5).lean();

        if (testMatches.length > 0) {
            context += testMatches.map(m => `* **${m.testName}**
  - Lab Service Provider: **${m.labId?.name}** (${m.labId?.city || 'N/A'})
  - Total Cost: **₹${m.discountPrice || m.amount}** (MRP: ₹${m.amount})
  - Reporting TAT: ${m.reportTime || '12 Hours'}
  - Sample Type: ${m.sampleType || 'Blood'}`).join('\n') + "\n";
        } else {
            context += `  - No active pathology or radiology tests found matching this search in directory.\n`;
        }
    }

    // FLOW F: AMBULANCE EMERGENCY FLEETS
    if (text.includes('ambulance') || text.includes('vehicle') || text.includes('emergency') || text.includes('van')) {
        context += `\n[DATABASE CONTEXT - EMERGENCY AMBULANCE DIRECTORY]:\n`;

        const ambQuery = { profileStatus: 'Approved' };
        if (targetLocation) {
            ambQuery.city = new RegExp(targetLocation, 'i');
        }

        const matches = await Ambulance.find(ambQuery)
            .select('name vehicleType vehicleNumber pricing city availableForEmergency')
            .limit(4).lean();

        if (matches.length > 0) {
            context += matches.map(m => `* **${m.name}**
  - Vehicle Type: ${m.vehicleType} (Plate: ${m.vehicleNumber || 'N/A'})
  - Base Standard Fare: **₹${m.pricing?.fixedPrice || 0}** (Fare/KM: ₹${m.pricing?.pricePerKM || 0})
  - Status: ${m.availableForEmergency ? '🟢 On Call Duty' : '🔴 Busy/Off Duty'}
  - Service City: ${m.city}`).join('\n') + "\n";
        } else {
            context += `  - No emergency ambulance carriers currently available or approved under this location directory.\n`;
        }
    }

    return context;
};

// --- GET HOMEPAGE SUGGESTIONS ---
const getHomepageSuggestions = async (req, res) => {
    try {
        const { query, type } = req.query;
        if (!query || query.trim().length < 2) return res.json({ success: true, data: [] });

        const regex = new RegExp(query.trim(), 'i');
        const cleanType = type ? type.trim().toLowerCase() : null;

        let doctors = [], hospitals = [], labs = [], labTests = [], labPackages = [], medicines = [], nurseServices = [], ambulances = [];
        const tasks = [];

        if (!cleanType || cleanType === 'doctor') {
            tasks.push(Doctor.find({ isActive: true, profileStatus: 'Approved', $or: [{ name: regex }, { speciality: regex }] }).select('name speciality profileImage').limit(3).lean().then(res => doctors = res));
        }
        if (!cleanType || cleanType === 'hospital') {
            tasks.push(Hospital.find({ isActive: true, profileStatus: 'Approved', name: regex }).select('name hospitalImage city').limit(3).lean().then(res => hospitals = res));
        }
        if (!cleanType || cleanType === 'labprovider') {
            tasks.push(
                Lab.find({ isActive: true, profileStatus: 'Approved', name: regex }).select('name profileImage city').limit(3).lean().then(res => labs = res),
                LabTest.find({ isActive: true, testName: regex }).select('testName amount discountPrice').limit(3).lean().then(res => labTests = res),
                LabPackage.find({ isActive: true, packageName: regex }).select('packageName offerPrice mrp').limit(3).lean().then(res => labPackages = res)
            );
        }
        if (!cleanType || cleanType === 'pharmacy') {
            tasks.push(Medicine.find({ $or: [{ name: regex }, { salt_composition: regex }] }).select('name salt_composition image_url').limit(3).lean().then(res => medicines = res));
        }
        if (!cleanType || cleanType === 'nurseprovider') {
            tasks.push(NurseService.find({ status: 'Approved', title: regex }).select('title pricing nurseId').populate('nurseId', 'name profileImage').limit(3).lean().then(res => nurseServices = res));
        }
        if (!cleanType || cleanType === 'ambulance') {
            tasks.push(Ambulance.find({ profileStatus: 'Approved', $or: [{ name: regex }, { vehicleType: regex }] }).select('name vehicleType pricing').limit(3).lean().then(res => ambulances = res));
        }

        await Promise.all(tasks);

        const suggestions = [];
        doctors.forEach(doc => suggestions.push({ id: doc._id, title: doc.name, subtitle: doc.speciality, type: "Doctor", image: doc.profileImage }));
        hospitals.forEach(hosp => suggestions.push({ id: hosp._id, title: hosp.name, subtitle: hosp.city, type: "Hospital", image: hosp.hospitalImage?.[0] || null }));
        labs.forEach(lab => suggestions.push({ id: lab._id, title: lab.name, subtitle: lab.city, type: "Lab", image: lab.profileImage }));
        labTests.forEach(test => suggestions.push({ id: test._id, title: test.testName, subtitle: `Starting at ₹${test.discountPrice || test.amount}`, type: "Lab Test", image: null }));
        labPackages.forEach(pkg => suggestions.push({ id: pkg._id, title: pkg.packageName, subtitle: `Package Price: ₹${pkg.offerPrice || pkg.mrp}`, type: "Lab Package", image: null }));
        medicines.forEach(med => suggestions.push({ id: med._id, title: med.name, subtitle: med.salt_composition || "", type: "Medicine", image: med.image_url?.[0] || null }));
        nurseServices.forEach(ns => suggestions.push({ id: ns._id, title: ns.title, subtitle: `Provided by: ${ns.nurseId?.name || "Provider"}`, type: "Nurse Service", image: ns.nurseId?.profileImage || null }));
        ambulances.forEach(amb => suggestions.push({ id: amb._id, title: amb.name, subtitle: `${amb.vehicleType} - Base Rate: ₹${amb.pricing?.fixedPrice || 0}`, type: "Ambulance", image: null }));

        res.json({ success: true, count: suggestions.length, data: suggestions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- DEEP SEARCH DETAILS ---
const searchHomepage = async (req, res) => {
    try {
        const { query, type } = req.query;
        if (!query || query.trim().length < 2) return res.status(400).json({ success: false, message: "Search query must be at least 2 characters." });

        const regex = new RegExp(query.trim(), 'i');
        const cleanType = type ? type.trim().toLowerCase() : null;

        let doctors = [], hospitals = [], labs = [], labTests = [], medicines = [], nurseServices = [], ambulances = [];
        const tasks = [];

        if (!cleanType || cleanType === 'doctor') {
            tasks.push(Doctor.find({ isActive: true, profileStatus: 'Approved', $or: [{ name: regex }, { speciality: regex }, { treatedConditions: regex }] }).select('-password -token').limit(10).lean().then(res => doctors = res));
        }
        if (!cleanType || cleanType === 'hospital') {
            tasks.push(Hospital.find({ isActive: true, profileStatus: 'Approved', $or: [{ name: regex }, { city: regex }] }).select('-password -token').limit(10).lean().then(res => hospitals = res));
        }
        if (!cleanType || cleanType === 'labprovider') {
            tasks.push(
                Lab.find({ isActive: true, profileStatus: 'Approved', $or: [{ name: regex }, { city: regex }] }).select('-password -token').limit(10).lean().then(res => labs = res),
                LabTest.find({ isActive: true, testName: regex }).populate('labId', 'name city profileImage').limit(10).lean().then(res => labTests = res)
            );
        }
        if (!cleanType || cleanType === 'pharmacy') {
            tasks.push(Medicine.find({ $or: [{ name: regex }, { salt_composition: regex }, { manufacturers: regex }] }).limit(10).lean().then(res => medicines = res));
        }
        if (!cleanType || cleanType === 'nurseprovider') {
            tasks.push(NurseService.find({ status: 'Approved', $or: [{ title: regex }, { description: regex }] }).populate('nurseId', 'name profileImage city speciality').limit(10).lean().then(res => nurseServices = res));
        }
        if (!cleanType || cleanType === 'ambulance') {
            tasks.push(Ambulance.find({ profileStatus: 'Approved', $or: [{ name: regex }, { vehicleType: regex }, { city: regex }] }).select('-password -token').limit(10).lean().then(res => ambulances = res));
        }

        await Promise.all(tasks);

        res.json({
            success: true,
            query: query.trim(),
            typeFiltered: cleanType || "All",
            data: { doctors, hospitals, labs, labTests, medicines, nurseServices, ambulances }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- DUAL-AI CLINICAL CHATBOT CONTROLLER (With Advanced Context Injection) ---
const handleChatBotMessage = async (req, res) => {
    try {
        const { message } = req.body;
        const userId = req.user.id;

        if (!message) return res.status(400).json({ success: false, message: "Message cannot be empty." });

        // A. Real-time contextual data extract (RAG System)
        const dbContext = await getLocalDatabaseContext(message, userId);

        let session = await ChatSession.findOne({ userId });
        if (!session) {
            session = await ChatSession.create({ userId, messages: [] });
        }

        let botResponse = "";

        const systemInstructionText = `You are an empathetic, highly expert clinical AI assistant named HealthBot for HealthApp.
        Your purpose is to answer users based strictly on data present in our local database.
        If database context is injected, restrict your recommendations ONLY to that specific context.
        Always present list items as clean bullet points for neat rendering.
        Always append this exact disclaimer at the very end of medical or service consultations: "Disclaimer: This is an AI assistant clinical recommendation. Please consult a qualified practitioner for physical diagnosis."`;

        // =====================================================================
        // OPTION 1: CHATBOT RUNS VIA GROQ CLOUD (If GROQ_API_KEY is configured)
        // =====================================================================
        if (process.env.GROQ_API_KEY) {
            console.log("Using GROQ Llama-3.3 chatbot engine (Free 14,400 RPD)...");

            const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

            // Prepare prompt context
            let promptContent = message;
            if (dbContext) {
                promptContent = `${dbContext}\n\n[USER INQUIRY]: ${message}\n\n[ASSISTANT INSTRUCTIONS]: Use the above database context. Present list items with bullet points. Empathize with the user.`;
            }

            // Map DB history to Groq (standard openai format)
            const groqHistory = session.messages.map(msg => ({
                role: msg.sender === 'user' ? 'user' : 'assistant',
                content: msg.text
            }));

            const chatCompletion = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: systemInstructionText },
                    ...groqHistory,
                    { role: "user", content: promptContent }
                ],
                model: "llama-3.1-8b-instant", // 👈 Highly intelligent free 70B model
                temperature: 0.2
            });

            botResponse = chatCompletion.choices[0].message.content;

        // =====================================================================
        // OPTION 2: FALLBACK TO GEMINI (If GROQ_API_KEY is missing)
        // =====================================================================
        } else if (process.env.GEMINI_API_KEY) {
            console.log("Fallback to Gemini-2.5-flash-lite chatbot engine...");

            let promptContent = message;
            if (dbContext) {
                promptContent = `${dbContext}\n\n[USER INQUIRY]: ${message}\n\n[ASSISTANT INSTRUCTIONS]: Use the above database context.`;
            }

            const chatHistory = session.messages.map(msg => ({
                role: msg.sender === 'user' ? 'user' : 'model',
                parts: [{ text: msg.text }]
            }));

            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({
                model: "gemini-2.5-flash-lite", // 👈 Optimized free stable model
                systemInstruction: systemInstructionText
            });

            const chat = model.startChat({ history: chatHistory });
            const result = await chat.sendMessage(promptContent);
            botResponse = result.response.text();

        } else {
            return res.status(500).json({ success: false, message: "Neither GROQ_API_KEY nor GEMINI_API_KEY is configured in backend environment." });
        }

        // F. Save standard user message (without internal system prompt) and response in MongoDB
        session.messages.push({ sender: 'user', text: message });
        session.messages.push({ sender: 'bot', text: botResponse });
        await session.save();

        res.json({
            success: true,
            reply: botResponse,
            history: session.messages
        });

    } catch (error) {
        console.error("ChatBot Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getHomepageSuggestions,
    searchHomepage,
    handleChatBotMessage
};