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

// --- HELPER FUNCTION: CHATBOT KE LIYE LOCAL DB CONTEXT EXTRACTOR ---
const getLocalDatabaseContext = async (message) => {
    const text = message.toLowerCase();
    let context = "";

    // Keywords extract karein search query ke liye
    const words = text.split(/\s+/).filter(w => w.length > 2 && !['list', 'show', 'find', 'search', 'give', 'some', 'any', 'the', 'for', 'with', 'please', 'hospital', 'doctor', 'medicine', 'lab', 'test', 'ambulance', 'nurse', 'of', 'in', 'near'].includes(w));
    
    // Fallback regex keyword
    const searchRegex = words.length > 0 ? new RegExp(words.join('|'), 'i') : new RegExp(text, 'i');
    
    // 1. HOSPITAL DETECTION
    if (text.includes('hospital') || text.includes('clinic') || text.includes('bed') || text.includes('admission')) {
        const matches = await Hospital.find({
            isActive: true,
            profileStatus: 'Approved',
            $or: [
                { name: searchRegex },
                { city: searchRegex },
                { address: searchRegex }
            ]
        }).select('name city address type').limit(5).lean();
        
        if (matches.length > 0) {
            context += `\n[DATABASE CONTEXT - HOSPITALS]: Here are the actual registered hospitals in our database matching query:\n` + 
                matches.map(m => `- **${m.name}** (${m.type || 'Private'}), Location: ${m.address || m.city}`).join('\n') + "\n";
        } else {
            context += `\n[DATABASE CONTEXT - HOSPITALS]: No hospitals found registered in our database for query "${words.join(' ')}".\n`;
        }
    }

    // 2. DOCTOR DETECTION
    if (text.includes('doctor') || text.includes('appointment') || text.includes('consult') || text.includes('specialist') || text.includes('dr')) {
        const matches = await Doctor.find({
            isActive: true,
            profileStatus: 'Approved',
            $or: [
                { name: searchRegex },
                { speciality: searchRegex }
            ]
        }).select('name speciality experienceYears fees').limit(5).lean();

        if (matches.length > 0) {
            context += `\n[DATABASE CONTEXT - DOCTORS]: Here are the actual registered doctors in our database matching query:\n` + 
                matches.map(m => `- **${m.name}**, Speciality: ${m.speciality}, Exp: ${m.experienceYears} Years, Fee: ₹${m.fees?.clinic || m.fees?.online || 0}`).join('\n') + "\n";
        } else {
            context += `\n[DATABASE CONTEXT - DOCTORS]: No matching doctors found in our database.\n`;
        }
    }

    // 3. MEDICINE DETECTION
    if (text.includes('medicine') || text.includes('pharmacy') || text.includes('tablet') || text.includes('dolo') || text.includes('syrup')) {
        const matches = await Medicine.find({
            $or: [
                { name: searchRegex },
                { salt_composition: searchRegex }
            ]
        }).select('name salt_composition mrp best_price').limit(5).lean();

        if (matches.length > 0) {
            context += `\n[DATABASE CONTEXT - MEDICINES]: Here are the actual medicines in our database matching query:\n` + 
                matches.map(m => `- **${m.name}**, Salt: ${m.salt_composition || 'N/A'}, Price: ₹${m.best_price || m.mrp}`).join('\n') + "\n";
        } else {
            context += `\n[DATABASE CONTEXT - MEDICINES]: No matching medicines found in our database.\n`;
        }
    }

    // 4. LAB TESTS DETECTION
    if (text.includes('lab') || text.includes('test') || text.includes('package') || text.includes('pathology') || text.includes('radiology')) {
        const testMatches = await LabTest.find({
            isActive: true,
            testName: searchRegex
        }).select('testName amount discountPrice').limit(5).lean();

        if (testMatches.length > 0) {
            context += `\n[DATABASE CONTEXT - LAB TESTS]: Here are the actual lab tests/packages in our database matching query:\n` + 
                testMatches.map(m => `- **${m.testName}**, Price: ₹${m.discountPrice || m.amount}`).join('\n') + "\n";
        } else {
            context += `\n[DATABASE CONTEXT - LAB TESTS]: No matching tests found in our database.\n`;
        }
    }

    // 5. AMBULANCE DETECTION
    if (text.includes('ambulance') || text.includes('vehicle') || text.includes('icu van')) {
        const matches = await Ambulance.find({
            profileStatus: 'Approved',
            $or: [
                { name: searchRegex },
                { vehicleType: searchRegex }
            ]
        }).select('name vehicleType pricing').limit(5).lean();

        if (matches.length > 0) {
            context += `\n[DATABASE CONTEXT - AMBULANCES]: Here are the actual ambulance units in our database matching query:\n` + 
                matches.map(m => `- **${m.name}** (${m.vehicleType}), Base Rate: ₹${m.pricing?.fixedPrice || 0}`).join('\n') + "\n";
        } else {
            context += `\n[DATABASE CONTEXT - AMBULANCES]: No matching ambulances found in our database.\n`;
        }
    }

    // 6. NURSE SERVICES DETECTION
    if (text.includes('nurse') || text.includes('elderly care') || text.includes('nursing') || text.includes('care service')) {
        const matches = await NurseService.find({
            status: 'Approved',
            $or: [
                { title: searchRegex },
                { description: searchRegex }
            ]
        }).select('title pricing').limit(5).lean();

        if (matches.length > 0) {
            context += `\n[DATABASE CONTEXT - NURSE SERVICES]: Here are the actual nurse services in our database matching query:\n` + 
                matches.map(m => `- **${m.title}**, Price: ₹${m.pricing?.oneDay?.final || 0}/day`).join('\n') + "\n";
        } else {
            context += `\n[DATABASE CONTEXT - NURSE SERVICES]: No matching nursing services found in our database.\n`;
        }
    }

    return context;
};

