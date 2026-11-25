const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// ============================================================
// HELPERS
// ============================================================

// Helper to check for valid Int
const isValidId = (id) => {
    const parsed = parseInt(id, 10);
    return !isNaN(parsed) && parsed > 0;
};

// Safe date conversion
const toDateOrNull = (v) => {
    if (!v) return null;

    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
};

// Safe array conversion
const getArray = (value) => {
    return Array.isArray(value) ? value : [];
};

// Get student
const getStudent = async (tenantFilter, studentId) => {
    return prisma.student.findFirst({
        where: {
            ...tenantFilter,
            id: studentId,
            isDeleted: { not: true }
        }
    });
};

// Get test
const getTest = async (tenantFilter, testId) => {
    return prisma.test.findFirst({
        where: {
            ...tenantFilter,
            id: testId
        }
    });
};

// Get test attempt
const getTestAttempt = async (
    tenantFilter,
    studentId,
    testId
) => {
    return prisma.testAttempt.findFirst({
        where: {
            ...tenantFilter,
            studentId,
            testId
        }
    });
};

// Calculate test score
const calculateTestScore = (questions, answers) => {
    const testQuestions = getArray(questions);
    const submittedAnswers = getArray(answers);

    let score = 0;

    const totalQuestions = testQuestions.length;

    for (let i = 0; i < totalQuestions; i++) {
        const studentAnswer = submittedAnswers[i];
        const correctAnswer = testQuestions[i]?.correctAnswer;

        if (
            studentAnswer !== undefined &&
            studentAnswer !== null &&
            studentAnswer === correctAnswer
        ) {
            score++;
        }
    }

    const percentage = totalQuestions > 0
        ? Math.round((score / totalQuestions) * 100)
        : 0;

    return {
        score,
        totalQuestions,
        percentage
    };
};

// Sanitize questions before returning to students
const sanitizeQuestions = (questions) => {
    return getArray(questions).map(question => {
        if (!question || typeof question !== 'object') {
            return question;
        }

        const {
            correctAnswer,
            explanation,
            ...safeQuestion
        } = question;

        return safeQuestion;
    });
};

// Helper to populate relations
// Teacher fetch uses select — no password hashes
const populateTestRelations = async (tests) => {
    if (!tests || tests.length === 0) return [];

    const testArray = Array.isArray(tests) ? tests : [tests];

    const classIds = [
        ...new Set(
            testArray.map(t => t.classId).filter(Boolean)
        )
    ];

    const subjectIds = [
        ...new Set(
            testArray.map(t => t.subjectId).filter(Boolean)
        )
    ];

    const creatorIds = [
        ...new Set(
            testArray.map(t => t.createdById).filter(Boolean)
        )
    ];

    const [classes, subjects, teachers] = await Promise.all([
        prisma.class.findMany({
            where: {
                id: { in: classIds }
            }
        }),

        prisma.subject.findMany({
            where: {
                id: { in: subjectIds }
            }
        }),

        prisma.teacher.findMany({
            where: {
                id: { in: creatorIds }
            },
            select: {
                id: true,
                adminId: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                qualification: true,
                experience: true,
                subjects: true
            }
        })
    ]);

    const classMap = new Map(
        classes.map(c => [c.id, c])
    );

    const subjectMap = new Map(
        subjects.map(s => [s.id, s])
    );

    const teacherMap = new Map(
        teachers.map(t => [t.id, t])
    );

    const mapped = testArray.map(t => ({
        ...t,
        _id: t.id,

        classId: t.classId
            ? {
                ...classMap.get(t.classId),
                _id: t.classId
            }
            : null,

        subjectId: t.subjectId
            ? {
                ...subjectMap.get(t.subjectId),
                _id: t.subjectId
            }
            : null,

        createdBy: t.createdById
            ? {
                ...teacherMap.get(t.createdById),
                _id: t.createdById
            }
            : null
    }));

    return Array.isArray(tests)
        ? mapped
        : mapped[0];
};

// Resolve teacher
const resolveCreatorTeacherId = async (
    req,
    tenantFilter,
    requestedTeacherId
) => {
    if (req.user.role === 'teacher') {
        return parseInt(req.user.id, 10);
    }

    const candidate = isValidId(requestedTeacherId)
        ? parseInt(requestedTeacherId, 10)
        : null;

    let teacherRow = candidate
        ? await prisma.teacher.findFirst({
            where: {
                ...tenantFilter,
                id: candidate
            }
        })
        : null;

    if (!teacherRow) {
        teacherRow = await prisma.teacher.findFirst({
            where: tenantFilter
        });
    }

    return teacherRow ? teacherRow.id : null;
};

// ============================================================
// CREATE
// ============================================================

