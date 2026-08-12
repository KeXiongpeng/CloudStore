import { PrismaClient, Role, Tier } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const VIP_STORAGE_LIMIT = 10 * 1024 * 1024 * 1024; // 10GB

async function main() {
  console.log('Seeding database...');

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123456';

  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (existingAdmin) {
    console.log('Admin user already exists, skipping...');
  } else {
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        nickname: 'Admin',
        role: Role.admin,
        tier: Tier.vip,
      },
    });

    await prisma.userQuota.create({
      data: {
        userId: admin.id,
        storageLimit: VIP_STORAGE_LIMIT,
        tier: Tier.vip,
      },
    });

    console.log(`Admin user created: ${admin.email}`);
  }

  console.log('Seeding completed.');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
