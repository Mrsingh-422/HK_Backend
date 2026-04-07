const router = require('express').Router();
const { protect } = require('../../../middleware/authMiddleware');
const { lockerUpload } = require('../../../middleware/multer');
const { 
    uploadToLocker, getLockerSummary, getFilesByFolder, 
    deleteRecord, renameFolder, addMorePages 
} = require('../../../controllers/user/others/HealthLocker');

// Base: /api/user/locker

// Create & Upload (Multiple Images Support)
router.post('/upload', protect('user'), lockerUpload.array('images', 10), uploadToLocker);

// Dashboard / Folder List
router.get('/summary', protect('user'), getLockerSummary); 

// Inside Folder View
router.get('/folder/:folderName', protect('user'), getFilesByFolder);

// Manage Folder
router.patch('/rename-folder', protect('user'), renameFolder);

// Manage Files/Pages
router.put('/add-pages/:recordId', protect('user'), lockerUpload.array('images', 10), addMorePages);
router.delete('/delete-record/:id', protect('user'), deleteRecord);

module.exports = router;