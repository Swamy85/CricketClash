
import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import User from "../src/models/User.js";

const rl = readline.createInterface({ input, output });

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from backend/.env");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const username = (await rl.question("Admin username: ")).trim();
  const email = (await rl.question("Admin email: "))
    .trim()
    .toLowerCase();
  const password = await rl.question("Admin password (hidden input is not enabled): ");

  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(username)) {
    throw new Error("Username must be 3–24 valid characters.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }

  if (password.length < 12) {
    throw new Error("Use a password with at least 12 characters.");
  }

  // Never silently promote an existing player account.
  const existing = await User.findOne({ email });

  if (existing) {
    throw new Error(
      "This email already has an account. No changes were made."
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = `CC-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;

  await User.create({
    userId,
    username,
    email,
    passwordHash,
    role: "admin",
    isEmailVerified: true,
    lastActivityAt: null,
  });

  console.log("\nAdmin account created successfully.");
  console.log(`Username: ${username}`);
  console.log(`Email: ${email}`);
  console.log("Role: admin");
}

main()
  .catch((error) => {
    console.error("Admin setup failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await mongoose.disconnect().catch(() => {});
  });
