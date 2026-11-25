-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "allowedFeatures" JSONB,
ADD COLUMN     "networkSettings" JSONB;

-- AlterTable
ALTER TABLE "Class" ADD COLUMN     "category" TEXT;

-- AlterTable
ALTER TABLE "ENoteFile" ADD COLUMN     "subjectId" INTEGER,
ADD COLUMN     "subjectName" TEXT;

-- CreateTable
CREATE TABLE "AdminToken" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "schoolName" TEXT,
    "studentLimit" INTEGER NOT NULL DEFAULT 0,
    "expiryDate" TIMESTAMP(3),
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allowedFeatures" JSONB,

    CONSTRAINT "AdminToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultPin" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "studentId" INTEGER,
    "pin" TEXT NOT NULL,
    "termId" INTEGER NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResultPin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestAttempt" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "studentId" INTEGER NOT NULL,
    "testId" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "answers" JSONB,
    "score" INTEGER,
    "totalQuestions" INTEGER,
    "percentage" INTEGER,
    "passed" BOOLEAN,
    "isAutoSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminToken_token_key" ON "AdminToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "ResultPin_pin_key" ON "ResultPin"("pin");

-- CreateIndex
CREATE INDEX "ResultPin_adminId_termId_sessionId_idx" ON "ResultPin"("adminId", "termId", "sessionId");

-- CreateIndex
CREATE INDEX "TestAttempt_adminId_studentId_idx" ON "TestAttempt"("adminId", "studentId");

-- CreateIndex
CREATE INDEX "TestAttempt_adminId_testId_idx" ON "TestAttempt"("adminId", "testId");

-- CreateIndex
CREATE INDEX "TestAttempt_adminId_status_idx" ON "TestAttempt"("adminId", "status");

-- CreateIndex
CREATE INDEX "TestAttempt_expiresAt_idx" ON "TestAttempt"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TestAttempt_adminId_studentId_testId_key" ON "TestAttempt"("adminId", "studentId", "testId");

-- AddForeignKey
ALTER TABLE "ResultPin" ADD CONSTRAINT "ResultPin_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultPin" ADD CONSTRAINT "ResultPin_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAttempt" ADD CONSTRAINT "TestAttempt_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
