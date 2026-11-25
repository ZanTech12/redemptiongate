
const prisma = require('../config/db');
const { getTenantFilter } = require('../utils/helpers');

// ============================================================
// HELPER: SAFELY GET ADMIN ID
// ============================================================
const getAdminId = (req) =>
    req.user.role === 'admin'
        ? parseInt(req.user.id)
        : parseInt(req.user.adminId);

// ============================================================
// HELPER: CHECK VALID INTEGER ID
// ============================================================
const isValidId = (id) => {
    const parsed = parseInt(id);
    return !isNaN(parsed);
};

// ============================================================
// HELPER: POPULATE TEACHER, SUBJECTS AND STUDENTS
// ============================================================
const populateClassRelations = async (classes, includeStudents = false) => {
    if (!classes || classes.length === 0) return [];

    // Collect teacher IDs
    const teacherIds = [
        ...new Set(
            classes
                .map(c => c.teacherId)
                .filter(Boolean)
        )
    ];

    // Collect subject IDs
    const subjectIds = [
        ...new Set(
            classes.flatMap(c =>
                Array.isArray(c.subjects) ? c.subjects : []
            )
        )
    ];

    // Collect actual class IDs
    const classIds = includeStudents
        ? [...new Set(classes.map(c => c.id))]
        : [];

    // Fetch all related records concurrently
    const [teachers, subjects, students] = await Promise.all([

        // Teachers
        teacherIds.length > 0
            ? prisma.teacher.findMany({
                where: {
                    id: { in: teacherIds }
                }
            })
            : Promise.resolve([]),

        // Subjects
        subjectIds.length > 0
            ? prisma.subject.findMany({
                where: {
                    id: { in: subjectIds }
                }
            })
            : Promise.resolve([]),

        // Students belonging to these classes
        includeStudents && classIds.length > 0
            ? prisma.student.findMany({
                where: {
                    classId: { in: classIds },
                    isDeleted: { not: true }
                },
                orderBy: [
                    { firstName: 'asc' },
                    { lastName: 'asc' }
                ]
            })
            : Promise.resolve([])
    ]);

    // ========================================================
    // TEACHER MAP
    // ========================================================
    const teacherMap = new Map(
        teachers.map(teacher => {
            // Never expose password hashes
            const {
                password,
                ...safeTeacher
            } = teacher;

            return [teacher.id, safeTeacher];
        })
    );

    // ========================================================
    // SUBJECT MAP
    // ========================================================
    const subjectMap = new Map(
        subjects.map(subject => [
            subject.id,
            subject
        ])
    );

    // ========================================================
    // GROUP STUDENTS BY CLASS ID
    // ========================================================
    const studentsByClass = new Map();

    students.forEach(student => {
        const classId = student.classId;

        if (!studentsByClass.has(classId)) {
            studentsByClass.set(classId, []);
        }

        studentsByClass.get(classId).push(student);
    });

    // ========================================================
    // RETURN POPULATED CLASSES
    // ========================================================
    return classes.map(classItem => {

        const populatedStudents = includeStudents
            ? (studentsByClass.get(classItem.id) || [])
            : classItem.students;

        return {
            ...classItem,

            // Populate teacher
            teacherId: classItem.teacherId
                ? teacherMap.get(classItem.teacherId) || null
                : null,

            // Populate subjects
            subjects: (
                Array.isArray(classItem.subjects)
                    ? classItem.subjects
                    : []
            )
                .map(subjectId => subjectMap.get(subjectId))
                .filter(Boolean),

            // Populate students using Student.classId
            students: populatedStudents
        };
    });
};

