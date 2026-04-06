-- CreateEnum
CREATE TYPE "DepartmentAccessLevel" AS ENUM ('MEMBER', 'MANAGER', 'VIEWER');

-- CreateTable
CREATE TABLE "UserDepartmentAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "accessLevel" "DepartmentAccessLevel" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserDepartmentAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserDepartmentAccess_userId_idx" ON "UserDepartmentAccess"("userId");

-- CreateIndex
CREATE INDEX "UserDepartmentAccess_departmentId_idx" ON "UserDepartmentAccess"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "UserDepartmentAccess_userId_departmentId_key" ON "UserDepartmentAccess"("userId", "departmentId");

-- AddForeignKey
ALTER TABLE "UserDepartmentAccess" ADD CONSTRAINT "UserDepartmentAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDepartmentAccess" ADD CONSTRAINT "UserDepartmentAccess_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed existing user-department relationships into the junction table.
-- Every user gets a MEMBER entry for their current primary department.
-- Users with MANAGER role also get a MANAGER entry (upsert via ON CONFLICT).
INSERT INTO "UserDepartmentAccess" ("id", "userId", "departmentId", "accessLevel", "createdAt")
SELECT gen_random_uuid(), u."id", u."departmentId", 'MEMBER'::"DepartmentAccessLevel", NOW()
FROM "User" u
WHERE u."deletedAt" IS NULL
ON CONFLICT ("userId", "departmentId") DO NOTHING;

-- Add MANAGER access for users who have the MANAGER role
UPDATE "UserDepartmentAccess" uda
SET "accessLevel" = 'MANAGER'::"DepartmentAccessLevel"
FROM "User" u
JOIN "Role" r ON r."id" = u."roleId"
WHERE uda."userId" = u."id"
  AND uda."departmentId" = u."departmentId"
  AND r."name" = 'MANAGER';
