import { PrismaClient, Role, Tier } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const FREE_STORAGE_LIMIT = 500 * 1024 * 1024;
const VIP_STORAGE_LIMIT = 10 * 1024 * 1024 * 1024;

async function seedUser(input: {
  email: string;
  password: string;
  nickname: string;
  role: Role;
  tier: Tier;
  storageLimit: number;
}) {
  const existingUser = await prisma.user.findUnique({
    where: { email: input.email },
  });

  if (existingUser) {
    console.log(`${input.nickname} user already exists, skipping...`);
    return;
  }

  const passwordHash = await bcrypt.hash(input.password, 10);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      nickname: input.nickname,
      role: input.role,
      tier: input.tier,
    },
  });

  await prisma.userQuota.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      storageLimit: input.storageLimit,
      storageUsed: 0,
      tier: input.tier,
    },
    update: {
      storageLimit: input.storageLimit,
      tier: input.tier,
    },
  });

  console.log(`${input.nickname} user created: ${user.email}`);
}

async function main() {
  console.log('Seeding database...');

  await seedUser({
    email: process.env.ADMIN_EMAIL || 'admin@example.com',
    password: process.env.ADMIN_PASSWORD || 'admin123456',
    nickname: 'Admin',
    role: Role.admin,
    tier: Tier.vip,
    storageLimit: VIP_STORAGE_LIMIT,
  });

  await seedUser({
    email: process.env.DEMO_EMAIL || 'demo@example.com',
    password: process.env.DEMO_PASSWORD || 'demo123456',
    nickname: 'Demo',
    role: Role.user,
    tier: Tier.free,
    storageLimit: FREE_STORAGE_LIMIT,
  });

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
