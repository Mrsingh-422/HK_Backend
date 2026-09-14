const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FileBackup = require('../models/FileBackup');

const LIVE_RENDER_URL = "https://hk-backend-9jm8.onrender.com";

// =========================================================================
// 1. COMPRESSED BACKUP TO MONGODB (Max ~50KB per image to save 512MB space)
// =========================================================================
const backupUploadedFilesToMongo = async (req) => {
    // Agar future me disable karna ho toh .env me ENABLE_MONGO_BACKUP=false kar sakte hain
    if (process.env.ENABLE_MONGO_BACKUP === 'false') return;

    try {
        const filesToBackup = [];

        if (req.file) filesToBackup.push(req.file);
        else if (req.files) {
            if (Array.isArray(req.files)) filesToBackup.push(...req.files);
            else if (typeof req.files === 'object') {
                Object.values(req.files).forEach(arr => {
                    if (Array.isArray(arr)) filesToBackup.push(...arr);
                });
            }
        }

        for (const file of filesToBackup) {
            if (file.path && fs.existsSync(file.path)) {
                const relativePath = file.path.replace(/^public[\\/]/, '/').replace(/\\/g, '/');
                const cleanRelativePath = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;

                let fileBuffer = fs.readFileSync(file.path);

                // ⚡ Compression: Agar image file hai toh Sharp se compress karein
                if (file.mimetype && file.mimetype.startsWith('image/')) {
                    try {
                        const sharp = require('sharp');
                        fileBuffer = await sharp(fileBuffer)
                            .resize({ width: 1200, withoutEnlargement: true }) // Max 1200px
                            .jpeg({ quality: 65, progressive: true })          // 65% quality (~50KB size)
                            .toBuffer();
                    } catch (e) {
                        // Sharp na hone par raw buffer save hoga
                    }
                }

                await FileBackup.findOneAndUpdate(
                    { filePath: cleanRelativePath },
                    {
                        $set: {
                            filePath: cleanRelativePath,
                            fileName: file.filename,
                            mimeType: file.mimetype || 'image/jpeg',
                            fileData: fileBuffer,
                            size: fileBuffer.length
                        }
                    },
                    { upsert: true, new: true }
                );
            }
        }
    } catch (err) {
        console.error("Mongo Backup Error:", err.message);
    }
};

// =========================================================================
// 2. FIXED AUTO-SYNC & RESTORE (Localhost + Render Dono Par Kaam Karega)
// =========================================================================
const serveAndSyncFiles = async (req, res, next) => {
    try {
        const subPath = req.path; // e.g. /doctors/doc-123.jpg
        const localPath = path.join(__dirname, '..', 'public', 'uploads', subPath);
        const folderDir = path.dirname(localPath);
        const cleanDbPath = `/uploads${subPath}`.replace(/\\/g, '/');

        // 1. Agar laptop/server ke disk par file pehle se hai -> Wahi se serve karo
        if (fs.existsSync(localPath) && fs.lstatSync(localPath).isFile()) {
            return res.sendFile(localPath);
        }

        // 2. Agar disk par nahi hai -> Pehle MongoDB Backup se dhoondo
        const backup = await FileBackup.findOne({
            $or: [
                { filePath: cleanDbPath },
                { fileName: path.basename(subPath) }
            ]
        }).lean();

        if (backup && backup.fileData) {
            if (!fs.existsSync(folderDir)) fs.mkdirSync(folderDir, { recursive: true });
            fs.writeFileSync(localPath, backup.fileData.buffer || backup.fileData);

            res.setHeader('Content-Type', backup.mimeType || 'image/jpeg');
            return res.sendFile(localPath);
        }

        // 3. Agar Localhost par chal raha hai aur MongoDB me bhi nahi mili -> Render se live download karo
        if (process.env.NODE_ENV === 'development' || !process.env.RENDER) {
            try {
                const remoteUrl = `${LIVE_RENDER_URL}/public/uploads${subPath}`;
                const response = await axios.get(remoteUrl, { responseType: 'arraybuffer', timeout: 4000 });

                if (response.data) {
                    if (!fs.existsSync(folderDir)) fs.mkdirSync(folderDir, { recursive: true });
                    fs.writeFileSync(localPath, Buffer.from(response.data));
                    console.log(`\x1b[32m[Auto-Sync Render -> Local]: Saved ${subPath}\x1b[0m`);
                    return res.sendFile(localPath);
                }
            } catch (netErr) {
                // Remote par bhi nahi mili
            }
        }

        next();
    } catch (err) {
        next();
    }
};
// =========================================================================

module.exports = { backupUploadedFilesToMongo, serveAndSyncFiles };