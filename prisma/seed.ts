import "dotenv/config";
import * as bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const email = process.env.SPIKE_TEST_EMAIL ?? "d28-test@loyollo.local";
const password = process.env.SPIKE_TEST_PASSWORD ?? "TestPass123!";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const password_hash = await bcrypt.hash(password, 12);
  const id = crypto.randomUUID();
  await prisma.profile.upsert({
    where: { email: email.toLowerCase() },
    create: {
      id,
      email: email.toLowerCase(),
      password_hash,
      role: "admin",
      account_status: "active",
      owner_id: id,
      full_name: "D-28 Test User",
      onboarding_completed: true,
    },
    update: {
      password_hash,
      role: "admin",
      account_status: "active",
      owner_id: id,
      onboarding_completed: true,
    },
  });
  console.log(`Seeded test user ${email}`);
  await prisma.$disconnect();
}

void main();
