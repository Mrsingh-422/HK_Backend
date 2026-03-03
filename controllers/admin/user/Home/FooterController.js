const Footer = require('../../../../models/Footer');

// @desc    Update Footer Content
// @route   POST /api/footer
// @access  Private (Admin)
const updateFooter = async (req, res) => {
    try {
        const {
            address,
            phones,          // String: "123, 456"
            emails,          // String: "a@a.com, b@b.com"
            aboutTitle,
            aboutDescription,
            facebook,
            twitter,
            instagram,
            youtube,
            services,        // String: "Service 1\nService 2"
            bottomLinks,     // String: "Privacy|/privacy\nTerms|/terms"
            copyrightText
        } = req.body;

        // --- Data Processing (String to Array) ---

        // 1. Process Phones (comma separated)
        const phoneArray = phones 
            ? phones.split(',').map(p => p.trim()).filter(p => p !== "") 
            : [];

        // 2. Process Emails (comma separated)
        const emailArray = emails 
            ? emails.split(',').map(e => e.trim()).filter(e => e !== "") 
            : [];

        // 3. Process Services (new line separated)
        const serviceArray = services 
            ? services.split('\n').map(s => s.trim()).filter(s => s !== "") 
            : [];

        // 4. Process Bottom Links (Format: Name|URL per line)
        let bottomLinksArray = [];
        if (bottomLinks) {
            bottomLinksArray = bottomLinks.split('\n').map(link => {
                const parts = link.split('|');
                if (parts.length === 2) {
                    return { name: parts[0].trim(), url: parts[1].trim() };
                }
                return null;
            }).filter(item => item !== null);
        }

        // --- Construct Update Object ---
        const updateData = {
            address,
            phones: phoneArray,
            emails: emailArray,
            aboutTitle,
            aboutDescription,
            socialLinks: {
                facebook,
                twitter,
                instagram,
                youtube
            },
            services: serviceArray,
            bottomLinks: bottomLinksArray,
            copyrightText
        };

        // Upsert: Update if exists, Create if not
        const footer = await Footer.findOneAndUpdate(
            {}, // Empty filter matches the first document found (singleton pattern)
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Footer updated successfully', data: footer });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get Footer Content
// @route   GET /api/footer
// @access  Public
const getFooter = async (req, res) => {
    try {
        const footer = await Footer.findOne();
        
        // If no footer exists yet, return empty structure to prevent frontend errors
        if (!footer) {
            return res.status(200).json({ success: true, data: {} });
        }

        res.status(200).json({ success: true, data: footer });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { updateFooter, getFooter };