import mongoose from "mongoose";

const REPORT_TYPES = new Set(["contests", "matches", "transactions", "users"]);
const CONTEST_STATUSES = new Set(["OPEN", "WAITING", "FULL", "LOCKED", "COMPLETED", "CANCELLED", "REFUNDED"]);
const MATCH_STATUSES = new Set(["upcoming", "live", "completed", "cancelled", "abandoned"]);
const TRANSACTION_TYPES = new Set(["DEPOSIT", "CONTEST_ENTRY", "CONTEST_ENTRY_REVERSAL", "CONTEST_WINNING", "CONTEST_REFUND", "WITHDRAWAL", "WITHDRAWAL_RELEASE", "ADMIN_ADJUSTMENT"]);
const TRANSACTION_STATUSES = new Set(["PENDING", "COMPLETED", "FAILED", "REVERSED"]);
const GROUPS = new Set(["daily", "weekly", "monthly"]);
const PAGE_SIZE = 10;
const MAX_PAGE = 1_000_000;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function dateRange(query) {
  const today = new Date();
  const defaultTo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const defaultFrom = new Date(defaultTo);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29);
  const fromText = query.from || defaultFrom.toISOString().slice(0, 10);
  const toText = query.to || defaultTo.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromText) || !/^\d{4}-\d{2}-\d{2}$/.test(toText)) return null;
  const from = new Date(`${fromText}T00:00:00.000Z`);
  const to = new Date(`${toText}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.toISOString().slice(0, 10) !== fromText || to.toISOString().slice(0, 10) !== toText || from > to) return null;
  to.setUTCDate(to.getUTCDate() + 1);
  return { from, to, fromText, toText };
}

function reportDateFilter(range, field = "createdAt") {
  return { [field]: { $gte: range.from, $lt: range.to } };
}

function transactionDateFilter(range) {
  return { $or: [
    { processedAt: { $gte: range.from, $lt: range.to } },
    { processedAt: null, createdAt: { $gte: range.from, $lt: range.to } },
  ] };
}

function parsePage(value) {
  if (value === undefined) return 1;
  if (!/^\d+$/.test(String(value))) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= MAX_PAGE ? page : null;
}

function parseEnum(value, allowed) {
  if (value === undefined || value === "" || value === "ALL") return "";
  return allowed.has(value) ? value : null;
}

function safeSearch(value) {
  return String(value || "").trim().slice(0, 100);
}

function groupUnit(value) {
  return value === "weekly" ? "week" : value === "monthly" ? "month" : "day";
}

function idMap(rows) {
  return new Map(rows.map((row) => [String(row._id), row]));
}

export function createAdminReportsService({ Contest, Match, User, WalletTransaction, PlatformLedgerEntry }) {
  async function overview(query) {
    const range = dateRange(query);
    if (!range) return { status: 400, message: "Use a valid date range with the start date on or before the end date." };
    const group = query.group || "daily";
    if (!GROUPS.has(group)) return { status: 400, message: "Group must be daily, weekly, or monthly." };
    const inPeriod = reportDateFilter(range);
    const ledgerPeriod = reportDateFilter(range);
    const financialPeriod = transactionDateFilter(range);
    const [userCount, matchCount, contestCount, statusRows, financialRows, platformTotals, transactionTrend, platformTrend, registrationRows] = await Promise.all([
      User.countDocuments({ role: "user", createdAt: { $lt: range.to } }),
      Match.countDocuments(inPeriod),
      Contest.countDocuments(inPeriod),
      Contest.aggregate([
        { $match: inPeriod },
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      WalletTransaction.aggregate([
        { $match: { ...financialPeriod, status: "COMPLETED", type: { $in: ["CONTEST_ENTRY", "CONTEST_WINNING", "CONTEST_REFUND"] } } },
        { $group: { _id: "$type", amount: { $sum: "$amount" } } },
      ]),
      PlatformLedgerEntry.aggregate([
        { $match: ledgerPeriod },
        { $group: { _id: null, revenue: { $sum: { $cond: [{ $eq: ["$direction", "CREDIT"] }, "$amount", { $multiply: ["$amount", -1] }] } } } },
      ]),
      WalletTransaction.aggregate([
        { $match: { ...financialPeriod, status: "COMPLETED", type: { $in: ["CONTEST_ENTRY", "CONTEST_WINNING"] } } },
        { $group: { _id: { bucket: { $dateTrunc: { date: { $ifNull: ["$processedAt", "$createdAt"] }, unit: groupUnit(group), timezone: "UTC" } }, type: "$type" }, amount: { $sum: "$amount" } } },
        { $sort: { "_id.bucket": 1 } },
      ]),
      PlatformLedgerEntry.aggregate([
        { $match: ledgerPeriod },
        { $group: { _id: { bucket: { $dateTrunc: { date: "$createdAt", unit: groupUnit(group), timezone: "UTC" } }, direction: "$direction" }, amount: { $sum: "$amount" } } },
        { $sort: { "_id.bucket": 1 } },
      ]),
      User.aggregate([
        { $match: { role: "user", ...reportDateFilter(range) } },
        { $group: { _id: { $dateTrunc: { date: "$createdAt", unit: groupUnit(group), timezone: "UTC" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);
    const financial = Object.fromEntries(financialRows.map((row) => [row._id, row.amount]));
    const buckets = new Map();
    const ensureBucket = (value) => {
      const key = new Date(value).toISOString().slice(0, 10);
      if (!buckets.has(key)) buckets.set(key, { date: key, entryFees: 0, platformRevenue: 0, prizesPaid: 0, newUsers: 0 });
      return buckets.get(key);
    };
    for (const row of transactionTrend) {
      const bucket = ensureBucket(row._id.bucket);
      if (row._id.type === "CONTEST_ENTRY") bucket.entryFees += row.amount;
      if (row._id.type === "CONTEST_WINNING") bucket.prizesPaid += row.amount;
    }
    for (const row of platformTrend) {
      const bucket = ensureBucket(row._id.bucket);
      bucket.platformRevenue += row._id.direction === "CREDIT" ? row.amount : -row.amount;
    }
    for (const row of registrationRows) ensureBucket(row._id).newUsers += row.count;
    const dayCount = Math.ceil((range.to - range.from) / 86_400_000);
    if (group === "daily") {
      for (let offset = 0; offset < dayCount; offset += 1) {
        const date = new Date(range.from);
        date.setUTCDate(date.getUTCDate() + offset);
        ensureBucket(date);
      }
    } else if (group === "weekly") {
      const cursor = new Date(range.from);
      cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay());
      while (cursor < range.to) { ensureBucket(cursor); cursor.setUTCDate(cursor.getUTCDate() + 7); }
    } else {
      const cursor = new Date(Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), 1));
      while (cursor < range.to) { ensureBucket(cursor); cursor.setUTCMonth(cursor.getUTCMonth() + 1); }
    }
    const trend = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
    return {
      status: 200,
      data: {
        range: { from: range.fromText, to: range.toText, group },
        kpis: {
          totalUsers: userCount,
          totalMatches: matchCount,
          totalContests: contestCount,
          entryFeesCollected: financial.CONTEST_ENTRY || 0,
          platformRevenue: platformTotals[0]?.revenue || 0,
          prizesPaid: financial.CONTEST_WINNING || 0,
          refunds: financial.CONTEST_REFUND || 0,
        },
        contestStatuses: statusRows.map((row) => ({ status: row._id, count: row.count })),
        trend,
      },
    };
  }

  async function list(query, type) {
    if (!REPORT_TYPES.has(type)) return { status: 404, message: "Report category not found." };
    const range = dateRange(query);
    if (!range) return { status: 400, message: "Use a valid date range with the start date on or before the end date." };
    const page = parsePage(query.page);
    if (page === null) return { status: 400, message: "Page must be a positive integer." };
    const pageSize = query.limit === undefined ? PAGE_SIZE : Number(query.limit);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return { status: 400, message: "Page size must be between 1 and 100." };
    const search = safeSearch(query.search);
    const skip = (page - 1) * pageSize;
    const sort = { createdAt: -1, _id: -1 };

    if (type === "contests") {
      const status = parseEnum(query.status, CONTEST_STATUSES);
      const entryFee = query.entryFee === undefined || query.entryFee === "ALL" ? "" : query.entryFee;
      if (status === null || (entryFee && (!/^\d+(\.\d{1,2})?$/.test(entryFee) || !Number.isFinite(Number(entryFee))))) return { status: 400, message: "Invalid contest filter." };
      const filter = { ...reportDateFilter(range) };
      if (status) filter.status = status;
      if (entryFee) filter.entryFee = Number(entryFee);
      if (query.matchId) {
        if (!mongoose.isValidObjectId(query.matchId)) return { status: 400, message: "Invalid match ID." };
        filter.match = query.matchId;
      }
      if (search) {
        const regex = new RegExp(escapeRegex(search), "i");
        const searchOr = [{ name: regex }];
        if (mongoose.isValidObjectId(search)) searchOr.push({ _id: search });
        const matchingMatches = await Match.find({ $or: [{ teamA: regex }, { teamB: regex }, { title: regex }, { competition: regex }] }).select("_id").lean();
        if (matchingMatches.length) searchOr.push({ match: { $in: matchingMatches.map((match) => match._id) } });
        filter.$or = searchOr;
      }
      const [total, contests] = await Promise.all([
        Contest.countDocuments(filter),
        Contest.find(filter).sort(sort).skip(skip).limit(pageSize).populate("match", "competition title teamA teamB status startTime").lean(),
      ]);
      const ids = contests.map((contest) => contest._id);
      const [transactions, platformRows] = ids.length ? await Promise.all([
        WalletTransaction.aggregate([
          { $match: { contest: { $in: ids }, status: "COMPLETED", type: { $in: ["CONTEST_ENTRY", "CONTEST_WINNING", "CONTEST_REFUND"] } } },
          { $group: { _id: { contest: "$contest", type: "$type" }, amount: { $sum: "$amount" }, count: { $sum: 1 } } },
        ]),
        PlatformLedgerEntry.aggregate([
          { $match: { contest: { $in: ids } } },
          { $group: { _id: "$contest", amount: { $sum: { $cond: [{ $eq: ["$direction", "CREDIT"] }, "$amount", { $multiply: ["$amount", -1] }] } } } },
        ]),
      ]) : [[], []];
      const transactionAmounts = idMap(transactions.map((row) => ({ ...row, _id: `${row._id.contest}:${row._id.type}` })));
      const platformAmounts = idMap(platformRows);
      const rows = contests.map((contest, index) => {
        const amount = (key) => transactionAmounts.get(`${contest._id}:${key}`)?.amount || 0;
        return {
          ...contest,
          rowNumber: skip + index + 1,
          totalEntries: transactions.filter((row) => String(row._id.contest) === String(contest._id) && row._id.type === "CONTEST_ENTRY").reduce((sum, row) => sum + row.count, 0),
          capacity: 2,
          entryFeesCollected: amount("CONTEST_ENTRY"),
          platformFeeCollected: platformAmounts.get(String(contest._id))?.amount || 0,
          prizesPaid: amount("CONTEST_WINNING"),
          refunds: amount("CONTEST_REFUND"),
        };
      });
      return { status: 200, data: { rows, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } } };
    }

    if (type === "matches") {
      const status = parseEnum(query.status, MATCH_STATUSES);
      if (status === null) return { status: 400, message: "Invalid match status." };
      const filter = { ...reportDateFilter(range) };
      if (status) filter.status = status;
      if (search) {
        const regex = new RegExp(escapeRegex(search), "i");
        filter.$or = [{ teamA: regex }, { teamB: regex }, { title: regex }, { competition: regex }];
        if (mongoose.isValidObjectId(search)) filter.$or.push({ _id: search });
      }
      const [total, matches] = await Promise.all([
        Match.countDocuments(filter),
        Match.find(filter).sort(sort).skip(skip).limit(pageSize).lean(),
      ]);
      const ids = matches.map((match) => match._id);
      const contestLinks = ids.length ? await Contest.find({ match: { $in: ids } }).select("_id match").lean() : [];
      const contestIds = contestLinks.map((contest) => contest._id);
      const [contests, entryRows, platformRows] = ids.length ? await Promise.all([Contest.aggregate([
        { $match: { match: { $in: ids } } },
        { $group: { _id: "$match", count: { $sum: 1 } } },
      ]), WalletTransaction.aggregate([
        { $match: { contest: { $in: contestIds }, status: "COMPLETED", type: "CONTEST_ENTRY" } },
        { $group: { _id: "$contest", amount: { $sum: "$amount" } } },
      ]), PlatformLedgerEntry.aggregate([
        { $match: { contest: { $in: contestIds } } },
        { $group: { _id: "$contest", amount: { $sum: { $cond: [{ $eq: ["$direction", "CREDIT"] }, "$amount", { $multiply: ["$amount", -1] }] } } } },
      ])]) : [[], [], []];
      const byMatch = idMap(contests);
      const matchForContest = new Map(contestLinks.map((contest) => [String(contest._id), String(contest.match)]));
      const sumByMatch = (source) => {
        const sums = new Map();
        source.forEach((row) => {
          const matchId = matchForContest.get(String(row._id));
          if (matchId) sums.set(matchId, (sums.get(matchId) || 0) + row.amount);
        });
        return sums;
      };
      const entriesByMatch = sumByMatch(entryRows);
      const revenueByMatch = sumByMatch(platformRows);
      const rows = matches.map((match, index) => ({ ...match, rowNumber: skip + index + 1, contestCount: byMatch.get(String(match._id))?.count || 0, entryFeesCollected: entriesByMatch.get(String(match._id)) || 0, platformRevenue: revenueByMatch.get(String(match._id)) || 0 }));
      return { status: 200, data: { rows, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } } };
    }

    if (type === "transactions") {
      const transactionType = parseEnum(query.type, TRANSACTION_TYPES);
      const status = parseEnum(query.status, TRANSACTION_STATUSES);
      if (transactionType === null || status === null) return { status: 400, message: "Invalid transaction filter." };
      const filter = { ...transactionDateFilter(range) };
      if (transactionType) filter.type = transactionType;
      if (status) filter.status = status;
      if (search) {
        const regex = new RegExp(escapeRegex(search), "i");
        const searchOr = [{ type: regex }, { reference: regex }, { description: regex }];
        if (mongoose.isValidObjectId(search)) searchOr.push({ _id: search }, { user: search }, { contest: search });
        const userMatches = await User.find({ $or: [{ username: regex }, { email: regex }, { userId: regex }] }).select("_id").lean();
        if (userMatches.length) searchOr.push({ user: { $in: userMatches.map((user) => user._id) } });
        filter.$and = [{ $or: filter.$or }, { $or: searchOr }];
        delete filter.$or;
      }
      const [total, rows] = await Promise.all([
        WalletTransaction.countDocuments(filter),
        WalletTransaction.find(filter).sort(sort).skip(skip).limit(pageSize)
          .populate("user", "userId username email")
          .populate("contest", "name tier status")
          .lean(),
      ]);
      return { status: 200, data: { rows: rows.map((row, index) => ({ ...row, rowNumber: skip + index + 1, timestamp: row.processedAt || row.createdAt })), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } } };
    }

    const status = query.status === undefined || query.status === "ALL" ? "" : query.status;
    if (status && !["verified", "unverified"].includes(status)) return { status: 400, message: "Invalid account status." };
    const filter = { role: "user", ...reportDateFilter(range) };
    if (status) filter.isEmailVerified = status === "verified";
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ username: regex }, { email: regex }, { userId: regex }];
      if (mongoose.isValidObjectId(search)) filter.$or.push({ _id: search });
    }
    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter).select("userId username email isEmailVerified createdAt").sort(sort).skip(skip).limit(pageSize).lean(),
    ]);
    const ids = users.map((user) => user._id);
    const [contestRows, transactionRows] = ids.length ? await Promise.all([
      Contest.aggregate([
        { $match: { "players.user": { $in: ids } } },
        { $unwind: "$players" },
        { $match: { "players.user": { $in: ids } } },
        { $group: { _id: "$players.user", joinedContests: { $sum: 1 } } },
      ]),
      WalletTransaction.aggregate([
        { $match: { user: { $in: ids }, status: "COMPLETED" } },
        { $group: { _id: "$user", transactionTotal: { $sum: "$amount" }, transactionCount: { $sum: 1 } } },
      ]),
    ]) : [[], []];
    const contestsByUser = idMap(contestRows);
    const transactionsByUser = idMap(transactionRows);
    const rows = users.map((user, index) => ({ ...user, rowNumber: skip + index + 1, joinedContests: contestsByUser.get(String(user._id))?.joinedContests || 0, transactionTotal: transactionsByUser.get(String(user._id))?.transactionTotal || 0, transactionCount: transactionsByUser.get(String(user._id))?.transactionCount || 0 }));
    return { status: 200, data: { rows, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } } };
  }

  return { overview, list };
}

export const reportConfig = { REPORT_TYPES, PAGE_SIZE };
