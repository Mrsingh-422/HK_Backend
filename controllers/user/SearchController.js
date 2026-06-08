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
const Groq = require('groq-sdk');

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

// --- HELPER FUNCTION: CONTEXT INJECTOR ENGINE (Token & Cost Highly Optimized) ---
const getLocalDatabaseContext = async (message, userId) => {
    const text = message.toLowerCase();
    let context = "";

    // Dynamic keyword extraction (Short stop-words list)
    const words = text.split(/\s+/).filter(w => w.length > 2 && !['list', 'show', 'find', 'search', 'give', 'some', 'any', 'the', 'for', 'with', 'please', 'hospital', 'doctor', 'medicine', 'lab', 'test', 'ambulance', 'nurse', 'of', 'in', 'near', 'price', 'rate', 'cost', 'track', 'my', 'status', 'ward', 'bed', 'review', 'rating', 'star', 'feedback', 'comment'].includes(w));
    const searchRegex = words.length > 0 ? new RegExp(words.join('|'), 'i') : new RegExp(text, 'i');

    const citiesList = ['mohali', 'chandigarh', 'delhi', 'noida', 'mumbai', 'panchkula', 'gurugram'];
    let targetLocation = null;
    for (let city of citiesList) {
        if (text.includes(city)) {
            targetLocation = city;
            break;
        }
    }

    // =========================================================================
    // OPTIMIZATION: STRICT SINGLE-INTENT ROUTING (Prevents multiple category token bloat)
    // =========================================================================
    
    // 1. User Bookings & Orders check
    if (text.includes('my') || text.includes('track') || text.includes('order') || text.includes('booking') || text.includes('appointment') || text.includes('status')) {
        context += `\n[DB_USER_BOOKINGS]:\n`;
        // Limit search strictly to 1 latest document per category to save massive token payload
        const [appointment, lab, ambulance, nurse] = await Promise.all([
            Appointment.findOne({ userId }).populate('doctorId', 'name').sort({ createdAt: -1 }).lean(),
            LabBooking.findOne({ userId }).populate('labId', 'name').sort({ createdAt: -1 }).lean(),
            AmbulanceBooking.findOne({ userId }).populate('ambulanceId', 'name').sort({ createdAt: -1 }).lean(),
            NurseBooking.findOne({ userId }).populate('nurseId', 'name').sort({ createdAt: -1 }).lean()
        ]);

        let hasBookings = false;
        if (appointment) {
            hasBookings = true;
            context += `- Appt: ID ${appointment.bookingId || 'N/A'}, Status: ${appointment.status}, Dr: ${appointment.doctorId?.name || 'Clinic'}\n`;
        }
        if (lab) {
            hasBookings = true;
            context += `- Lab: ID ${lab.bookingId}, Status: ${lab.status}, Lab: ${lab.labId?.name}\n`;
        }
        if (ambulance) {
            hasBookings = true;
            context += `- Amb: ID ${ambulance.bookingId}, Status: ${ambulance.status}\n`;
        }
        if (nurse) {
            hasBookings = true;
            context += `- Nurse: ID ${nurse.bookingId || 'N/A'}, Status: ${nurse.status}, Nurse: ${nurse.nurseId?.name}\n`;
        }
        if (!hasBookings) {
            context += `- No bookings found in history.\n`;
        }
    }
    // 2. Reviews & Ratings
    else if (text.includes('review') || text.includes('rating') || text.includes('star') || text.includes('feedback') || text.includes('comment')) {
        context += `\n[DB_REVIEWS]:\n`;
        const [targetDoc, targetHosp] = await Promise.all([
            Doctor.findOne({ isActive: true, profileStatus: 'Approved', name: searchRegex }).select('_id name').lean(),
            Hospital.findOne({ isActive: true, profileStatus: 'Approved', name: searchRegex }).select('_id name').lean()
        ]);

        const targetId = targetDoc?._id || targetHosp?._id;
        const targetType = targetDoc ? 'Doctor' : (targetHosp ? 'Hospital' : null);
        const targetName = targetDoc ? targetDoc.name : (targetHosp ? targetHosp.name : "");

        if (targetId) {
            const reviews = await Review.find({ targetId, targetType }).select('userName rating comment').sort({ createdAt: -1 }).limit(2).lean();
            if (reviews.length > 0) {
                context += `Reviews for ${targetName}:\n` + 
                    reviews.map(r => `- ${r.rating}/5 by ${r.userName || 'User'}: "${r.comment || 'No comment'}"`).join('\n') + "\n";
            } else {
                context += `- No reviews found.\n`;
            }
        }
    }
    // 3. Pharmacy Medicines & Pricing
    else if (text.includes('medicine') || text.includes('pharmacy') || text.includes('price') || text.includes('rate') || text.includes('stock') || text.includes('dolo') || text.includes('tablet') || text.includes('syrup')) {
        context += `\n[DB_MEDICINES]:\n`;
        const meds = await Medicine.find({ $or: [{ name: searchRegex }, { salt_composition: searchRegex }] }).select('_id name packaging').limit(2).lean();
        
        if (meds.length > 0) {
            const medIds = meds.map(m => m._id);
            const pharmQuery = { profileStatus: 'Approved', isActive: true };
            if (targetLocation) pharmQuery.city = new RegExp(targetLocation, 'i');
            
            const pharmacies = await Pharmacy.find(pharmQuery).select('_id name city').limit(2).lean();

            if (pharmacies.length > 0) {
                const pharmacyIds = pharmacies.map(p => p._id);
                const inventories = await MedicineInventory.find({
                    medicineId: { $in: medIds },
                    pharmacyId: { $in: pharmacyIds },
                    is_available: true,
                    stock_quantity: { $gt: 0 }
                }).populate('pharmacyId', 'name city').populate('medicineId', 'name').limit(2).lean();

                if (inventories.length > 0) {
                    context += inventories.map(inv => `- ${inv.medicineId?.name}: ${inv.pharmacyId?.name} (₹${inv.vendor_price}, Stock: ${inv.stock_quantity})`).join('\n') + "\n";
                } else {
                    context += `- Out of stock at local pharmacies in ${targetLocation || 'your area'}.\n`;
                }
            }
        }
    }
    // 4. Hospital Beds & Ward status
    else if (text.includes('hospital') || text.includes('bed') || text.includes('ward') || text.includes('icu') || text.includes('ventilator') || text.includes('admission')) {
        context += `\n[DB_BEDS]:\n`;
        const hospQuery = { profileStatus: 'Approved', isActive: true };
        if (targetLocation) hospQuery.city = new RegExp(targetLocation, 'i');

        const hospitals = await Hospital.find(hospQuery).select('_id name city').limit(1).lean();

        if (hospitals.length > 0) {
            const hospId = hospitals[0]._id;
            const [wards, beds] = await Promise.all([
                Ward.find({ hospitalId: hospId, isActive: true }).select('name availableBeds type').lean(),
                Bed.find({ hospitalId: hospId, status: 'Available', isVentilatorAvailable: true }).select('bedNumber').limit(2).lean()
            ]);

            context += `- Hosp: ${hospitals[0].name}\n`;
            context += wards.map(w => `  * Ward: ${w.name} (${w.type}) Available Beds: ${w.availableBeds}`).join('\n') + "\n";
            context += `  * Available Ventilator Beds: ${beds.length}\n`;
        }
    }
    // 5. Clinical Doctors
    else if (text.includes('doctor') || text.includes('appointment') || text.includes('consult') || text.includes('specialist') || text.includes('dr')) {
        context += `\n[DB_DOCTORS]:\n`;
        const docQuery = { isActive: true, profileStatus: 'Approved' };
        if (targetLocation) docQuery.city = new RegExp(targetLocation, 'i');

        const matches = await Doctor.find(docQuery).select('name speciality fees city').limit(2).lean();

        if (matches.length > 0) {
            context += matches.map(m => `- ${m.name} (${m.speciality}): Clinic Fee: ₹${m.fees?.clinic || 0} (In: ${m.city || 'Punjab'})`).join('\n') + "\n";
        }
    }
    // 6. Nurse Services
    else if (text.includes('nurse') || text.includes('elderly care') || text.includes('nursing') || text.includes('care service') || text.includes('home care')) {
        context += `\n[DB_NURSES]:\n`;
        const nurseQuery = { isActive: true, profileStatus: 'Approved' };
        if (targetLocation) nurseQuery.city = new RegExp(targetLocation, 'i');

        const nurses = await Nurse.find(nurseQuery).select('name city speciality').limit(2).lean();

        if (nurses.length > 0) {
            const nurseIds = nurses.map(n => n._id);
            const services = await NurseService.find({ nurseId: { $in: nurseIds }, status: 'Approved' }).select('title pricing nurseId').limit(2).lean();

            nurses.forEach(nurse => {
                const sList = services.filter(s => s.nurseId.toString() === nurse._id.toString());
                context += `- Nurse: ${nurse.name} (${nurse.city})\n` + (sList.length > 0 ? `  * Services: ` + sList.map(s => `${s.title} (₹${s.pricing?.oneDay?.final || 0})`).join(', ') : '') + "\n";
            });
        }
    }
    // 7. Lab Tests
    else if (text.includes('lab') || text.includes('test') || text.includes('package')) {
        context += `\n[DB_LAB_TESTS]:\n`;
        const testMatches = await LabTest.find({ isActive: true, testName: searchRegex }).populate('labId', 'name').limit(2).lean();
        
        if (testMatches.length > 0) {
            context += testMatches.map(m => `- ${m.testName} (${m.labId?.name}): Cost: ₹${m.discountPrice || m.amount}`).join('\n') + "\n";
        }
    }
    // 8. Ambulances
    else if (text.includes('ambulance') || text.includes('vehicle') || text.includes('emergency')) {
        context += `\n[DB_AMBULANCES]:\n`;
        const ambQuery = { profileStatus: 'Approved' };
        if (targetLocation) ambQuery.city = new RegExp(targetLocation, 'i');

        const matches = await Ambulance.find(ambQuery).select('name vehicleType pricing').limit(2).lean();

        if (matches.length > 0) {
            context += matches.map(m => `- ${m.name} (${m.vehicleType}): Fare: ₹${m.pricing?.fixedPrice || 0}`).join('\n') + "\n";
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

// --- DUAL-AI CLINICAL CHATBOT CONTROLLER (With Cost-Optimized Context & History) ---
const handleChatBotMessage = async (req, res) => {
    try {
        const { message } = req.body;
        const userId = req.user.id;

        if (!message) return res.status(400).json({ success: false, message: "Message cannot be empty." });

        let session = await ChatSession.findOne({ userId });
        if (!session) {
            session = await ChatSession.create({ userId, messages: [] });
        }

        // =====================================================================
        // CHAT LIMIT LOCK: STRICT 30 CHATS/DAY IN PRODUCTION, UNLIMITED IN DEV
        // =====================================================================
        if (process.env.NODE_ENV === 'production') {
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            
            // Count user messages sent in the last 24 hours
            const dailyUserMsgCount = session.messages.filter(msg => 
                msg.sender === 'user' && 
                new Date(msg.timestamp) > twentyFourHoursAgo
            ).length;

            if (dailyUserMsgCount >= 30) {
                return res.status(429).json({ 
                    success: false, 
                    message: "You have reached your limit of 30 queries per day on our free tier. Please try again tomorrow or upgrade your account." 
                });
            }
        }

        // A. Token Optimization: Real-time concise context generation (RAG)
        const dbContext = await getLocalDatabaseContext(message, userId);

        let botResponse = "";

        const systemInstructionText = `You are HealthBot, an empathetic clinical AI assistant.
        Strict Rules:
        1. Rely ONLY on the provided [DATABASE CONTEXT]. If empty or no match, politely state no providers are registered.
        2. Present lists as clean bullet points.
        3. Append disclaimer: "Disclaimer: This is an AI assistant clinical recommendation. Please consult a qualified practitioner for physical diagnosis."`;

        // =====================================================================
        // OPTION 1: CHATBOT RUNS VIA GROQ CLOUD (If GROQ_API_KEY is configured)
        // =====================================================================
        if (process.env.GROQ_API_KEY) {
            console.log("Using GROQ Llama-3.1-8b-instant chatbot engine...");

            const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

            let promptContent = message;
            if (dbContext) {
                promptContent = `${dbContext}\n\n[USER INQUIRY]: ${message}`;
            }

            // TOKEN OPTIMIZATION: Only take last 3 messages to keep prompt window small
            const recentHistory = session.messages.slice(-3);
            const groqHistory = recentHistory.map(msg => ({
                role: msg.sender === 'user' ? 'user' : 'assistant',
                content: msg.text
            }));

            const chatCompletion = await groq.chat.completions.create({
                messages: [
                    { role: "system", content: systemInstructionText },
                    ...groqHistory,
                    { role: "user", content: promptContent }
                ],
                model: "llama-3.1-8b-instant", // 👈 Highly cost-effective model with high token limits
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
                promptContent = `${dbContext}\n\n[USER INQUIRY]: ${message}`;
            }

            // TOKEN OPTIMIZATION: Only take last 3 messages for Gemini
            const recentHistory = session.messages.slice(-3);
            const chatHistory = recentHistory.map(msg => ({
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