// ============================================================
// GET ALL CLASSES
// ============================================================
exports.getClasses = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 1000,
            search,
            level,
            teacherId,
            all
        } = req.query;

        const query = {
            ...getTenantFilter(req),
            isActive: true
        };

        if (search) {
            query.name = {
                contains: search,
                mode: 'insensitive'
            };
        }

        if (level) {
            query.level = level;
        }

        if (teacherId && isValidId(teacherId)) {
            query.teacherId = parseInt(teacherId);
        }

        const orderBy = [
            { name: 'asc' },
            { section: 'asc' }
        ];

        // Return all classes without pagination
        if (all === 'true' || all === '1') {

            const classes = await prisma.class.findMany({
                where: query,
                orderBy
            });

            const populatedClasses =
                await populateClassRelations(classes);

            return res.json({
                success: true,
                data: populatedClasses,
                pagination: {
                    page: 1,
                    limit: classes.length,
                    total: classes.length,
                    pages: 1
                }
            });
        }

        const currentPage = Math.max(1, parseInt(page) || 1);
        const currentLimit = Math.max(1, parseInt(limit) || 1000);

        const skip = (currentPage - 1) * currentLimit;
        const take = currentLimit;

        const [classes, total] = await Promise.all([

            prisma.class.findMany({
                where: query,
                orderBy,
                skip,
                take
            }),

            prisma.class.count({
                where: query
            })
        ]);

        const populatedClasses =
            await populateClassRelations(classes);

        return res.json({
            success: true,
            data: populatedClasses,
            pagination: {
                page: currentPage,
                limit: currentLimit,
                total,
                pages: Math.ceil(total / currentLimit)
            }
        });

    } catch (error) {
        console.error('Error fetching classes:', error);

        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// ============================================================
// GET ALL CLASSES FOR DROPDOWN
// ============================================================
exports.getAllClassesForDropdown = async (req, res) => {
    try {
        const {
            search,
            level,
            session
        } = req.query;

        const query = {
            ...getTenantFilter(req),
            isActive: true
        };

        if (search) {
            query.name = {
                contains: search,
                mode: 'insensitive'
            };
        }

        if (level) {
            query.level = level;
        }

        if (session) {
            query.session = session;
        }

        const classes = await prisma.class.findMany({
            where: query,
            orderBy: [
                { name: 'asc' },
                { section: 'asc' }
            ]
        });

        const populatedClasses =
            await populateClassRelations(classes);

        const responseData = populatedClasses.map(c => ({
            _id: c.id,
            id: c.id,
            name: c.name,
            level: c.level,
            section: c.section,
            session: c.session,

            teacherId: c.teacherId
                ? {
                    _id: c.teacherId.id,
                    firstName: c.teacherId.firstName,
                    lastName: c.teacherId.lastName,
                    email: c.teacherId.email
                }
                : null
        }));

        return res.json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error('Error fetching all classes:', error);

        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// ============================================================
// GET CLASS BY ID
// ============================================================
exports.getClassById = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid class ID format.'
            });
        }

        const classData = await prisma.class.findFirst({
            where: {
                ...getTenantFilter(req),
                id: parseInt(req.params.id)
            }
        });

        if (!classData) {
            return res.status(404).json({
                success: false,
                message: 'Class not found'
            });
        }

        const [populatedClass] =
            await populateClassRelations([classData], true);

        // Format subjects
        populatedClass.subjects =
            populatedClass.subjects.map(s => ({
                ...s,
                _id: s.id
            }));

        // Format students
        populatedClass.students =
            populatedClass.students.map(s => ({
                ...s,
                _id: s.id
            }));

        return res.json({
            success: true,
            data: populatedClass
        });

    } catch (error) {
        console.error('Error fetching class:', error);

        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// ============================================================
// CREATE CLASS
// ============================================================
exports.createClass = async (req, res) => {
    try {
        const adminId = getAdminId(req);

        const teacherId = parseInt(req.body.teacherId);

        if (!isValidId(teacherId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid teacher ID.'
            });
        }

        const teacher = await prisma.teacher.findFirst({
            where: {
                adminId,
                id: teacherId
            }
        });

        if (!teacher) {
            return res.status(400).json({
                success: false,
                message: 'Teacher not found'
            });
        }

        if (
            req.body.subjects &&
            req.body.subjects.length > 0
        ) {
            const subjectIds =
                req.body.subjects.map(id => parseInt(id));

            const subjectCount = await prisma.subject.count({
                where: {
                    adminId,
                    id: { in: subjectIds }
                }
            });

            if (subjectCount !== subjectIds.length) {
                return res.status(400).json({
                    success: false,
                    message: 'One or more subjects not found'
                });
            }
        }

        const newClass = await prisma.class.create({
            data: {
                ...req.body,
                adminId,
                teacherId,
                subjects: req.body.subjects
                    ? req.body.subjects.map(id => parseInt(id))
                    : [],
                students: []
            }
        });

        const [populatedClass] =
            await populateClassRelations([newClass], true);

        populatedClass.subjects =
            populatedClass.subjects.map(s => ({
                ...s,
                _id: s.id
            }));

        return res.status(201).json({
            success: true,
            message: 'Class created successfully',
            data: populatedClass
        });

    } catch (error) {
        console.error('Error creating class:', error);

        if (error.code === 'P2002') {
            return res.status(400).json({
                success: false,
                message: 'Class with this name, level, section, and session already exists'
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// ============================================================
// UPDATE CLASS
// ============================================================
exports.updateClass = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid class ID format.'
            });
        }

        const classId = parseInt(req.params.id);
        const tenantFilter = getTenantFilter(req);

        const existingClass = await prisma.class.findFirst({
            where: {
                ...tenantFilter,
                id: classId
            }
        });

        if (!existingClass) {
            return res.status(404).json({
                success: false,
                message: 'Class not found'
            });
        }

        // Check for duplicate class
        if (
            req.body.name &&
            req.body.level &&
            req.body.section &&
            req.body.session
        ) {
            const duplicateClass = await prisma.class.findFirst({
                where: {
                    ...tenantFilter,
                    id: { not: classId },
                    name: req.body.name,
                    level: req.body.level,
                    section: req.body.section,
                    session: req.body.session
                }
            });

            if (duplicateClass) {
                return res.status(400).json({
                    success: false,
                    message: 'Class with this name, level, section, and session already exists'
                });
            }
        }

        const dataToUpdate = { ...req.body };

        // Do not allow client to change tenant ownership
        delete dataToUpdate.adminId;

        if (dataToUpdate.teacherId) {
            const teacherId = parseInt(dataToUpdate.teacherId);

            if (!isValidId(teacherId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid teacher ID.'
                });
            }

            const teacher = await prisma.teacher.findFirst({
                where: {
                    ...tenantFilter,
                    id: teacherId
                }
            });

            if (!teacher) {
                return res.status(400).json({
                    success: false,
                    message: 'Teacher not found'
                });
            }

            dataToUpdate.teacherId = teacherId;
        }

        if (dataToUpdate.subjects) {
            dataToUpdate.subjects =
                dataToUpdate.subjects.map(id => parseInt(id));
        }

        const updatedClass = await prisma.class.update({
            where: {
                id: classId
            },
            data: dataToUpdate
        });

        const [populatedClass] =
            await populateClassRelations([updatedClass], true);

        populatedClass.subjects =
            populatedClass.subjects.map(s => ({
                ...s,
                _id: s.id
            }));

        return res.json({
            success: true,
            message: 'Class updated successfully',
            data: populatedClass
        });

    } catch (error) {
        console.error('Error updating class:', error);

        if (error.code === 'P2002') {
            return res.status(400).json({
                success: false,
                message: 'Class with this name, level, section, and session already exists'
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// ============================================================
// DELETE CLASS (SOFT DELETE)
// ============================================================
exports.deleteClass = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid class ID format.'
            });
        }

        const classId = parseInt(req.params.id);
        const tenantFilter = getTenantFilter(req);

        const classToDelete = await prisma.class.findFirst({
            where: {
                ...tenantFilter,
                id: classId
            }
        });

        if (!classToDelete) {
            return res.status(404).json({
                success: false,
                message: 'Class not found'
            });
        }

        const studentCount = await prisma.student.count({
            where: {
                ...tenantFilter,
                classId,
                isDeleted: { not: true }
            }
        });

        if (studentCount > 0) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete class with enrolled students.',
                studentCount
            });
        }

        await prisma.class.update({
            where: {
                id: classId
            },
            data: {
                isActive: false
            }
        });

        return res.json({
            success: true,
            message: 'Class deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting class:', error);

        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// ============================================================
// GET CLASSES BY TEACHER ID
// ============================================================
exports.getTeacherClasses = async (req, res) => {
    try {
        if (
            req.user.role === 'teacher' &&
            parseInt(req.user.id) !== parseInt(req.params.teacherId)
        ) {
            return res.status(403).json({
                success: false,
                message: 'Access denied.'
            });
        }

        if (!isValidId(req.params.teacherId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid teacher ID format.'
            });
        }

        const teacherId = parseInt(req.params.teacherId);

        const classes = await prisma.class.findMany({
            where: {
                ...getTenantFilter(req),
                teacherId,
                isActive: true
            },
            orderBy: [
                { name: 'asc' },
                { section: 'asc' }
            ]
        });

        // Populate actual students using Student.classId
        const populatedClasses =
            await populateClassRelations(classes, true);

        populatedClasses.forEach(c => {

            c.subjects = c.subjects.map(s => ({
                ...s,
                _id: s.id
            }));

            c.students = c.students.map(s => ({
                ...s,
                _id: s.id
            }));

        });

        return res.json({
            success: true,
            data: populatedClasses
        });

    } catch (error) {
        console.error('Error fetching teacher classes:', error);

        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// ============================================================
// GET CLASS WITH MATCHING SUBJECTS
// ============================================================
exports.getClassWithSubjects = async (req, res) => {
    try {
        const { id } = req.params;

        if (!isValidId(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid class ID format.'
            });
        }

        const classId = parseInt(id);
        const tenantFilter = getTenantFilter(req);

        const classData = await prisma.class.findFirst({
            where: {
                ...tenantFilter,
                id: classId
            }
        });

        if (!classData) {
            return res.status(404).json({
                success: false,
                message: 'Class not found'
            });
        }

        const matchingSubjects = await prisma.subject.findMany({
            where: {
                ...tenantFilter,
                OR: [
                    { classLevel: classData.level },
                    { classLevel: classData.name }
                ]
            }
        });

        const responseData = {
            ...classData,
            _id: classData.id,
            subjects: matchingSubjects.map(s => ({
                ...s,
                _id: s.id
            }))
        };

        return res.json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error('Error fetching class with subjects:', error);

        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};
