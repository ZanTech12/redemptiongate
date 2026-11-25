
const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// ============================================================
// HELPERS
// ============================================================

const isValidId = (id) => {
    const parsed = parseInt(id, 10);
    return Number.isInteger(parsed) && parsed > 0;
};

const getStudentId = (req) => parseInt(req.user.id, 10);

const getTestQuestions = (test) => {
    return Array.isArray(test.questions) ? test.questions : [];
};

const getRemainingSeconds = (expiresAt) => {
    return Math.max(
        0,
        Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000)
    );
};

const populateTestRelations = async (tests) => {
    if (!tests || tests.length === 0) return [];

    const classIds = [...new Set(tests.map(t => t.classId).filter(Boolean))];
    const subjectIds = [...new Set(tests.map(t => t.subjectId).filter(Boolean))];

    const [classes, subjects] = await Promise.all([
        prisma.class.findMany({
            where: { id: { in: classIds } }
        }),
        prisma.subject.findMany({
            where: { id: { in: subjectIds } }
        })
    ]);

    const classMap = new Map(classes.map(c => [c.id, c]));
    const subjectMap = new Map(subjects.map(s => [s.id, s]));

    return tests.map(t => ({
        ...t,
        classId: t.classId
            ? { ...(classMap.get(t.classId) || {}), _id: t.classId }
            : null,
        subjectId: t.subjectId
            ? { ...(subjectMap.get(t.subjectId) || {}), _id: t.subjectId }
            : null
    }));
};

const getStudentAndTest = async (req) => {
    const tenantFilter = getTenantFilter(req);
    const studentId = getStudentId(req);
    const testId = parseInt(req.params.id, 10);

    if (!isValidId(studentId) || !isValidId(testId)) {
        throw new Error('INVALID_ID');
    }

    const [student, test] = await Promise.all([
        prisma.student.findFirst({
            where: {
                ...tenantFilter,
                id: studentId,
                isDeleted: false
            }
        }),
        prisma.test.findFirst({
            where: {
                ...tenantFilter,
                id: testId
            }
        })
    ]);

    return { tenantFilter, student, test, studentId, testId };
};

const validateStudentTestAccess = (student, test) => {
    if (!student || !student.classId) {
        return 'Student or student class not found';
    }

    if (!test) {
        return 'Test not found';
    }

    if (student.classId !== test.classId) {
        return 'This test is not assigned to your class';
    }

    if (!test.isActive) {
        return 'This test is not active';
    }

    const now = new Date();

    if (now < new Date(test.startDate)) {
        return 'This test has not started yet';
    }

    if (now > new Date(test.endDate)) {
        return 'This test has expired';
    }

    return null;
};

// ============================================================
// STUDENT TEST RESULTS
// ============================================================

