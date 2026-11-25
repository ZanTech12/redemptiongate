const express = require('express');
const router = express.Router();

const {
    authenticateToken,
    isTeacherOrAdmin
} = require('../middlewares/authMiddleware');

const ctrl = require('../controllers/testController');

// ==================== ADMIN & TEACHER TEST MANAGEMENT ====================

// Create test
router.post(
    '/',
    authenticateToken,
    isTeacherOrAdmin,
    ctrl.createTest
);

// Get tests accessible to authenticated user
router.get(
    '/',
    authenticateToken,
    ctrl.getTests
);

// Get all tests
router.get(
    '/all',
    authenticateToken,
    ctrl.getAllTests
);

// Get tests created by a specific teacher
router.get(
    '/teacher/:teacherId',
    authenticateToken,
    isTeacherOrAdmin,
    ctrl.getTestsByTeacher
);

// ==================== TEST CRUD ====================

// Get, update and delete a specific test
router.route('/:id')
    .get(
        authenticateToken,
        isTeacherOrAdmin,
        ctrl.getTestById
    )
    .put(
        authenticateToken,
        isTeacherOrAdmin,
        ctrl.updateTest
    )
    .delete(
        authenticateToken,
        isTeacherOrAdmin,
        ctrl.deleteTest
    );

// ==================== RESULTS MANAGEMENT ====================

// Publish test results
router.post(
    '/:testId/publish-results',
    authenticateToken,
    isTeacherOrAdmin,
    ctrl.publishResults
);

// Unpublish test results
router.post(
    '/:testId/unpublish-results',
    authenticateToken,
    isTeacherOrAdmin,
    ctrl.unpublishResults
);

// ==================== STUDENT TEST ATTEMPTS ====================
// Student test-taking routes are registered in studentTestRoutes.js
// and mounted separately in api.js.
//
// These include:
// - Start test attempt
// - Get test with remaining duration
// - Save answers progressively
// - Submit test
// - Automatically submit expired attempts

module.exports = router;