// utils/fileHandler.js
const fs = require('fs');
const path = require('path');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, hasAwsCredentials } = require('../config/s3');

/**
 * Universal File Cleaner (Safe for Localhost, Render Disk, and AWS S3)
 * @param {String} filePathOrUrl - File URL or local relative path
 */
const deleteFile = async (filePathOrUrl) => {
    if (!filePathOrUrl || typeof filePathOrUrl !== 'string') return;

    try {
        // 1. AWS S3 Check: Agar full URL hai aur AWS credentials .env me configured hain
        const isRemoteUrl = filePathOrUrl.startsWith('http://') || filePathOrUrl.startsWith('https://');

        if (isRemoteUrl && hasAwsCredentials) {
            const bucketName = process.env.AWS_S3_BUCKET_NAME;
            if (!bucketName) return;

            const parsedUrl = new URL(filePathOrUrl);
            const s3Key = parsedUrl.pathname.startsWith('/') ? parsedUrl.pathname.slice(1) : parsedUrl.pathname;

            const deleteParams = {
                Bucket: bucketName,
                Key: s3Key
            };

            await s3Client.send(new DeleteObjectCommand(deleteParams));
            console.log(`🗑️ [AWS S3]: Deleted file key: ${s3Key}`);
            return;
        }

        // 2. Local Disk / Render Fallback (Current workflow - 100% Safe)
        const cleanPath = filePathOrUrl.replace(/^public[\\/]/, '');
        const fullLocalPath = path.join(__dirname, '..', cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath);

        if (fs.existsSync(fullLocalPath)) {
            fs.unlink(fullLocalPath, (err) => {
                if (err) {
                    console.error(`❌ Error deleting local file: ${filePathOrUrl}`, err.message);
                } else {
                    console.log(`🗑️ [Disk Storage]: Deleted file: ${filePathOrUrl}`);
                }
            });
        }
    } catch (err) {
        console.error("❌ Delete File Safe Catch:", err.message);
    }
};

module.exports = { deleteFile };