exports.getStudentTestResults = async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Student role required.'
            });
        }

        if (!isValidId(req.user.id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid user ID.'
            });
        }

        const studentId = getStudentId(req);

        const student = await prisma.student.findFirst({
            where: {
                ...getTenantFilter(req),
                id: studentId,
                isDeleted: false
            },
            select: {
                testResults: true
            }
        });

        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }

        const testResults = Array.isArray(student.testResults)
            ? student.testResults
            : [];

        if (testResults.length === 0) {
            return res.json({
                success: true,
                data: []
            });
        }

        const studentTestIds = testResults
            .map(r => parseInt(r.testId, 10))
            .filter(isValidId);

        const publishedTests = await prisma.test.findMany({
            where: {
                ...getTenantFilter(req),
                id: { in: studentTestIds },
                resultsPublished: true
            }
        });

        if (publishedTests.length === 0) {
            return res.json({
                success: true,
                data: []
            });
        }

        const populatedTests = await populateTestRelations(publishedTests);

        const publishedTestData = new Map(
            populatedTests.map(test => [test.id, test])
        );

        const detailedResults = testResults
            .filter(result =>
                publishedTestData.has(parseInt(result.testId, 10))
            )
            .map(result => ({
                ...result,
                test: publishedTestData.get(parseInt(result.testId, 10))
            }));

        return res.json({
            success: true,
            data: detailedResults,
            resultSchedule: req.resultSchedule || null
        });

    } catch (error) {
        console.error('getStudentTestResults error:', error);

        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// ============================================================
// STUDENT TEST SCHEDULE
// ============================================================

exports.getStudentTestSchedule = async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Student role required.'
            });
        }

        if (!isValidId(req.user.id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid user ID.'
            });
        }

        const student = await prisma.student.findFirst({
            where: {
                ...getTenantFilter(req),
                id: getStudentId(req),
                isDeleted: false
            }
        });

        if (!student || !student.classId) {
            return res.status(404).json({
                success: false,
                message: 'Student class not found'
            });
        }

        const allTests = await prisma.test.findMany({
            where: {
                ...getTenantFilter(req),
                classId: student.classId
            },
            orderBy: {
                startDate: 'asc'
            }
        });

        const populatedTests = await populateTestRelations(allTests);
        const now = new Date();

        const testResults = Array.isArray(student.testResults)
            ? student.testResults
            : [];

        const processedTests = populatedTests.map(test => {
            const startDate = new Date(test.startDate);
            const endDate = new Date(test.endDate);

            let status;
            let statusText;
            let timeRemaining = '';

            if (now < startDate) {
                status = 'upcoming';
                statusText = 'Upcoming';

                const diff = startDate - now;
                const days = Math.floor(diff / 86400000);
                const hours = Math.floor(
                    (diff % 86400000) / 3600000
                );

                timeRemaining = days > 0
                    ? `Starts in ${days} day(s)`
                    : `Starts in ${hours} hour(s)`;

            } else if (now >= startDate && now <= endDate) {
                status = 'active';
                statusText = 'Available Now';

                const diff = endDate - now;
                const hours = Math.floor(diff / 3600000);

                timeRemaining = `${hours} hour(s) remaining`;

            } else {
                status = 'expired';
                statusText = 'Expired';
                timeRemaining = 'Ended';
            }

            const hasTakenTest = testResults.some(
                result => parseInt(result.testId, 10) === test.id
            );

            return {
                ...test,
                _id: test.id,
                status,
                statusText,
                timeRemaining,
                hasTakenTest,
                canTake: status === 'active' && !hasTakenTest
            };
        });

        return res.json({
            success: true,
            data: processedTests
        });

    } catch (error) {
        console.error('getStudentTestSchedule error:', error);

        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// ============================================================
// STUDENT ALL TESTS
// ============================================================

exports.getStudentAllTests = async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Student role required.'
            });
        }

        if (!isValidId(req.user.id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid user ID.'
            });
        }

        const student = await prisma.student.findFirst({
            where: {
                ...getTenantFilter(req),
                id: getStudentId(req),
                isDeleted: false
            }
        });

        if (!student || !student.classId) {
            return res.status(404).json({
                success: false,
                message: 'Student class not found'
            });
        }

        const tests = await prisma.test.findMany({
            where: {
                ...getTenantFilter(req),
                classId: student.classId
            },
            orderBy: {
                startDate: 'asc'
            }
        });

        const populatedTests = await populateTestRelations(tests);
        const now = new Date();

        const testResults = Array.isArray(student.testResults)
            ? student.testResults
            : [];

        const processedTests = populatedTests.map(test => {
            const startDate = new Date(test.startDate);
            const endDate = new Date(test.endDate);

            const status = now < startDate
                ? 'upcoming'
                : now <= endDate
                    ? 'active'
                    : 'expired';

            const hasTakenTest = testResults.some(
                result => parseInt(result.testId, 10) === test.id
            );

            return {
                ...test,
                _id: test.id,
                status,
                hasTakenTest
            };
        });

        return res.json({
            success: true,
            data: processedTests
        });

    } catch (error) {
        console.error('getStudentAllTests error:', error);

        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// ============================================================
// START / RESUME TIMED STUDENT TEST
// POST /student/tests/:id/start
// ============================================================

exports.startStudentTest = async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Student role required.'
            });
        }

        const {
            tenantFilter,
            student,
            test,
            studentId,
            testId
        } = await getStudentAndTest(req);

        if (!student || !test) {
            return res.status(404).json({
                success: false,
                message: !student ? 'Student not found' : 'Test not found'
            });
        }

        const accessError = validateStudentTestAccess(student, test);

        if (accessError) {
            return res.status(403).json({
                success: false,
                message: accessError
            });
        }

        const results = Array.isArray(student.testResults)
            ? student.testResults
            : [];

        if (results.some(r => parseInt(r.testId, 10) === testId)) {
            return res.status(403).json({
                success: false,
                message: 'You have already taken this test'
            });
        }

        const duration = parseInt(test.duration, 10);

        if (!Number.isFinite(duration) || duration <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid test duration configured by administrator'
            });
        }

        const existingAttempt = await prisma.testAttempt.findFirst({
            where: {
                ...tenantFilter,
                studentId,
                testId
            }
        });

        if (existingAttempt) {
            if (existingAttempt.status === 'submitted') {
                return res.status(403).json({
                    success: false,
                    message: 'This test has already been submitted'
                });
            }

            const remainingSeconds = getRemainingSeconds(
                existingAttempt.expiresAt
            );

            if (remainingSeconds <= 0) {
                return res.status(403).json({
                    success: false,
                    message: 'Test time has expired. Please submit your test.',
                    expired: true,
                    attemptId: existingAttempt.id,
                    answers: existingAttempt.answers || []
                });
            }

            return res.json({
                success: true,
                resumed: true,
                message: 'Existing test attempt resumed',
                data: {
                    attemptId: existingAttempt.id,
                    testId,
                    startedAt: existingAttempt.startedAt,
                    expiresAt: existingAttempt.expiresAt,
                    duration,
                    remainingSeconds,
                    answers: existingAttempt.answers || [],
                    status: existingAttempt.status
                }
            });
        }

        const now = new Date();
        const expiresAt = new Date(
            now.getTime() + duration * 60 * 1000
        );

        let attempt;

        try {
            attempt = await prisma.testAttempt.create({
                data: {
                    adminId: student.adminId,
                    studentId,
                    testId,
                    startedAt: now,
                    expiresAt,
                    status: 'in_progress',
                    answers: []
                }
            });
        } catch (createError) {
            // Handle simultaneous start requests safely.
            if (createError.code === 'P2002') {
                attempt = await prisma.testAttempt.findFirst({
                    where: {
                        ...tenantFilter,
                        studentId,
                        testId
                    }
                });

                if (!attempt) throw createError;
            } else {
                throw createError;
            }
        }

        const remainingSeconds = getRemainingSeconds(attempt.expiresAt);

        return res.status(201).json({
            success: true,
            resumed: false,
            message: 'Test started successfully',
            data: {
                attemptId: attempt.id,
                testId,
                startedAt: attempt.startedAt,
                expiresAt: attempt.expiresAt,
                duration,
                remainingSeconds,
                answers: attempt.answers || [],
                status: attempt.status
            }
        });

    } catch (error) {
        console.error('startStudentTest error:', error);

        if (error.message === 'INVALID_ID') {
            return res.status(400).json({
                success: false,
                message: 'Invalid student or test ID'
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Unable to start test',
            error: error.message
        });
    }
};

