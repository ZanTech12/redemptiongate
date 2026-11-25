
const express = require('express');
const router = express.Router();
const multer = require('multer');

const eNoteController = require('../controllers/eNoteController');

const authenticateToken =
    require('../middlewares/authMiddleware').authenticateToken;

// ============================================
// MULTER CONFIGURATION
// ============================================

const storage = multer.memoryStorage();

const upload = multer({
    storage,

    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
            return cb(new Error('Only PDF files are allowed.'));
        }

        cb(null, true);
    },

    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 10
    }
});

// ============================================
// E-NOTES ROUTES
// ============================================

// Student information
router.get(
    '/my-info',
    authenticateToken,
    eNoteController.getMyStudentInfo
);

// Classes for teachers and administrators
router.get(
    '/my-classes',
    authenticateToken,
    eNoteController.getMyClasses
);

// Subjects assigned to teachers or available to admins
router.get(
    '/my-subjects',
    authenticateToken,
    eNoteController.getMySubjects
);

// Students in a class
router.get(
    '/students',
    authenticateToken,
    eNoteController.getStudentsByClass
);

// E-Notes weeks by class, optional termId and subjectId
router.get(
    '/weeks',
    authenticateToken,
    eNoteController.getWeeksByClass
);

// Create E-Notes weeks (admin only; enforced in controller)
router.post(
    '/weeks',
    authenticateToken,
    eNoteController.createWeek
);

// Upload PDF files to an E-Notes week
router.post(
    '/weeks/:weekId/upload',
    authenticateToken,
    upload.array('pdfFiles', 10),
    eNoteController.uploadFiles
);

// Delete an uploaded file
router.delete(
    '/files/:fileId',
    authenticateToken,
    eNoteController.deleteFile
);

// Delete an E-Notes week (admin only; enforced in controller)
router.delete(
    '/weeks/:weekId',
    authenticateToken,
    eNoteController.deleteWeek
);

// ============================================
// MULTER ERROR HANDLER
// ============================================

router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            message: error.code === 'LIMIT_FILE_SIZE'
                ? 'Each PDF file must not exceed 10MB.'
                : error.code === 'LIMIT_FILE_COUNT'
                    ? 'You can upload a maximum of 10 PDF files at once.'
                    : error.message
        });
    }

    if (error.message === 'Only PDF files are allowed.') {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }

    next(error);
});

module.exports = router;
