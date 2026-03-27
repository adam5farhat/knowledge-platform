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

  console.log("Seed complete.");
  console.log(`  Department: ${dept.name} (${dept.id})`);
  console.log(`  Admin user: ${adminEmail} (password from SEED_ADMIN_PASSWORD or default)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
