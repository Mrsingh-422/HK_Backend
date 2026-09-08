const Footer = require('../../../../models/Footer');

// @desc    Update Footer Content (Safe & Partial Update Support)
// @route   POST /api/footer
// @access  Private (Admin)
const updateFooter = async (req, res) => {
    try {
        const {
            address,
            phones,
            emails,
            aboutTitle,
            aboutDescription,
            socialLinks,
            services,
            bottomLinks,
            copyrightText
        } = req.body;

        const updateData = {};

        // 1. Address
        if (address !== undefined) updateData.address = address.trim();

        // 2. Phones (Array ya Comma-separated string)
        if (phones !== undefined) {
            updateData.phones = Array.isArray(phones)
                ? phones.map(p => String(p).trim()).filter(Boolean)
                : String(phones).split(',').map(p => p.trim()).filter(Boolean);
        }

        // 3. Emails (Array ya Comma-separated string)
        if (emails !== undefined) {
            updateData.emails = Array.isArray(emails)
                ? emails.map(e => String(e).trim()).filter(Boolean)
                : String(emails).split(',').map(e => e.trim()).filter(Boolean);
        }

        // 4. About Text
        if (aboutTitle !== undefined) updateData.aboutTitle = aboutTitle.trim();
        if (aboutDescription !== undefined) updateData.aboutDescription = aboutDescription.trim();
        if (copyrightText !== undefined) updateData.copyrightText = copyrightText.trim();

        // 5. 🚀 DYNAMIC SOCIAL MEDIA LINKS (URL + Custom Icon Link)
        if (socialLinks !== undefined) {
            if (Array.isArray(socialLinks)) {
                updateData.socialLinks = socialLinks
                    .filter(item => item && item.platform && item.url)
                    .map(item => ({
                        platform: item.platform.trim(),
                        url: item.url.trim(),
                        icon: item.icon ? item.icon.trim() : item.platform.toLowerCase().trim()
                    }));
            } else if (typeof socialLinks === 'string') {
                updateData.socialLinks = socialLinks.split('\n').map(line => {
                    const parts = line.split('|');
                    if (parts.length >= 2) {
                        return {
                            platform: parts[0].trim(),
                            url: parts[1].trim(),
                            icon: parts[2] ? parts[2].trim() : parts[0].toLowerCase().trim()
                        };
                    }
                    return null;
                }).filter(Boolean);
            }
        }

        // 6. Services List
        if (services !== undefined) {
            updateData.services = Array.isArray(services)
                ? services.map(s => String(s).trim()).filter(Boolean)
                : String(services).split('\n').map(s => s.trim()).filter(Boolean);
        }

        // 7. Bottom Links
        if (bottomLinks !== undefined) {
            if (Array.isArray(bottomLinks)) {
                updateData.bottomLinks = bottomLinks.filter(b => b && b.name && b.url);
            } else if (typeof bottomLinks === 'string') {
                updateData.bottomLinks = bottomLinks.split('\n').map(link => {
                    const parts = link.split('|');
                    if (parts.length >= 2) {
                        return { name: parts[0].trim(), url: parts[1].trim() };
                    }
                    return null;
                }).filter(Boolean);
            }
        }

        // Upsert Single Document
        const footer = await Footer.findOneAndUpdate(
            {}, 
            { $set: updateData },
            { new: true, upsert: true }
        );

        return res.status(200).json({ 
            success: true, 
            message: 'Footer updated successfully', 
            data: footer 
        });

    } catch (error) {
        console.error("Footer Update Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get Footer Content
// @route   GET /api/footer
// @access  Public
const getFooter = async (req, res) => {
    try {
        const footer = await Footer.findOne().lean();
        
        if (!footer) {
            return res.status(200).json({ 
                success: true, 
                data: {
                    address: '',
                    phones: [],
                    emails: [],
                    aboutTitle: 'Health Kangaroo',
                    aboutDescription: '',
                    socialLinks: [],
                    services: [],
                    bottomLinks: [],
                    copyrightText: 'Copyright © 2026, All Right Reserved'
                } 
            });
        }

        return res.status(200).json({ success: true, data: footer });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { updateFooter, getFooter };