// --- SUGGESTIONS API ---
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

// --- CLINICAL CHATBOT CONTROLLER (With Local DB Context Injection) ---
const handleChatBotMessage = async (req, res) => {
    try {
        const { message } = req.body;
        const userId = req.user.id;

        if (!message) return res.status(400).json({ success: false, message: "Message cannot be empty." });
        if (!process.env.GEMINI_API_KEY) return res.status(500).json({ success: false, message: "Gemini API key is missing." });

        // A. Dynamic Local Database Context Fetch Karein (RAG logic)
        const dbContext = await getLocalDatabaseContext(message);

        // B. Database Context ko Prompt me merge karein (Strict system instructions)
        let promptMessage = message;
        if (dbContext) {
            promptMessage = `${dbContext}\n\n[USER INQUIRY]: ${message}\n\n[ASSISTANT INSTRUCTIONS]: Empathize with the user. Answer using ONLY the hospitals/doctors/medicines/services provided above in the DATABASE CONTEXT. If the DATABASE CONTEXT states "No matching found", inform the user politely that no services/providers matching their search are currently registered on our platform. Do not make up or hallucinate external names.`;
        }

        // C. DB Session History load karein
        let session = await ChatSession.findOne({ userId });
        if (!session) {
            session = await ChatSession.create({ userId, messages: [] });
        }

        const chatHistory = session.messages.map(msg => ({
            role: msg.sender === 'user' ? 'user' : 'model',
            parts: [{ text: msg.text }]
        }));

        // D. Setup Gemini 2.5 Flash (Free Stable Model)
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            systemInstruction: `You are an empathetic, expert clinical assistant named HealthBot.
            Your purpose is to answer users based strictly on data present in our local directories. 
            If database context is injected, restrict your recommendations ONLY to that specific context. 
            Strictly present list items as bullet points for neat rendering.
            Append this exact disclaimer at the end of medical advice: "Disclaimer: This is an AI assistant clinical recommendation. Please consult a qualified practitioner for physical diagnosis."`
        });

        const chat = model.startChat({ history: chatHistory });

        // E. Send context-augmented message to Gemini
        const result = await chat.sendMessage(promptMessage);
        const botResponse = result.response.text();

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