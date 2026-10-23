import mongoose from "mongoose";

const teamSchema = new mongoose.Schema(
  {
    teamKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      maxlength: 180,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    shortName: { type: String, trim: true, maxlength: 30, default: "" },
    aliases: { type: [String], default: [] },
    category: {
      type: String,
      enum: ["international", "franchise", "domestic"],
      required: true,
      index: true,
    },
    gender: {
      type: String,
      enum: ["men", "women", "mixed"],
      default: "mixed",
      index: true,
    },
    country: { type: String, trim: true, maxlength: 80, default: "" },
    countryCode: { type: String, uppercase: true, trim: true, maxlength: 3, default: "" },
    flag: { type: String, trim: true, maxlength: 12, default: "" },
    competition: { type: String, trim: true, maxlength: 100, default: "" },
    season: { type: String, trim: true, maxlength: 30, default: "" },
    formats: {
      type: [String],
      enum: ["T10", "T20", "ODI", "TEST", "HUNDRED"],
      default: ["T20"],
    },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

teamSchema.index({ category: 1, competition: 1, season: 1, name: 1 });
teamSchema.index({ name: "text", aliases: "text", shortName: "text" });

const Team = mongoose.models.Team || mongoose.model("Team", teamSchema);

export default Team;
