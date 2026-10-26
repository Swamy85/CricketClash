import mongoose from "mongoose";

const usernameClaimSchema = new mongoose.Schema({
  usernameKey: { type: String, required: true, unique: true },
  email: { type: String, default: null },
  legacy: { type: Boolean, default: false },
}, { timestamps: true });

const UsernameClaim = mongoose.models.UsernameClaim || mongoose.model("UsernameClaim", usernameClaimSchema);
export default UsernameClaim;
