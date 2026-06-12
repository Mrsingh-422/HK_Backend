// controllers/user/Doctor/ChatController.js
const Message = require('../../../models/Message');

// GET: /api/chat/history/:appointmentId
const getChatHistory = async (req, res) => {
    try {
        const { appointmentId } = req.params;

        // Fetch messages for this appointment sorted by oldest first
        const messages = await Message.find({ appointmentId })
            .sort({ createdAt: 1 });

        res.json({
            success: true,
            count: messages.length,
            data: messages
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getChatHistory };