// ============================================================
// PROGRESSIVE ANSWER SAVING
// PUT /student/tests/:id/answers
// ============================================================

exports.saveTestAnswers = async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Student role required.'
            });
        }

        const { answers } = req.body;

        if (!Array.isArray(answers)) {
            return res.status(400).json({
                success: false,
                message: 'Answers must be an array'
            });
        }

        const {
            tenantFilter,
            student,
            test,
            studentId,
            testId
        } = await getStudentAndTest(req);

        if (!student || !test) {
            return res.status(404).json({
                success: false,
                message: !student ? 'Student not found' : 'Test not found'
            });
        }

        if (student.classId !== test.classId) {
            return res.status(403).json({
                success: false,
                message: 'This test is not assigned to your class'
            });
        }

        const attempt = await prisma.testAttempt.findFirst({
            where: {
                ...tenantFilter,
                studentId,
                testId
            }
        });

        if (!attempt) {
            return res.status(404).json({
                success: false,
                message: 'Test attempt not found. Start the test first.'
            });
        }

        if (attempt.status !== 'in_progress') {
            return res.status(403).json({
                success: false,
                message: 'This test attempt is no longer active'
            });
        }

        const remainingSeconds = getRemainingSeconds(attempt.expiresAt);

        if (remainingSeconds <= 0) {
            return res.status(403).json({
                success: false,
                message: 'Test time has expired',
                expired: true,
                remainingSeconds: 0
            });
        }

        const questions = getTestQuestions(test);

        if (answers.length > questions.length) {
            return res.status(400).json({
                success: false,
                message: 'Answer count exceeds the number of test questions'
            });
        }

        const updateResult = await prisma.testAttempt.updateMany({
            where: {
                id: attempt.id,
                ...tenantFilter,
                studentId,
                testId,
                status: 'in_progress',
                expiresAt: {
                    gt: new Date()
                }
            },
            data: {
                answers
            }
        });

        if (updateResult.count === 0) {
            return res.status(403).json({
                success: false,
                message: 'Test attempt expired or is no longer active',
                expired: true
            });
        }

        const updatedAttempt = await prisma.testAttempt.findFirst({
            where: {
                id: attempt.id,
                ...tenantFilter,
                studentId,
                testId
            }
        });

        return res.json({
            success: true,
            message: 'Answers saved successfully',
            data: {
                attemptId: attempt.id,
                savedAt: updatedAttempt.updatedAt,
                remainingSeconds: getRemainingSeconds(
                    updatedAttempt.expiresAt
                )
            }
        });

    } catch (error) {
        console.error('saveTestAnswers error:', error);

        if (error.message === 'INVALID_ID') {
            return res.status(400).json({
                success: false,
                message: 'Invalid student or test ID'
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Unable to save answers',
            error: error.message
        });
    }
};
