
const express = require('express');
const router = express.Router();

const {
    authenticateToken
} = require('../middlewares/authMiddleware');

const checkResultAccess =
    require('../middlewares/resultMiddleware').checkResultAccess;

const ctrl = require('../controllers/studentTestController');
const mainCtrl = require('../controllers/testController');

const dashboardController =
    require('../controllers/dashboardController');

// Validate all required handlers.
const requiredHandlers = {
    authenticateToken,
    checkResultAccess,
    getStudentDashboard: dashboardController.getStudentDashboard,
    getStudentTests: mainCtrl.getStudentTests,
    getStudentAllTests: ctrl.getStudentAllTests,
    getStudentTestSchedule: ctrl.getStudentTestSchedule,
    getStudentTestResults: ctrl.getStudentTestResults,
    getStudentTestById: mainCtrl.getStudentTestById,
    startStudentTest: ctrl.startStudentTest,
    saveTestAnswers: ctrl.saveTestAnswers,
    submitTest: mainCtrl.submitTest
};

for (const [name, handler] of Object.entries(requiredHandlers)) {
    if (typeof handler !== 'function') {
        throw new TypeError(
            `studentTestRoutes.js: ${name} is not a function. Check its controller export.`
        );
    }
}

// Student dashboard.
router.get(
    '/dashboard',
    authenticateToken,
    dashboardController.getStudentDashboard
);

// Student tests.
router.get(
    '/tests',
    authenticateToken,
    mainCtrl.getStudentTests
);

router.get(
    '/all-tests',
    authenticateToken,
    ctrl.getStudentAllTests
);

router.get(
    '/test-schedule',
    authenticateToken,
    ctrl.getStudentTestSchedule
);

router.get(
    '/test-results',
    authenticateToken,
    checkResultAccess,
    ctrl.getStudentTestResults
);

// Timed test attempts.
router.post(
    '/tests/:id/start',
    authenticateToken,
    ctrl.startStudentTest
);

router.put(
    '/tests/:id/answers',
    authenticateToken,
    ctrl.saveTestAnswers
);

// Test details and submission.
router.get(
    '/tests/:id',
    authenticateToken,
    mainCtrl.getStudentTestById
);

router.post(
    '/tests/:id/submit',
    authenticateToken,
    mainCtrl.submitTest
);

module.exports = router;
