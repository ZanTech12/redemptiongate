
const express = require('express');
const router = express.Router();

const aiLessonNoteController =
    require('../controllers/aiLessonNoteController');

const authenticateToken =
    require('../middlewares/authMiddleware').authenticateToken;

// ============================================================
// AI LESSON NOTE ROUTES
// Admin and teacher accounts
// All routes require authentication
// ============================================================

// ============================================================
// 1. GET AVAILABLE ACADEMIC TERMS
// GET /lesson-notes/terms
// ============================================================

router.get(
    '/lesson-notes/terms',
    authenticateToken,
    (req, res, next) => {
        console.log('[AI LESSON NOTES] Get available terms');
        console.log('User ID:', req.user?.id);
        console.log('User Role:', req.user?.role);

        next();
    },
    aiLessonNoteController.getAvailableTerms
);

// ============================================================
// 2. GET AVAILABLE E-NOTES WEEKS
// GET /lesson-notes/weeks?classId=1&termId=2
// ============================================================

router.get(
    '/lesson-notes/weeks',
    authenticateToken,
    (req, res, next) => {
        console.log('[AI LESSON NOTES] Get available weeks');
        console.log('User ID:', req.user?.id);
        console.log('User Role:', req.user?.role);
        console.log('Admin ID:', req.user?.adminId);
        console.log('Class ID:', req.query.classId);
        console.log('Term ID:', req.query.termId);

        next();
    },
    aiLessonNoteController.getAvailableWeeks
);

// ============================================================
// 3. GENERATE LESSON NOTE USING GROQ AI
// POST /lesson-notes/generate
// ============================================================

router.post(
    '/lesson-notes/generate',
    authenticateToken,
    aiLessonNoteController.generateLessonNote
);

// ============================================================
// 4. GET ALL LESSON NOTES
// GET /lesson-notes
// ============================================================

router.get(
    '/lesson-notes',
    authenticateToken,
    aiLessonNoteController.getLessonNotes
);

// ============================================================
// 5. GET ONE LESSON NOTE
// GET /lesson-notes/:id
// ============================================================

router.get(
    '/lesson-notes/:id',
    authenticateToken,
    aiLessonNoteController.getLessonNote
);

// ============================================================
// 6. UPDATE / EDIT LESSON NOTE
// PUT /lesson-notes/:id
// ============================================================

router.put(
    '/lesson-notes/:id',
    authenticateToken,
    aiLessonNoteController.updateLessonNote
);

// ============================================================
// 7. SAVE COMPLETED LESSON NOTE
// POST /lesson-notes/:id/save
// ============================================================

router.post(
    '/lesson-notes/:id/save',
    authenticateToken,
    aiLessonNoteController.saveLessonNote
);

// ============================================================
// 8. DELETE LESSON NOTE
// DELETE /lesson-notes/:id
// ============================================================

router.delete(
    '/lesson-notes/:id',
    authenticateToken,
    aiLessonNoteController.deleteLessonNote
);

// ============================================================
// EXPORT ROUTER
// ============================================================

module.exports = router;
