const router = require('express').Router();
const { protect } = require('../../../middleware/authMiddleware');
const { lockerUpload } = require('../../../middleware/multer');
const { 
    checkLockerPinStatus,
    setupLockerPin,
    verifyLockerPin, 
    changeLockerPin,
    resetLockerPin,
    createFolder, 
    uploadFile, 
    getLockerContent, 
    renameItem, 
    deleteItem, 
    addMorePages ,
    searchLocker,
        moveLockerItem,
        deleteSinglePage,
          getFolderPath,
    getSingleItemDetails
} = require('../../../controllers/user/others/HealthLocker');

// Base Route Prefix: /api/user/locker

// --- Security / Authentication Credentials ---
router.get('/pin-status', protect('user'), checkLockerPinStatus);         // Check if a PIN is already configured
router.post('/setup-pin', protect('user'), setupLockerPin);              // Configure locker PIN for the first time
router.post('/verify-pin', protect('user'), verifyLockerPin);            // Unlock using PIN
router.patch('/change-pin', protect('user'), changeLockerPin);           // Update current PIN
router.patch('/reset-pin', protect('user'), resetLockerPin);             // Reset forgotten PIN via account password

// --- Content Directory ---
router.get('/content', protect('user'), getLockerContent); 

// --- Create Folder or File ---
router.post('/create-folder', protect('user'), createFolder);
router.post('/upload-file', protect('user'), lockerUpload.array('images', 10), uploadFile);

// --- Edit & Delete ---
router.patch('/rename/:id', protect('user'), renameItem);
router.delete('/delete/:id', protect('user'), deleteItem);

// --- File Modifiers ---
router.put('/add-pages/:id', protect('user'), lockerUpload.array('images', 10), addMorePages);

// Search
router.get('/search', protect('user'), searchLocker);

// Structural Modifications
router.patch('/move', protect('user'), moveLockerItem);

// Single Resource Edit
router.patch('/delete-page', protect('user'), deleteSinglePage);

// Purely Additive Routes
router.get('/folder-path/:folderId', protect('user'), getFolderPath);       // Breadcrumbs path retrieve karne ke liye
router.get('/details/:id', protect('user'), getSingleItemDetails);          // Single item information retrieval ke liye

module.exports = router;