
const prisma = require('../config/db');
const cloudinary = require('cloudinary').v2;

// ============================================
// CLOUDINARY CONFIGURATION
// ============================================

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// ============================================
// HELPER: UPLOAD FILE TO CLOUDINARY
// ============================================

const uploadToCloudinary = (fileBuffer, folderName) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder: folderName,
                resource_type: 'raw'
            },
            (error, result) => {
                if (error) {
                    return reject(error);
                }

                if (!result || !result.secure_url) {
                    return reject(new Error('Cloudinary did not return a valid file URL.'));
                }

                const secureUrl =
                    result.secure_url + '?response-content-disposition=inline';

                resolve(secureUrl);
            }
        );

        stream.end(fileBuffer);
    });
};

// ============================================
// HELPER: VALIDATE POSITIVE INTEGER
// ============================================

const isValidId = (value) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0;
};

// ============================================
// HELPER: GET TEACHER SCHOOL ADMIN ID
// ============================================

const getTeacherAdminId = (req) => {
    const adminId = Number(req.user.adminId);

    return Number.isInteger(adminId) && adminId > 0
        ? adminId
        : null;
};

// ============================================
// GET STUDENT INFO
// ============================================

exports.getMyStudentInfo = async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({
                success: false,
                message: 'Not authorized.'
            });
        }

        const student = await prisma.student.findUnique({
            where: {
                id: parseInt(req.user.id)
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                classId: true
            }
        });

        if (!student) {
            return res.status(404).json({
                success: false,
                message: 'Student not found.'
            });
        }

        return res.json({
            success: true,
            data: student
        });

    } catch (error) {
        console.error('Error fetching student info:', error);

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// ============================================
// GET CLASSES FOR TEACHER / ADMIN
// ============================================

exports.getMyClasses = async (req, res) => {
    try {
        const { role, id } = req.user;

        let classes = [];

        // ------------------------------------
        // ADMIN CLASSES
        // ------------------------------------

        if (role === 'admin') {
            classes = await prisma.class.findMany({
                where: {
                    adminId: parseInt(id)
                },
                select: {
                    id: true,
                    name: true,
                    level: true,
                    section: true,
                    session: true
                },
                orderBy: {
                    name: 'asc'
                }
            });

        // ------------------------------------
        // TEACHER CLASSES
        // ------------------------------------

        } else if (role === 'teacher') {
            const teacherId = parseInt(id);
            const schoolAdminId = getTeacherAdminId(req);

            if (!schoolAdminId) {
                return res.status(400).json({
                    success: false,
                    message: 'Teacher school information is missing. Please log in again.'
                });
            }

            // Classes assigned to the teacher.
            const assignments = await prisma.teacherAssignment.findMany({
                where: {
                    teacherId
                },
                select: {
                    classId: true
                }
            });

            // Classes where the teacher is the class teacher.
            const mainClasses = await prisma.class.findMany({
                where: {
                    teacherId,
                    adminId: schoolAdminId
                },
                select: {
                    id: true
                }
            });

            const classIds = [
                ...new Set([
                    ...assignments.map(item => item.classId),
                    ...mainClasses.map(item => item.id)
                ])
            ];

            if (classIds.length > 0) {
                classes = await prisma.class.findMany({
                    where: {
                        id: {
                            in: classIds
                        },
                        adminId: schoolAdminId
                    },
                    select: {
                        id: true,
                        name: true,
                        level: true,
                        section: true,
                        session: true
                    },
                    orderBy: {
                        name: 'asc'
                    }
                });
            }

        } else {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to view classes.'
            });
        }

        return res.json({
            success: true,
            data: classes
        });

    } catch (error) {
        console.error('Error fetching classes:', error);

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// ============================================
// GET SUBJECTS FOR TEACHER / ADMIN BY CLASS
// ============================================

exports.getMySubjects = async (req, res) => {
    try {
        const { classId } = req.query;
        const { role, id } = req.user;

        if (!isValidId(classId)) {
            return res.status(400).json({
                success: false,
                message: 'Valid Class ID is required.'
            });
        }

        const parsedClassId = parseInt(classId);
        let subjects = [];

        // ------------------------------------
        // ADMIN SUBJECTS
        // ------------------------------------

        if (role === 'admin') {
            const classData = await prisma.class.findFirst({
                where: {
                    id: parsedClassId,
                    adminId: parseInt(id)
                },
                select: {
                    subjects: true
                }
            });

            if (!classData) {
                return res.status(404).json({
                    success: false,
                    message: 'Class not found.'
                });
            }

            if (classData.subjects && classData.subjects.length > 0) {
                subjects = await prisma.subject.findMany({
                    where: {
                        id: {
                            in: classData.subjects
                        }
                    },
                    select: {
                        id: true,
                        name: true,
                        code: true
                    },
                    orderBy: {
                        name: 'asc'
                    }
                });
            }

        // ------------------------------------
        // TEACHER SUBJECTS
        // ------------------------------------

        } else if (role === 'teacher') {
            const schoolAdminId = getTeacherAdminId(req);

            if (!schoolAdminId) {
                return res.status(400).json({
                    success: false,
                    message: 'Teacher school information is missing. Please log in again.'
                });
            }

            // Confirm that the class belongs to the teacher's school.
            const classData = await prisma.class.findFirst({
                where: {
                    id: parsedClassId,
                    adminId: schoolAdminId
                },
                select: {
                    id: true
                }
            });

            if (!classData) {
                return res.status(404).json({
                    success: false,
                    message: 'Class not found.'
                });
            }

            const assignments = await prisma.teacherAssignment.findMany({
                where: {
                    teacherId: parseInt(id),
                    classId: parsedClassId,
                    isActive: true
                },
                select: {
                    subjectId: true
                }
            });

            const subjectIds = [
                ...new Set(assignments.map(item => item.subjectId))
            ];

            if (subjectIds.length > 0) {
                subjects = await prisma.subject.findMany({
                    where: {
                        id: {
                            in: subjectIds
                        }
                    },
                    select: {
                        id: true,
                        name: true,
                        code: true
                    },
                    orderBy: {
                        name: 'asc'
                    }
                });
            }

        } else {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to view subjects.'
            });
        }

        return res.json({
            success: true,
            data: subjects
        });

    } catch (error) {
        console.error('Error fetching subjects:', error);

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// ============================================
// GET STUDENTS BY CLASS
// ============================================

exports.getStudentsByClass = async (req, res) => {
    try {
        const { classId } = req.query;
        const { role, id } = req.user;

        if (!isValidId(classId)) {
            return res.status(400).json({
                success: false,
                message: 'Valid Class ID is required.'
            });
        }

        const parsedClassId = parseInt(classId);

        if (role !== 'admin' && role !== 'teacher') {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to view students.'
            });
        }

        // ------------------------------------
        // VERIFY CLASS ACCESS
        // ------------------------------------

        if (role === 'admin') {
            const classData = await prisma.class.findFirst({
                where: {
                    id: parsedClassId,
                    adminId: parseInt(id)
                },
                select: {
                    id: true
                }
            });

            if (!classData) {
                return res.status(404).json({
                    success: false,
                    message: 'Class not found.'
                });
            }

        } else if (role === 'teacher') {
            const schoolAdminId = getTeacherAdminId(req);

            if (!schoolAdminId) {
                return res.status(400).json({
                    success: false,
                    message: 'Teacher school information is missing. Please log in again.'
                });
            }

            const classData = await prisma.class.findFirst({
                where: {
                    id: parsedClassId,
                    adminId: schoolAdminId
                }
            });

            if (!classData) {
                return res.status(404).json({
                    success: false,
                    message: 'Class not found.'
                });
            }

            const assignment = await prisma.teacherAssignment.findFirst({
                where: {
                    teacherId: parseInt(id),
                    classId: parsedClassId,
                    isActive: true
                }
            });

            const isClassTeacher = await prisma.class.findFirst({
                where: {
                    id: parsedClassId,
                    teacherId: parseInt(id),
                    adminId: schoolAdminId
                }
            });

            if (!assignment && !isClassTeacher) {
                return res.status(403).json({
                    success: false,
                    message: 'You are not assigned to this class.'
                });
            }
        }

        // ------------------------------------
        // FETCH STUDENTS
        // ------------------------------------

        const students = await prisma.student.findMany({
            where: {
                classId: parsedClassId,
                isDeleted: false,
                ...(role === 'admin'
                    ? { adminId: parseInt(id) }
                    : { adminId: getTeacherAdminId(req) })
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                admissionNumber: true,
                gender: true
            },
            orderBy: {
                firstName: 'asc'
            }
        });

        return res.json({
            success: true,
            data: students
        });

    } catch (error) {
        console.error('Error fetching students:', error);

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// ============================================
// GET E-NOTES WEEKS BY CLASS AND TERM
// ============================================

exports.getWeeksByClass = async (req, res) => {
    try {
        const { classId, subjectId, termId } = req.query;
        const { role, id } = req.user;

        if (!['admin', 'teacher', 'student'].includes(role)) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to access E-Notes.'
            });
        }

        if (!isValidId(classId)) {
            return res.status(400).json({
                success: false,
                message: 'Valid Class ID is required.'
            });
        }

        const parsedClassId = parseInt(classId);
        const parsedTermId = termId ? parseInt(termId) : null;

        if (
            termId &&
            (!Number.isInteger(parsedTermId) || parsedTermId <= 0)
        ) {
            return res.status(400).json({
                success: false,
                message: 'Invalid academic term ID.'
            });
        }

        if (
            subjectId &&
            !isValidId(subjectId)
        ) {
            return res.status(400).json({
                success: false,
                message: 'Invalid subject ID.'
            });
        }

        // ------------------------------------
        // SECURITY CHECK
        // ------------------------------------

        if (role === 'teacher') {
            const schoolAdminId = getTeacherAdminId(req);

            if (!schoolAdminId) {
                return res.status(400).json({
                    success: false,
                    message: 'Teacher school information is missing. Please log in again.'
                });
            }

            const classData = await prisma.class.findFirst({
                where: {
                    id: parsedClassId,
                    adminId: schoolAdminId
                }
            });

            if (!classData) {
                return res.status(404).json({
                    success: false,
                    message: 'Class not found.'
                });
            }

            const assignment = await prisma.teacherAssignment.findFirst({
                where: {
                    teacherId: parseInt(id),
                    classId: parsedClassId,
                    isActive: true
                }
            });

            const isClassTeacher = await prisma.class.findFirst({
                where: {
                    id: parsedClassId,
                    teacherId: parseInt(id),
                    adminId: schoolAdminId
                }
            });

            if (!assignment && !isClassTeacher) {
                return res.status(403).json({
                    success: false,
                    message: 'You are not assigned to this class.'
                });
            }

        } else if (role === 'student') {
            const student = await prisma.student.findFirst({
                where: {
                    id: parseInt(id),
                    classId: parsedClassId
                }
            });

            if (!student) {
                return res.status(403).json({
                    success: false,
                    message: 'You are not in this class.'
                });
            }

        } else if (role === 'admin') {
            const classData = await prisma.class.findFirst({
                where: {
                    id: parsedClassId,
                    adminId: parseInt(id)
                }
            });

            if (!classData) {
                return res.status(404).json({
                    success: false,
                    message: 'Class not found.'
                });
            }
        }

        // ------------------------------------
        // FETCH WEEKS
        // ------------------------------------

        const weeks = await prisma.$queryRaw`
            SELECT *
            FROM "ENoteWeek"
            WHERE "classId" = ${parsedClassId}
            AND (
                ${parsedTermId}::INTEGER IS NULL
                OR "termId" = ${parsedTermId}
            )
            ORDER BY "createdAt" ASC
        `;

        // ------------------------------------
        // FETCH FILES
        // ------------------------------------

        let files = [];

        if (weeks.length > 0) {
            const weekIds = weeks.map(week => week.id);

            files = await prisma.$queryRaw`
                SELECT *
                FROM "ENoteFile"
                WHERE "weekId" = ANY(${weekIds}::int[])
            `;
        }

        // ------------------------------------
        // GROUP FILES BY WEEK
        // ------------------------------------

        const filesMap = new Map();

        files.forEach(file => {
            if (!filesMap.has(file.weekId)) {
                filesMap.set(file.weekId, []);
            }

            filesMap.get(file.weekId).push(file);
        });

        const formattedWeeks = weeks.map(week => {
            let weekFiles = filesMap.get(week.id) || [];

            if (subjectId) {
                const parsedSubjectId = parseInt(subjectId);

                weekFiles = weekFiles.filter(
                    file => Number(file.subjectId) === parsedSubjectId
                );
            }

            return {
                ...week,

                createdAt: week.createdAt instanceof Date
                    ? week.createdAt.toISOString()
                    : week.createdAt,

                updatedAt: week.updatedAt instanceof Date
                    ? week.updatedAt.toISOString()
                    : week.updatedAt,

                files: weekFiles.map(file => ({
                    ...file,

                    createdAt: file.createdAt instanceof Date
                        ? file.createdAt.toISOString()
                        : file.createdAt,

                    updatedAt: file.updatedAt instanceof Date
                        ? file.updatedAt.toISOString()
                        : file.updatedAt
                }))
            };
        });

        return res.json({
            success: true,
            data: formattedWeeks
        });

    } catch (error) {
        console.error('Error fetching e-note weeks:', error);

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// ============================================
// CREATE E-NOTES WEEKS (ADMIN ONLY)
// Each week belongs to an academic term.
// ============================================

exports.createWeek = async (req, res) => {
    try {
        const { classId, classIds, title, termId } = req.body;
        const { role, id } = req.user;

        if (role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Only administrators can create weeks.'
            });
        }

        const adminId = parseInt(id);
        const parsedTermId = parseInt(termId);

        if (
            !title ||
            !String(title).trim() ||
            (!classId && !classIds)
        ) {
            return res.status(400).json({
                success: false,
                message: 'Class ID(s), academic term and title are required.'
            });
        }

        if (
            !Number.isInteger(parsedTermId) ||
            parsedTermId <= 0
        ) {
            return res.status(400).json({
                success: false,
                message: 'Please select a valid academic term.'
            });
        }

        // ------------------------------------
        // VALIDATE CLASS IDS
        // ------------------------------------

        const targetClassIds = (
            Array.isArray(classIds) && classIds.length > 0
                ? classIds
                : [classId]
        ).map(value => parseInt(value));

        if (
            targetClassIds.some(
                value => !Number.isInteger(value) || value <= 0
            )
        ) {
            return res.status(400).json({
                success: false,
                message: 'One or more class IDs are invalid.'
            });
        }

        const uniqueClassIds = [...new Set(targetClassIds)];

        // ------------------------------------
        // VERIFY ACADEMIC TERM
        // ------------------------------------

        const selectedTerm = await prisma.term.findFirst({
            where: {
                id: parsedTermId,
                adminId,
                isActive: true
            }
        });

        if (!selectedTerm) {
            return res.status(404).json({
                success: false,
                message: 'Academic term not found or inactive.'
            });
        }

        // ------------------------------------
        // VERIFY CLASSES BELONG TO ADMIN
        // ------------------------------------

        const existingClasses = await prisma.class.findMany({
            where: {
                id: {
                    in: uniqueClassIds
                },
                adminId
            },
            select: {
                id: true
            }
        });

        if (existingClasses.length !== uniqueClassIds.length) {
            return res.status(400).json({
                success: false,
                message: 'One or more selected classes do not belong to your school.'
            });
        }

        // ------------------------------------
        // CREATE WEEKS
        // ------------------------------------

       
        
        const createdWeeks = await prisma.$transaction(
            uniqueClassIds.map(cId =>
                prisma.eNoteWeek.create({
                    data: {
                        title: String(title).trim(),
                        adminId: Number(adminId),

                        // Connect the existing class
                        class: {
                            connect: {
                                id: Number(cId)
                            }
                        },

                        // Connect the existing academic term
                        term: {
                            connect: {
                                id: Number(parsedTermId)
                            }
                        }

                        // teacher is optional.
                        // Leave it unconnected for admin-created weeks.
                    },
                    include: {
                        term: {
                            select: {
                                id: true,
                                name: true
                            }
                        },
                        class: {
                            select: {
                                id: true,
                                name: true
                            }
                        },
                        teacher: {
                            select: {
                                id: true
                            }
                        }
                    }
                })
            )
        );

        return res.status(201).json({
            success: true,
            message: 'E-Notes weeks created successfully.',
            data: createdWeeks
        });

    } catch (error) {
        console.error('Error creating e-note week:', error);

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// ============================================
// UPLOAD PDF FILES TO A WEEK
// CLOUDINARY + RAW SQL
// ============================================

exports.uploadFiles = async (req, res) => {
    try {
        const { weekId } = req.params;
        const { role, id } = req.user;
        const { subjectId, subjectName } = req.body;

        if (role !== 'admin' && role !== 'teacher') {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to upload files.'
            });
        }

        if (!isValidId(weekId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid week ID.'
            });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No files uploaded.'
            });
        }

        const parsedWeekId = parseInt(weekId, 10);

        // ------------------------------------
        // VERIFY SCHOOL OWNERSHIP
        // ------------------------------------

        let schoolAdminId;

        if (role === 'admin') {
            schoolAdminId = Number(id);
        } else {
            schoolAdminId = Number(getTeacherAdminId(req));

            if (!schoolAdminId || !Number.isInteger(schoolAdminId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Teacher school information is missing. Please log in again.'
                });
            }
        }

        const week = await prisma.eNoteWeek.findFirst({
            where: {
                id: parsedWeekId,
                adminId: schoolAdminId
            }
        });

        if (!week) {
            return res.status(404).json({
                success: false,
                message: 'Week not found or unauthorized.'
            });
        }

        // ------------------------------------
        // VERIFY TEACHER SUBJECT ASSIGNMENT
        // ------------------------------------

        if (role === 'teacher') {
            if (!isValidId(subjectId)) {
                return res.status(400).json({
                    success: false,
                    message: 'A valid subject ID is required for teachers to upload.'
                });
            }

            const assignment = await prisma.teacherAssignment.findFirst({
                where: {
                    adminId: schoolAdminId,
                    teacherId: Number(id),
                    classId: week.classId,
                    subjectId: Number(subjectId),
                    isActive: true
                }
            });

            if (!assignment) {
                return res.status(403).json({
                    success: false,
                    message: 'You are not assigned to teach this subject in this class.'
                });
            }
        }

        // ------------------------------------
        // ENSURE FILE TABLE COLUMNS EXIST
        // ------------------------------------

        await prisma.$executeRawUnsafe(`
            ALTER TABLE "ENoteFile"
            ADD COLUMN IF NOT EXISTS "subjectId" INTEGER;
        `);

        await prisma.$executeRawUnsafe(`
            ALTER TABLE "ENoteFile"
            ADD COLUMN IF NOT EXISTS "subjectName" TEXT;
        `);

        // ------------------------------------
        // UPLOAD FILES AND SAVE DATABASE RECORDS
        // ------------------------------------

        const uploadedFiles = [];

        for (const file of req.files) {
            const cloudinaryUrl = await uploadToCloudinary(
                file.buffer,
                `school_enotes/week_${parsedWeekId}`
            );

            await prisma.$executeRaw`
                INSERT INTO "ENoteFile"
                (
                    "fileName",
                    "fileUrl",
                    "weekId",
                    "subjectId",
                    "subjectName",
                    "createdAt",
                    "updatedAt"
                )
                VALUES
                (
                    ${file.originalname},
                    ${cloudinaryUrl},
                    ${parsedWeekId},
                    ${subjectId ? Number(subjectId) : null},
                    ${subjectName || null},
                    NOW(),
                    NOW()
                )
            `;

            uploadedFiles.push({
                fileName: file.originalname,
                fileUrl: cloudinaryUrl
            });
        }

        // ------------------------------------
        // FETCH UPDATED WEEK
        // ------------------------------------

        const updatedWeek = await prisma.$queryRaw`
            SELECT *
            FROM "ENoteWeek"
            WHERE "id" = ${parsedWeekId}
            AND "adminId" = ${schoolAdminId}
        `;

        const updatedFiles = await prisma.$queryRaw`
            SELECT *
            FROM "ENoteFile"
            WHERE "weekId" = ${parsedWeekId}
            ORDER BY "createdAt" DESC
        `;

        const formattedWeek = updatedWeek[0]
            ? {
                ...updatedWeek[0],

                createdAt: updatedWeek[0].createdAt instanceof Date
                    ? updatedWeek[0].createdAt.toISOString()
                    : updatedWeek[0].createdAt,

                updatedAt: updatedWeek[0].updatedAt instanceof Date
                    ? updatedWeek[0].updatedAt.toISOString()
                    : updatedWeek[0].updatedAt,

                files: updatedFiles.map(file => ({
                    ...file,

                    createdAt: file.createdAt instanceof Date
                        ? file.createdAt.toISOString()
                        : file.createdAt,

                    updatedAt: file.updatedAt instanceof Date
                        ? file.updatedAt.toISOString()
                        : file.updatedAt
                }))
            }
            : null;

        return res.status(200).json({
            success: true,
            message: 'Files uploaded successfully.',
            data: formattedWeek
        });

    } catch (error) {
        console.error('Error uploading e-note files:', error);

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// ============================================
// DELETE AN UPLOADED FILE
// ============================================

exports.deleteFile = async (req, res) => {
    try {
        const { fileId } = req.params;
        const { role, id } = req.user;

        if (role !== 'admin' && role !== 'teacher') {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to delete files.'
            });
        }

        if (!isValidId(fileId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid file ID.'
            });
        }

        const parsedFileId = parseInt(fileId, 10);

        // ------------------------------------
        // FETCH FILE AND ITS WEEK
        // ------------------------------------

        const file = await prisma.eNoteFile.findUnique({
            where: {
                id: parsedFileId
            },
            include: {
                week: true
            }
        });

        if (!file) {
            return res.status(404).json({
                success: false,
                message: 'File not found.'
            });
        }

        // ------------------------------------
        // VERIFY SCHOOL OWNERSHIP
        // ------------------------------------

        let schoolAdminId;

        if (role === 'admin') {
            schoolAdminId = Number(id);
        } else {
            schoolAdminId = Number(getTeacherAdminId(req));

            if (!schoolAdminId || !Number.isInteger(schoolAdminId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Teacher school information is missing. Please log in again.'
                });
            }
        }

        if (Number(file.week.adminId) !== schoolAdminId) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized to delete this file.'
            });
        }

        // ------------------------------------
        // VERIFY TEACHER SUBJECT PERMISSION
        // ------------------------------------

        if (role === 'teacher') {
            if (!file.subjectId) {
                return res.status(403).json({
                    success: false,
                    message: 'You cannot delete a file without an assigned subject.'
                });
            }

            const assignment = await prisma.teacherAssignment.findFirst({
                where: {
                    adminId: schoolAdminId,
                    teacherId: Number(id),
                    classId: file.week.classId,
                    subjectId: Number(file.subjectId),
                    isActive: true
                }
            });

            if (!assignment) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only delete files for subjects you teach.'
                });
            }
        }

        // ------------------------------------
        // DELETE DATABASE RECORD
        // ------------------------------------

        // Cloudinary file is retained because public_id
        // is not currently stored in the database.

        await prisma.eNoteFile.delete({
            where: {
                id: parsedFileId
            }
        });

        return res.status(200).json({
            success: true,
            message: 'File deleted successfully.'
        });

    } catch (error) {
        console.error('Error deleting e-note file:', error);

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// ============================================
// DELETE A WEEK (ADMIN ONLY)
// ============================================

exports.deleteWeek = async (req, res) => {
    try {
        const { weekId } = req.params;
        const { role, id } = req.user;

        if (role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Only administrators can delete weeks.'
            });
        }

        if (!isValidId(weekId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid week ID.'
            });
        }

        const parsedWeekId = parseInt(weekId, 10);
        const adminId = Number(id);

        // ------------------------------------
        // VERIFY WEEK OWNERSHIP
        // ------------------------------------

        const week = await prisma.eNoteWeek.findFirst({
            where: {
                id: parsedWeekId,
                adminId
            },
            include: {
                files: true
            }
        });

        if (!week) {
            return res.status(404).json({
                success: false,
                message: 'Week not found or unauthorized.'
            });
        }

        // ------------------------------------
        // DELETE ASSOCIATED FILE RECORDS
        // ------------------------------------

        await prisma.$transaction([
            prisma.eNoteFile.deleteMany({
                where: {
                    weekId: parsedWeekId
                }
            }),

            prisma.eNoteWeek.delete({
                where: {
                    id: parsedWeekId
                }
            })
        ]);

        // Cloudinary files are not deleted here.
        // Their public_id must be stored to delete them from Cloudinary.

        return res.status(200).json({
            success: true,
            message: 'Week and all associated files deleted successfully.'
        });

    } catch (error) {
        console.error('Error deleting e-note week:', error);

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};
