const fs = require('fs');
const path = require('path');

/**
 * Purani file delete karne ke liye helper function
 * @param {String} filePath - Database mein save kiya gaya path (e.g. public/uploads/fire_staff/staff-123.jpg)
 */
const deleteFile = (filePath) => {
    if (!filePath) return;

    // Project root se absolute path nikalne ke liye
    const fullPath = path.join(__dirname, '..', filePath);

    // Check karein ki file exist karti hai ya nahi
    if (fs.existsSync(fullPath)) {
        fs.unlink(fullPath, (err) => {
            if (err) {
                console.error(`Error deleting file: ${filePath}`, err);
            } else {
                console.log(`Successfully deleted old file: ${filePath}`);
            }
        });
    }
};

module.exports = { deleteFile };