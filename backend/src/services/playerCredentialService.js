export async function findPlayerWithValidPassword({ User, email, password, comparePassword }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  let user = await User.findOne({ email: normalizedEmail }).select("+passwordHash +authVersion");
  if (!user) {
    const escapedEmail = normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    user = await User.findOne({ email: new RegExp(`^${escapedEmail}$`, "i") }).select("+passwordHash +authVersion");
  }
  if (!user || user.role === "admin") return null;
  return await comparePassword(password, user.passwordHash) ? user : null;
}