exports.createTest = async (req, res) => {
    try {
        const {
            title,
            classId,
            subjectId,
            duration,
            startDate,
            endDate,
            passMark,
            instructions,
            questions,
            teacherId
        } = req.body;

        const tenantFilter = getTenantFilter(req);

        if (!title || !String(title).trim()) {
            return res.status(400).json({
                success: false,
                message: 'Title is required'
            });
        }

        if (
            !isValidId(classId) ||
            !isValidId(subjectId)
        ) {
            return res.status(400).json({
                success: false,
                message: 'Invalid class or subject ID format.'
            });
        }

        const start = toDateOrNull(startDate);
        const end = toDateOrNull(endDate);

        if (!start || !end) {
            return res.status(400).json({
                success: false,
                message: 'Valid start and end dates are required'
            });
        }

        if (end <= start) {
            return res.status(400).json({
                success: false,
                message: 'End date must be after the start date'
            });
        }

        const parsedClassId = parseInt(classId, 10);
        const parsedSubjectId = parseInt(subjectId, 10);

        if (req.user.role === 'teacher') {
            const hasAssignment =
                await prisma.teacherAssignment.findFirst({
                    where: {
                        ...tenantFilter,
                        teacherId: parseInt(req.user.id, 10),
                        classId: parsedClassId,
                        subjectId: parsedSubjectId,
                        isActive: true
                    }
                });

            if (!hasAssignment) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied.'
                });
            }
        }

        const creatorTeacherId =
            await resolveCreatorTeacherId(
                req,
                tenantFilter,
                teacherId
            );

        if (!creatorTeacherId) {
            return res.status(400).json({
                success: false,
                message: 'No valid teacher found to attribute this test to'
            });
        }

        const parsedDuration = isValidId(duration)
            ? parseInt(duration, 10)
            : 60;

        if (parsedDuration <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Test duration must be greater than zero.'
            });
        }

        const parsedPassMark = isValidId(passMark)
            ? parseInt(passMark, 10)
            : 50;

        if (parsedPassMark < 0 || parsedPassMark > 100) {
            return res.status(400).json({
                success: false,
                message: 'Pass mark must be between 0 and 100.'
            });
        }

        const createData = {
            ...tenantFilter,
            title: String(title).trim(),
            classId: parsedClassId,
            subjectId: parsedSubjectId,
            duration: parsedDuration,
            startDate: start,
            endDate: end,
            passMark: parsedPassMark,
            questions: Array.isArray(questions)
                ? questions
                : [],
            createdById: creatorTeacherId
        };

        if (typeof instructions === 'string') {
            createData.instructions = instructions;
        }

        const newTest = await prisma.test.create({
            data: createData
        });

        const populatedTest =
            await populateTestRelations(newTest);

        res.status(201).json({
            success: true,
            message: 'Test created successfully',
            data: populatedTest
        });

    } catch (error) {
        console.error('createTest error:', error);

        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// ============================================================
// READ
// ============================================================

exports.getTests = async (req, res) => {
    try {
        const { classId, subjectId } = req.query;

        const query = {
            ...getTenantFilter(req),
            isActive: true
        };

        if (classId && isValidId(classId)) {
            query.classId = parseInt(classId, 10);
        }

        if (subjectId && isValidId(subjectId)) {
            query.subjectId = parseInt(subjectId, 10);
        }

        let tests;

        if (req.user.role === 'teacher') {
            const teacherId = parseInt(req.user.id, 10);

            const assignments =
                await prisma.teacherAssignment.findMany({
                    where: {
                        ...getTenantFilter(req),
                        teacherId,
                        isActive: true
                    }
                });

            const orConditions = assignments.map(a => ({
                classId: a.classId,
                subjectId: a.subjectId
            }));

            tests = await prisma.test.findMany({
                where: {
                    ...query,
                    OR: [
                        { createdById: teacherId },
                        ...orConditions
                    ]
                },
                orderBy: {
                    createdAt: 'desc'
                }
            });

        } else {
            tests = await prisma.test.findMany({
                where: query,
                orderBy: {
                    createdAt: 'desc'
                }
            });
        }

        res.json({
            success: true,
            data: await populateTestRelations(tests)
        });

    } catch (error) {
        console.error('getTests error:', error);

        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

exports.getAllTests = async (req, res) => {
    try {
        if (
            !['admin', 'superadmin', 'teacher']
                .includes(req.user.role)
        ) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Admin or Teacher role required.'
            });
        }

        const tenantFilter = getTenantFilter(req);

        if (req.user.role === 'teacher') {
            const assignments =
                await prisma.teacherAssignment.findMany({
                    where: {
                        ...tenantFilter,
                        teacherId: parseInt(req.user.id, 10),
                        isActive: true
                    }
                });

            const orConditions = assignments.map(a => ({
                classId: a.classId,
                subjectId: a.subjectId
            }));

            const query = {
                ...tenantFilter,
                isActive: true,
                OR: [
                    {
                        createdById: parseInt(req.user.id, 10)
                    },
                    ...orConditions
                ]
            };

            if (orConditions.length === 0) {
                query.OR = [
                    {
                        createdById: parseInt(req.user.id, 10)
                    }
                ];
            }

            const tests = await prisma.test.findMany({
                where: query,
                orderBy: {
                    createdAt: 'desc'
                }
            });

            return res.json({
                success: true,
                data: await populateTestRelations(tests)
            });
        }

        const tests = await prisma.test.findMany({
            where: tenantFilter,
            orderBy: {
                createdAt: 'desc'
            }
        });

        res.json({
            success: true,
            data: await populateTestRelations(tests)
        });

    } catch (error) {
        console.error('getAllTests error:', error);

        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

exports.getTestsByTeacher = async (req, res) => {
    try {
        if (
            req.user.role === 'teacher' &&
            parseInt(req.user.id, 10) !==
            parseInt(req.params.teacherId, 10)
        ) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to view these tests'
            });
        }

        if (!isValidId(req.params.teacherId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid teacher ID format.'
            });
        }

        const teacherId = parseInt(req.params.teacherId, 10);
        const tenantFilter = getTenantFilter(req);

        const assignments =
            await prisma.teacherAssignment.findMany({
                where: {
                    ...tenantFilter,
                    teacherId,
                    isActive: true
                }
            });

        const orConditions = assignments.map(a => ({
            classId: a.classId,
            subjectId: a.subjectId
        }));

        const query = {
            ...tenantFilter,
            isActive: true,
            OR: [
                { createdById: teacherId },
                ...orConditions
            ]
        };

        if (orConditions.length === 0) {
            query.OR = [
                { createdById: teacherId }
            ];
        }

        const tests = await prisma.test.findMany({
            where: query,
            orderBy: {
                createdAt: 'desc'
            }
        });

        res.json({
            success: true,
            data: await populateTestRelations(tests)
        });

    } catch (error) {
        console.error('getTestsByTeacher error:', error);

        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

exports.getTestById = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid test ID format.'
            });
        }

        const testId = parseInt(req.params.id, 10);
        const tenantFilter = getTenantFilter(req);

        const test = await prisma.test.findFirst({
            where: {
                ...tenantFilter,
                id: testId
            }
        });

        if (!test) {
            return res.status(404).json({
                success: false,
                message: 'Test not found'
            });
        }

        if (req.user.role === 'teacher') {
            const isAssigned =
                await prisma.teacherAssignment.findFirst({
                    where: {
                        ...tenantFilter,
                        teacherId: parseInt(req.user.id, 10),
                        classId: test.classId,
                        subjectId: test.subjectId,
                        isActive: true
                    }
                });

            const isCreator =
                test.createdById === parseInt(req.user.id, 10);

            if (!isAssigned && !isCreator) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied.'
                });
            }
        }

        res.json({
            success: true,
            data: await populateTestRelations(test)
        });

    } catch (error) {
        console.error('getTestById error:', error);

        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// ============================================================
// UPDATE / DELETE
// ============================================================

exports.updateTest = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid test ID format.'
            });
        }

        const testId = parseInt(req.params.id, 10);
        const tenantFilter = getTenantFilter(req);

        const test = await prisma.test.findFirst({
            where: {
                ...tenantFilter,
                id: testId
            }
        });

        if (!test) {
            return res.status(404).json({
                success: false,
                message: 'Test not found'
            });
        }

        const {
            title,
            classId,
            subjectId,
            duration,
            startDate,
            endDate,
            passMark,
            instructions,
            questions
        } = req.body;

        if (req.user.role === 'teacher') {
            const isAssigned =
                await prisma.teacherAssignment.findFirst({
                    where: {
                        ...tenantFilter,
                        teacherId: parseInt(req.user.id, 10),
                        classId: test.classId,
                        subjectId: test.subjectId,
                        isActive: true
                    }
                });

            const isCreator =
                test.createdById === parseInt(req.user.id, 10);

            if (!isAssigned && !isCreator) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied.'
                });
            }

            if (
                classId !== undefined ||
                subjectId !== undefined
            ) {
                const newClassId = isValidId(classId)
                    ? parseInt(classId, 10)
                    : test.classId;

                const newSubjectId = isValidId(subjectId)
                    ? parseInt(subjectId, 10)
                    : test.subjectId;

                const stillAssigned =
                    await prisma.teacherAssignment.findFirst({
                        where: {
                            ...tenantFilter,
                            teacherId: parseInt(req.user.id, 10),
                            classId: newClassId,
                            subjectId: newSubjectId,
                            isActive: true
                        }
                    });

                if (!stillAssigned) {
                    return res.status(403).json({
                        success: false,
                        message: 'You are not assigned to this class and subject'
                    });
                }
            }
        }

        const updateData = {};

        if (title !== undefined) {
            updateData.title = String(title).trim();
        }

        if (isValidId(classId)) {
            updateData.classId = parseInt(classId, 10);
        }

        if (isValidId(subjectId)) {
            updateData.subjectId = parseInt(subjectId, 10);
        }

        if (isValidId(duration)) {
            updateData.duration = parseInt(duration, 10);
        }

        if (isValidId(passMark)) {
            updateData.passMark = parseInt(passMark, 10);
        }

        if (startDate !== undefined) {
            const s = toDateOrNull(startDate);

            if (!s) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid start date format'
                });
            }

            updateData.startDate = s;
        }

        if (endDate !== undefined) {
            const e = toDateOrNull(endDate);

            if (!e) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid end date format'
                });
            }

            updateData.endDate = e;
        }

        if (Array.isArray(questions)) {
            updateData.questions = questions;
        }

        if (typeof instructions === 'string') {
            updateData.instructions = instructions;
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid fields provided to update'
            });
        }

        if (
            updateData.startDate &&
            updateData.endDate &&
            updateData.endDate <= updateData.startDate
        ) {
            return res.status(400).json({
                success: false,
                message: 'End date must be after the start date'
            });
        }

        const updated = await prisma.test.updateMany({
            where: {
                ...tenantFilter,
                id: testId
            },
            data: updateData
        });

        if (updated.count !== 1) {
            return res.status(404).json({
                success: false,
                message: 'Test not found'
            });
        }

        const updatedTest = await prisma.test.findFirst({
            where: {
                ...tenantFilter,
                id: testId
            }
        });

        res.json({
            success: true,
            message: 'Test updated successfully',
            data: await populateTestRelations(updatedTest)
        });

    } catch (error) {
        console.error('updateTest error:', error);

        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

exports.deleteTest = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid test ID format.'
            });
        }

        const testId = parseInt(req.params.id, 10);
        const tenantFilter = getTenantFilter(req);

        const test = await prisma.test.findFirst({
            where: {
                ...tenantFilter,
                id: testId
            }
        });

        if (!test) {
            return res.status(404).json({
                success: false,
                message: 'Test not found'
            });
        }

        if (req.user.role === 'teacher') {
            const isAssigned =
                await prisma.teacherAssignment.findFirst({
                    where: {
                        ...tenantFilter,
                        teacherId: parseInt(req.user.id, 10),
                        classId: test.classId,
                        subjectId: test.subjectId,
                        isActive: true
                    }
                });

            const isCreator =
                test.createdById === parseInt(req.user.id, 10);

            if (!isAssigned && !isCreator) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied.'
                });
            }
        }

        await prisma.test.updateMany({
            where: {
                ...tenantFilter,
                id: testId
            },
            data: {
                isActive: false
            }
        });

        res.json({
            success: true,
            message: 'Test deleted successfully'
        });

    } catch (error) {
        console.error('deleteTest error:', error);

        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// ============================================================
// PUBLISH / UNPUBLISH
// ============================================================

exports.publishResults = async (req, res) => {
    try {
        if (!isValidId(req.params.testId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid test ID format.'
            });
        }

        const testId = parseInt(req.params.testId, 10);
        const tenantFilter = getTenantFilter(req);

        const test = await prisma.test.findFirst({
            where: {
                ...tenantFilter,
                id: testId
            }
        });

        if (!test) {
            return res.status(404).json({
                success: false,
                message: 'Test not found'
            });
        }

        if (req.user.role === 'teacher') {
            const isAssigned =
                await prisma.teacherAssignment.findFirst({
                    where: {
                        ...tenantFilter,
                        teacherId: parseInt(req.user.id, 10),
                        classId: test.classId,
                        subjectId: test.subjectId,
                        isActive: true
                    }
                });

            const isCreator =
                test.createdById === parseInt(req.user.id, 10);

            if (!isAssigned && !isCreator) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied.'
                });
            }
        }

        const updated = await prisma.test.updateMany({
            where: {
                ...tenantFilter,
                id: testId
            },
            data: {
                resultsPublished: true,
                publishedAt: new Date()
            }
        });

        const updatedTest = await prisma.test.findFirst({
            where: {
                ...tenantFilter,
                id: testId
            }
        });

        res.json({
            success: true,
            message: 'Test results have been published successfully.',
            data: {
                testId: updatedTest.id,
                testTitle: updatedTest.title,
                resultsPublished: updatedTest.resultsPublished,
                publishedAt: updatedTest.publishedAt
            }
        });

    } catch (error) {
        console.error('publishResults error:', error);

        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

exports.unpublishResults = async (req, res) => {
    try {
        if (!isValidId(req.params.testId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid test ID format.'
            });
        }

        const testId = parseInt(req.params.testId, 10);
        const tenantFilter = getTenantFilter(req);

        const test = await prisma.test.findFirst({
            where: {
                ...tenantFilter,
                id: testId
            }
        });

        if (!test) {
            return res.status(404).json({
                success: false,
                message: 'Test not found'
            });
        }

        if (req.user.role === 'teacher') {
            const isAssigned =
                await prisma.teacherAssignment.findFirst({
                    where: {
                        ...tenantFilter,
                        teacherId: parseInt(req.user.id, 10),
                        classId: test.classId,
                        subjectId: test.subjectId,
                        isActive: true
                    }
                });

            const isCreator =
                test.createdById === parseInt(req.user.id, 10);

            if (!isAssigned && !isCreator) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied.'
                });
            }
        }

        await prisma.test.updateMany({
            where: {
                ...tenantFilter,
                id: testId
            },
            data: {
                resultsPublished: false,
                publishedAt: null
            }
        });

        const updated = await prisma.test.findFirst({
            where: {
                ...tenantFilter,
                id: testId
            }
        });

        res.json({
            success: true,
            message: 'Test results have been unpublished successfully.',
            data: {
                testId: updated.id,
                testTitle: updated.title,
                resultsPublished: updated.resultsPublished
            }
        });

    } catch (error) {
        console.error('unpublishResults error:', error);

        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// ============================================================
// STUDENT TEST ROUTES
// ============================================================

exports.getStudentTests = async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Student role required.'
            });
        }

        const tenantFilter = getTenantFilter(req);

        if (!isValidId(req.user.id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid user ID.'
            });
        }

        const studentId = parseInt(req.user.id, 10);

        const student = await getStudent(
            tenantFilter,
            studentId
        );

        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'Student not found'
            });
        }

        if (!student.classId) {
            return res.status(404).json({
                success: false,
                message: 'Student class not found'
            });
        }

        const now = new Date();

        const tests = await prisma.test.findMany({
            where: {
                ...tenantFilter,
                classId: student.classId,
                isActive: true,
                startDate: {
                    lte: now
                },
                endDate: {
                    gte: now
                }
            },
            select: {
                id: true,
                title: true,
                classId: true,
                subjectId: true,
                createdById: true,
                duration: true,
                startDate: true,
                endDate: true,
                passMark: true,
                instructions: true,
                resultsPublished: true
            },
            orderBy: {
                startDate: 'asc'
            }
        });

        const populatedTests =
            await populateTestRelations(tests);

        const testResults = getArray(student.testResults);

        const attempts = await prisma.testAttempt.findMany({
            where: {
                ...tenantFilter,
                studentId,
                testId: {
                    in: tests.map(t => t.id)
                }
            }
        });

        const attemptMap = new Map(
            attempts.map(a => [a.testId, a])
        );

        const processedTests = populatedTests.map(test => {
            const hasTakenTest = testResults.some(
                result => parseInt(result.testId, 10) === test.id
            );

            const attempt = attemptMap.get(test.id);

            return {
                ...test,
                hasTakenTest,
                canTake: !hasTakenTest &&
                    (!attempt || attempt.status === 'in_progress'),
                attemptStatus: attempt?.status || null,
                attemptStartedAt: attempt?.startedAt || null,
                attemptExpiresAt: attempt?.expiresAt || null
            };
        });

        res.json({
            success: true,
            data: processedTests
        });

    } catch (error) {
        console.error('getStudentTests error:', error);

        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// ============================================================
// GET STUDENT TEST BY ID
// ============================================================

exports.getStudentTestById = async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Student role required.'
            });
        }

        const tenantFilter = getTenantFilter(req);

        if (
            !isValidId(req.user.id) ||
            !isValidId(req.params.id)
        ) {
            return res.status(400).json({
                success: false,
                message: 'Invalid ID format.'
            });
        }

        const studentId = parseInt(req.user.id, 10);
        const testId = parseInt(req.params.id, 10);

        const student = await getStudent(
            tenantFilter,
            studentId
        );

        if (!student || !student.classId) {
            return res.status(404).json({
                success: false,
                message: 'Student class not found'
            });
        }

        const test = await getTest(
            tenantFilter,
            testId
        );

        if (!test) {
            return res.status(404).json({
                success: false,
                message: 'Test not found'
            });
        }

        const now = new Date();

        if (
            test.classId !== student.classId ||
            !test.isActive ||
            test.startDate > now ||
            test.endDate < now
        ) {
            return res.status(403).json({
                success: false,
                message: 'Test is not available'
            });
        }

        const testResults = getArray(student.testResults);

        if (
            testResults.some(
                r => parseInt(r.testId, 10) === testId
            )
        ) {
            return res.status(403).json({
                success: false,
                message: 'You have already taken this test'
            });
        }

        // Load question set if test has no questions
        if (!getArray(test.questions).length) {
            const questionSet =
                await prisma.questionSet.findFirst({
                    where: {
                        ...tenantFilter,
                        classId: test.classId,
                        subjectId: test.subjectId,
                        isActive: true
                    }
                });

            if (
                questionSet &&
                getArray(questionSet.questions).length > 0
            ) {
                await prisma.test.updateMany({
                    where: {
                        ...tenantFilter,
                        id: testId
                    },
                    data: {
                        questions: questionSet.questions
                    }
                });

                test.questions = questionSet.questions;

            } else {
                return res.status(403).json({
                    success: false,
                    message: 'This test has no questions available. Please contact your teacher.'
                });
            }
        }

        // Hide correct answers from students
        test.questions = sanitizeQuestions(test.questions);

        const populatedTest =
            await populateTestRelations(test);

        res.json({
            success: true,
            data: populatedTest
        });

    } catch (error) {
        console.error('getStudentTestById error:', error);

        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// ============================================================
// START STUDENT TEST
// ============================================================

exports.startStudentTest = async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Student role required.'
            });
        }

        const tenantFilter = getTenantFilter(req);

        if (
            !isValidId(req.user.id) ||
            !isValidId(req.params.id)
        ) {
            return res.status(400).json({
                success: false,
                message: 'Invalid ID format.'
            });
        }

        const studentId = parseInt(req.user.id, 10);
        const testId = parseInt(req.params.id, 10);

        const student = await getStudent(
            tenantFilter,
            studentId
        );

        if (!student || !student.classId) {
            return res.status(404).json({
                success: false,
                message: 'Student not found.'
            });
        }

        const test = await getTest(
            tenantFilter,
            testId
        );

        if (!test) {
            return res.status(404).json({
                success: false,
                message: 'Test not found.'
            });
        }

        const now = new Date();

        if (
            test.classId !== student.classId ||
            !test.isActive ||
            test.startDate > now ||
            test.endDate < now
        ) {
            return res.status(403).json({
                success: false,
                message: 'Test is not available.'
            });
        }

        const testResults = getArray(student.testResults);

        if (
            testResults.some(
                result => parseInt(result.testId, 10) === testId
            )
        ) {
            return res.status(403).json({
                success: false,
                message: 'You have already taken this test.'
            });
        }

        // Ensure test questions exist
        let questions = getArray(test.questions);

        if (questions.length === 0) {
            const questionSet =
                await prisma.questionSet.findFirst({
                    where: {
                        ...tenantFilter,
                        classId: test.classId,
                        subjectId: test.subjectId,
                        isActive: true
                    }
                });

            if (
                questionSet &&
                getArray(questionSet.questions).length > 0
            ) {
                questions = questionSet.questions;

                await prisma.test.updateMany({
                    where: {
                        ...tenantFilter,
                        id: testId
                    },
                    data: {
                        questions
                    }
                });

            } else {
                return res.status(403).json({
                    success: false,
                    message: 'This test has no questions available. Please contact your teacher.'
                });
            }
        }

        // Find existing attempt
        let attempt = await getTestAttempt(
            tenantFilter,
            studentId,
            testId
        );

        if (attempt) {
            if (attempt.status !== 'in_progress') {
                return res.status(403).json({
                    success: false,
                    message: 'This test attempt has already been submitted.'
                });
            }

            if (attempt.expiresAt <= now) {
                return res.status(403).json({
                    success: false,
                    message: 'Your test time has expired.',
                    data: {
                        attemptId: attempt.id,
                        startedAt: attempt.startedAt,
                        expiresAt: attempt.expiresAt,
                        remainingSeconds: 0,
                        answers: attempt.answers || []
                    }
                });
            }

            // Resume existing attempt
            return res.json({
                success: true,
                message: 'Test attempt resumed.',
                data: {
                    attemptId: attempt.id,
                    startedAt: attempt.startedAt,
                    expiresAt: attempt.expiresAt,
                    duration: test.duration,
                    remainingSeconds: Math.max(
                        0,
                        Math.floor(
                            (attempt.expiresAt.getTime() - now.getTime()) / 1000
                        )
                    ),
                    answers: attempt.answers || []
                }
            });
        }

        // Create a new attempt
        const durationMinutes = Math.max(
            1,
            parseInt(test.duration, 10) || 60
        );

        const calculatedExpiresAt = new Date(
            now.getTime() + durationMinutes * 60 * 1000
        );

        // Deadline cannot exceed the test end date
        const expiresAt =
            calculatedExpiresAt > test.endDate
                ? test.endDate
                : calculatedExpiresAt;

        try {
            attempt = await prisma.testAttempt.create({
                data: {
                    ...tenantFilter,
                    studentId,
                    testId,
                    startedAt: now,
                    expiresAt,
                    status: 'in_progress',
                    answers: []
                }
            });

        } catch (createError) {
            // Handle simultaneous start requests
            if (createError.code === 'P2002') {
                attempt = await getTestAttempt(
                    tenantFilter,
                    studentId,
                    testId
                );

                if (
                    attempt &&
                    attempt.status === 'in_progress' &&
                    attempt.expiresAt > new Date()
                ) {
                    const currentTime = new Date();

                    return res.json({
                        success: true,
                        message: 'Test attempt resumed.',
                        data: {
                            attemptId: attempt.id,
                            startedAt: attempt.startedAt,
                            expiresAt: attempt.expiresAt,
                            duration: test.duration,
                            remainingSeconds: Math.max(
                                0,
                                Math.floor(
                                    (attempt.expiresAt.getTime() -
                                    currentTime.getTime()) / 1000
                                )
                            ),
                            answers: attempt.answers || []
                        }
                    });
                }

                return res.status(403).json({
                    success: false,
                    message: 'This test attempt has already been submitted.'
                });
            }

            throw createError;
        }

        res.json({
            success: true,
            message: 'Test started successfully.',
            data: {
                attemptId: attempt.id,
                startedAt: attempt.startedAt,
                expiresAt: attempt.expiresAt,
                duration: durationMinutes,
                remainingSeconds: Math.max(
                    0,
                    Math.floor(
                        (attempt.expiresAt.getTime() - now.getTime()) / 1000
                    )
                ),
                answers: attempt.answers || []
            }
        });

    } catch (error) {
        console.error('startStudentTest error:', error);

        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// ============================================================
// SAVE STUDENT ANSWERS
// ============================================================

exports.saveTestAnswers = async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Student role required.'
            });
        }

        const tenantFilter = getTenantFilter(req);
        const { answers } = req.body;

        if (!Array.isArray(answers)) {
            return res.status(400).json({
                success: false,
                message: 'Answers must be an array.'
            });
        }

        if (
            !isValidId(req.user.id) ||
            !isValidId(req.params.id)
        ) {
            return res.status(400).json({
                success: false,
                message: 'Invalid ID format.'
            });
        }

        const studentId = parseInt(req.user.id, 10);
        const testId = parseInt(req.params.id, 10);

        const student = await getStudent(
            tenantFilter,
            studentId
        );

        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'Student not found.'
            });
        }

        const test = await getTest(
            tenantFilter,
            testId
        );

        if (!test) {
            return res.status(404).json({
                success: false,
                message: 'Test not found.'
            });
        }

        const attempt = await getTestAttempt(
            tenantFilter,
            studentId,
            testId
        );

        if (!attempt) {
            return res.status(403).json({
                success: false,
                message: 'You must start the test before saving answers.'
            });
        }

        if (attempt.status !== 'in_progress') {
            return res.status(403).json({
                success: false,
                message: 'This test attempt has already been submitted.'
            });
        }

        const now = new Date();

        if (now >= attempt.expiresAt) {
            return res.status(403).json({
                success: false,
                message: 'Test time has expired.',
                data: {
                    expiresAt: attempt.expiresAt,
                    remainingSeconds: 0
                }
            });
        }

        const totalQuestions = getArray(test.questions).length;

        if (answers.length > totalQuestions) {
            return res.status(400).json({
                success: false,
                message: 'Invalid answer data.'
            });
        }

        // Save only while the attempt is still active
        const saved = await prisma.testAttempt.updateMany({
            where: {
                ...tenantFilter,
                id: attempt.id,
                studentId,
                testId,
                status: 'in_progress',
                expiresAt: {
                    gt: now
                }
            },
            data: {
                answers
            }
        });

        if (saved.count !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Unable to save answers. Test may have expired or been submitted.'
            });
        }

        res.json({
            success: true,
            message: 'Answers saved successfully.',
            data: {
                attemptId: attempt.id,
                savedAt: now,
                remainingSeconds: Math.max(
                    0,
                    Math.floor(
                        (attempt.expiresAt.getTime() - now.getTime()) / 1000
                    )
                )
            }
        });

    } catch (error) {
        console.error('saveTestAnswers error:', error);

        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// ============================================================
// SUBMIT STUDENT TEST
// ============================================================


exports.submitTest = async (req, res) => {
    try {
        // ========================================================
        // 1. AUTHENTICATION / VALIDATION
        // ========================================================

        if (req.user.role !== 'student') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Student role required.'
            });
        }

        const tenantFilter = getTenantFilter(req);
        const { answers } = req.body;

        if (
            answers !== undefined &&
            !Array.isArray(answers)
        ) {
            return res.status(400).json({
                success: false,
                message: 'Answers must be an array.'
            });
        }

        if (
            !isValidId(req.user.id) ||
            !isValidId(req.params.id)
        ) {
            return res.status(400).json({
                success: false,
                message: 'Invalid ID format.'
            });
        }

        const studentId = parseInt(req.user.id, 10);
        const testId = parseInt(req.params.id, 10);

        console.log('[submitTest] Request received:', {
            studentId,
            testId,
            answersReceived: Array.isArray(answers)
                ? answers.length
                : 0
        });

        // ========================================================
        // 2. GET STUDENT AND TEST
        // ========================================================

        const student = await getStudent(
            tenantFilter,
            studentId
        );

        if (!student || !student.classId) {
            return res.status(404).json({
                success: false,
                message: 'Student not found.'
            });
        }

        const test = await getTest(
            tenantFilter,
            testId
        );

        if (!test) {
            return res.status(404).json({
                success: false,
                message: 'Test not found.'
            });
        }

        if (test.classId !== student.classId) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to take this test.'
            });
        }

        // ========================================================
        // 3. GET EXISTING ATTEMPT
        // ========================================================

        const attempt = await getTestAttempt(
            tenantFilter,
            studentId,
            testId
        );

        if (!attempt) {
            console.log('[submitTest] Rejected: no attempt found.');

            return res.status(403).json({
                success: false,
                message: 'You must start this test before submitting.'
            });
        }

        // ========================================================
        // 4. IDEMPOTENT SUBMISSION RESPONSE
        // ========================================================

        // If the server already submitted this attempt, return
        // the existing result as success. This handles retries
        // when the original response was lost.

        const sendExistingSubmission = (existingAttempt) => {
            return res.json({
                success: true,
                alreadySubmitted: true,
                message: 'This test has already been submitted.',
                data: {
                    attemptId: existingAttempt.id,
                    score: existingAttempt.score ?? 0,
                    totalQuestions: existingAttempt.totalQuestions ?? 0,
                    percentage: existingAttempt.percentage ?? 0,
                    passed: existingAttempt.passed ?? false,
                    startedAt: existingAttempt.startedAt,
                    submittedAt: existingAttempt.submittedAt,
                    expiresAt: existingAttempt.expiresAt,
                    duration: test.duration,
                    isAutoSubmitted:
                        existingAttempt.isAutoSubmitted ?? false
                }
            });
        };

        if (attempt.status === 'submitted') {
            console.log('[submitTest] Attempt already submitted. Returning existing result.');

            return sendExistingSubmission(attempt);
        }

        if (attempt.status !== 'in_progress') {
            return res.status(403).json({
                success: false,
                message: 'This test attempt cannot be submitted.',
                attemptStatus: attempt.status
            });
        }

        // ========================================================
        // 5. CHECK EXISTING STUDENT RESULT
        // ========================================================

        const testResults = getArray(student.testResults);

        const existingStudentResult = testResults.find(
            result => parseInt(result.testId, 10) === testId
        );

        // Reconcile an older result if the student result was
        // saved but the attempt status was not updated.

        if (existingStudentResult) {
            console.log('[submitTest] Existing student result found. Reconciling attempt.');

            const existingSubmittedAt =
                toDateOrNull(
                    existingStudentResult.submittedAt ||
                    existingStudentResult.date
                ) || new Date();

            const reconciledAttempt =
                await prisma.testAttempt.updateMany({
                    where: {
                        ...tenantFilter,
                        id: attempt.id,
                        studentId,
                        testId,
                        status: 'in_progress'
                    },
                    data: {
                        status: 'submitted',
                        submittedAt: existingSubmittedAt,
                        score: existingStudentResult.score ?? 0,
                        totalQuestions:
                            existingStudentResult.totalQuestions ?? 0,
                        percentage: existingStudentResult.percentage ?? 0,
                        passed: existingStudentResult.passed ?? false,
                        isAutoSubmitted:
                            existingStudentResult.isAutoSubmitted ?? false
                    }
                });

            const latestAttempt = await getTestAttempt(
                tenantFilter,
                studentId,
                testId
            );

            if (
                latestAttempt &&
                latestAttempt.status === 'submitted'
            ) {
                return sendExistingSubmission(latestAttempt);
            }

            if (reconciledAttempt.count !== 1) {
                return res.status(409).json({
                    success: false,
                    message: 'This test result already exists. Please refresh your results.'
                });
            }
        }

        // ========================================================
        // 6. PREPARE ANSWERS
        // ========================================================

        const now = new Date();

        const isExpired = now >= attempt.expiresAt;

        const testQuestions = getArray(test.questions);

        if (testQuestions.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'This test has no questions available.'
            });
        }

        // After expiry, ONLY use answers already saved on the server.
        // Never accept late answers from the mobile application.

        const submittedAnswers = isExpired
            ? getArray(attempt.answers)
            : Array.isArray(answers)
                ? answers
                : getArray(attempt.answers);

        if (submittedAnswers.length > testQuestions.length) {
            return res.status(400).json({
                success: false,
                message: 'Invalid answer data.'
            });
        }

        // ========================================================
        // 7. CALCULATE RESULT
        // ========================================================

        const {
            score,
            totalQuestions,
            percentage
        } = calculateTestScore(
            testQuestions,
            submittedAnswers
        );

        const passMark = Number(test.passMark ?? 50);
        const passed = percentage >= passMark;

        const submittedAt = isExpired
            ? attempt.expiresAt
            : now;

        const result = {
            testId,
            score,
            totalQuestions,
            percentage,
            passed,
            date: submittedAt,
            startedAt: attempt.startedAt,
            submittedAt,
            expiresAt: attempt.expiresAt,
            duration: test.duration,
            isAutoSubmitted: isExpired
        };

        // ========================================================
        // 8. TRANSACTION
        // ========================================================

        const transactionResult = await prisma.$transaction(
            async (tx) => {

                // Atomically claim the attempt.
                const attemptUpdate =
                    await tx.testAttempt.updateMany({
                        where: {
                            ...tenantFilter,
                            id: attempt.id,
                            studentId,
                            testId,
                            status: 'in_progress'
                        },
                        data: {
                            status: 'submitted',
                            submittedAt,
                            answers: submittedAnswers,
                            score,
                            totalQuestions,
                            percentage,
                            passed,
                            isAutoSubmitted: isExpired
                        }
                    });

                if (attemptUpdate.count !== 1) {
                    // Another request may have submitted it.
                    const latestAttempt =
                        await tx.testAttempt.findFirst({
                            where: {
                                ...tenantFilter,
                                id: attempt.id,
                                studentId,
                                testId
                            }
                        });

                    if (
                        latestAttempt &&
                        latestAttempt.status === 'submitted'
                    ) {
                        return {
                            alreadySubmitted: true,
                            attempt: latestAttempt
                        };
                    }

                    throw new Error('TEST_ALREADY_SUBMITTED');
                }

                // Read the latest student results inside the
                // transaction to avoid using the stale array
                // originally fetched before the transaction.

                const currentStudent =
                    await tx.student.findFirst({
                        where: {
                            ...tenantFilter,
                            id: studentId
                        }
                    });

                if (!currentStudent) {
                    throw new Error('STUDENT_NOT_FOUND');
                }

                const currentResults = getArray(
                    currentStudent.testResults
                );

                const alreadyHasResult = currentResults.some(
                    item => parseInt(item.testId, 10) === testId
                );

                if (!alreadyHasResult) {
                    await tx.student.updateMany({
                        where: {
                            ...tenantFilter,
                            id: studentId
                        },
                        data: {
                            testResults: [
                                ...currentResults,
                                result
                            ]
                        }
                    });
                }

                const updatedAttempt =
                    await tx.testAttempt.findFirst({
                        where: {
                            ...tenantFilter,
                            id: attempt.id,
                            studentId,
                            testId
                        }
                    });

                return {
                    alreadySubmitted: false,
                    attempt: updatedAttempt
                };
            }
        );

        // ========================================================
        // 9. RETURN SUCCESS
        // ========================================================

        const finalAttempt = transactionResult.attempt;

        console.log('[submitTest] Submission completed:', {
            studentId,
            testId,
            attemptId: finalAttempt?.id,
            score: finalAttempt?.score,
            percentage: finalAttempt?.percentage,
            isAutoSubmitted: finalAttempt?.isAutoSubmitted
        });

        return res.json({
            success: true,
            alreadySubmitted:
                transactionResult.alreadySubmitted,
            message: isExpired
                ? 'Test time expired. Your saved answers have been submitted.'
                : 'Test submitted successfully.',
            data: {
                attemptId: finalAttempt?.id,
                score: finalAttempt?.score ?? score,
                totalQuestions:
                    finalAttempt?.totalQuestions ?? totalQuestions,
                percentage:
                    finalAttempt?.percentage ?? percentage,
                passed: finalAttempt?.passed ?? passed,
                startedAt: finalAttempt?.startedAt || attempt.startedAt,
                submittedAt:
                    finalAttempt?.submittedAt || submittedAt,
                expiresAt: finalAttempt?.expiresAt || attempt.expiresAt,
                duration: test.duration,
                isAutoSubmitted:
                    finalAttempt?.isAutoSubmitted ?? isExpired
            }
        });

    } catch (error) {

        // ========================================================
        // 10. HANDLE SUBMISSION RACE / RETRY
        // ========================================================

        if (error.message === 'TEST_ALREADY_SUBMITTED') {
            try {
                const tenantFilter = getTenantFilter(req);

                const latestAttempt = await getTestAttempt(
                    tenantFilter,
                    parseInt(req.user.id, 10),
                    parseInt(req.params.id, 10)
                );

                if (
                    latestAttempt &&
                    latestAttempt.status === 'submitted'
                ) {
                    const test = await getTest(
                        tenantFilter,
                        parseInt(req.params.id, 10)
                    );

                    return res.json({
                        success: true,
                        alreadySubmitted: true,
                        message: 'This test has already been submitted.',
                        data: {
                            attemptId: latestAttempt.id,
                            score: latestAttempt.score ?? 0,
                            totalQuestions:
                                latestAttempt.totalQuestions ?? 0,
                            percentage: latestAttempt.percentage ?? 0,
                            passed: latestAttempt.passed ?? false,
                            startedAt: latestAttempt.startedAt,
                            submittedAt: latestAttempt.submittedAt,
                            expiresAt: latestAttempt.expiresAt,
                            duration: test?.duration,
                            isAutoSubmitted:
                                latestAttempt.isAutoSubmitted ?? false
                        }
                    });
                }
            } catch (retryError) {
                console.error(
                    '[submitTest] Retry lookup error:',
                    retryError
                );
            }

            return res.status(409).json({
                success: false,
                message: 'The test submission is being processed. Please refresh your results.'
            });
        }

        if (error.message === 'STUDENT_NOT_FOUND') {
            return res.status(404).json({
                success: false,
                message: 'Student not found.'
            });
        }

        console.error('[submitTest] ERROR:', {
            message: error.message,
            code: error.code,
            stack: error.stack
        });

        return res.status(500).json({
            success: false,
            message: 'Internal server error while submitting test.',
            error: error.message
        });
    }
};
