import "dotenv/config";
import { RoleName } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/password.js";

async function main() {
  for (const [name, description] of [
    [RoleName.ADMIN, "Full system access"] as const,
    [RoleName.MANAGER, "Team and content management"] as const,
    [RoleName.EMPLOYEE, "Standard access"] as const,
  ]) {
    await prisma.role.upsert({
      where: { name },
      create: { name, description },
      update: {},
    });
  }

  let dept = await prisma.department.findFirst({
    where: { name: "General" },
  });
  if (!dept) {
    dept = await prisma.department.create({
      data: { name: "General" },
    });
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.warn("⚠  SEED_ADMIN_PASSWORD not set — using default. Change it before deploying!");
  }
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.ADMIN } });

  const passwordHash = await hashPassword(adminPassword);

  await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      name: "System Administrator",
      passwordHash,
      roleId: adminRole.id,
      departmentId: dept.id,
    },
    update: {
      passwordHash,
      roleId: adminRole.id,
      departmentId: dept.id,
      isActive: true,
    },
  });

  const uxDeptName = process.env.SEED_UX_DEPARTMENT_NAME ?? "ui/ux";
  let uxDept = await prisma.department.findFirst({
    where: { name: { equals: uxDeptName, mode: "insensitive" } },
  });
  if (!uxDept) {
    uxDept = await prisma.department.create({
      data: { name: uxDeptName },
    });
  }

  const backofficeDeptName = process.env.SEED_BACKOFFICE_DEPARTMENT_NAME ?? "backoffice";
  let backofficeDept = await prisma.department.findFirst({
    where: { name: { equals: backofficeDeptName, mode: "insensitive" } },
  });
  if (!backofficeDept) {
    backofficeDept = await prisma.department.create({
      data: { name: backofficeDeptName },
    });
  }

  const managerDeptName = process.env.SEED_MANAGER_DEPARTMENT_NAME ?? "backoffice";
  let managerDept = await prisma.department.findFirst({
    where: { name: { equals: managerDeptName, mode: "insensitive" } },
  });
  if (!managerDept) {
    managerDept = await prisma.department.create({
      data: { name: managerDeptName },
    });
  }

  const managerEmail = process.env.SEED_MANAGER_EMAIL ?? "manager@example.com";
  const managerPassword = process.env.SEED_MANAGER_PASSWORD ?? "ChangeMe123!";
  if (!process.env.SEED_MANAGER_PASSWORD) {
    console.warn("⚠  SEED_MANAGER_PASSWORD not set — using default. Change it before deploying!");
  }
  const managerName = process.env.SEED_MANAGER_NAME ?? "Backoffice Manager";
  const managerRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.MANAGER } });
  const managerHash = await hashPassword(managerPassword);

  await prisma.user.upsert({
    where: { email: managerEmail },
    create: {
      email: managerEmail,
      name: managerName,
      passwordHash: managerHash,
      roleId: managerRole.id,
      departmentId: managerDept.id,
      position: process.env.SEED_MANAGER_POSITION ?? "Team lead",
    },
    update: {
      passwordHash: managerHash,
      roleId: managerRole.id,
      departmentId: managerDept.id,
      name: managerName,
      isActive: true,
    },
  });

  const uxEmail = process.env.SEED_UX_EMPLOYEE_EMAIL ?? "ux.employee@example.com";
  const uxPassword = process.env.SEED_UX_EMPLOYEE_PASSWORD ?? "ChangeMe123!";
  const uxName = process.env.SEED_UX_EMPLOYEE_NAME ?? "UI/UX Employee";
  const uxBadge = process.env.SEED_UX_EMPLOYEE_BADGE ?? "UX-1001";
  const employeeRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.EMPLOYEE } });
  const uxHash = await hashPassword(uxPassword);

  await prisma.user.upsert({
    where: { email: uxEmail },
    create: {
      email: uxEmail,
      name: uxName,
      passwordHash: uxHash,
      roleId: employeeRole.id,
      departmentId: uxDept.id,
      employeeBadgeNumber: uxBadge,
      position: process.env.SEED_UX_EMPLOYEE_POSITION ?? "Designer",
    },
    update: {
      passwordHash: uxHash,
      roleId: employeeRole.id,
      departmentId: uxDept.id,
      employeeBadgeNumber: uxBadge,
      name: uxName,
      isActive: true,
    },
  });

  console.log("Seed complete.");
  console.log(`  Department: ${dept.name} (${dept.id})`);
  console.log(`  Admin user: ${adminEmail} (password from SEED_ADMIN_PASSWORD or default)`);
  console.log(`  Department: ${uxDept.name} (${uxDept.id})`);
  console.log(`  Department: ${backofficeDept.name} (${backofficeDept.id})`);
  console.log(`  Manager: ${managerEmail} · ${managerDept.name} (password from SEED_MANAGER_PASSWORD or default)`);
  console.log(`  UX employee: ${uxEmail} (password from SEED_UX_EMPLOYEE_PASSWORD or default; badge ${uxBadge})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
