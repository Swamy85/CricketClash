const INDEX_NAME = "activeQueueKey_1";
const KEY_SPEC = { activeQueueKey: 1 };
const DESIRED_OPTIONS = {
  unique: true,
  partialFilterExpression: { activeQueueKey: { $type: "string" } },
};

function sameKeySpec(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasDesiredOptions(index) {
  return index.unique === true &&
    JSON.stringify(index.partialFilterExpression) === JSON.stringify(DESIRED_OPTIONS.partialFilterExpression) &&
    index.sparse !== true;
}

/**
 * Replace only the known legacy sparse queue index. Before replacement, ensure
 * every string key is unique; preserve all documents and fail startup safely
 * when the data cannot satisfy the intended constraint.
 */
export async function migrateContestQueueIndex(Contest) {
  const collection = Contest.collection;
  const indexes = await collection.indexes();
  const activeKeyIndex = indexes.find((index) => index.name === INDEX_NAME);

  if (!activeKeyIndex) return { action: "missing" };
  if (!sameKeySpec(activeKeyIndex.key, KEY_SPEC)) {
    throw new Error(`Cannot migrate ${INDEX_NAME}: existing index has an unexpected key specification.`);
  }
  if (hasDesiredOptions(activeKeyIndex)) return { action: "current" };

  const isKnownLegacyIndex = activeKeyIndex.unique === true && activeKeyIndex.sparse === true &&
    !activeKeyIndex.partialFilterExpression &&
    Object.keys(activeKeyIndex).every((key) => ["name", "key", "v", "ns", "unique", "sparse"].includes(key));
  if (!isKnownLegacyIndex) {
    throw new Error(`Cannot migrate ${INDEX_NAME}: existing index options are not the known legacy sparse definition.`);
  }

  const duplicates = await collection.aggregate([
    { $match: { activeQueueKey: { $type: "string" } } },
    { $group: { _id: "$activeQueueKey", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 5 },
  ]).toArray();
  if (duplicates.length) {
    const examples = duplicates.map(({ _id, count }) => `${_id} (${count})`).join(", ");
    throw new Error(`Cannot migrate ${INDEX_NAME}: duplicate string activeQueueKey values exist: ${examples}. Resolve queue data conflicts, then restart; no index or documents were changed.`);
  }

  // Two app processes may perform this startup migration together. A second
  // process can observe the legacy index, then find it already removed here.
  try {
    await collection.dropIndex(INDEX_NAME);
  } catch (error) {
    if (error?.code !== 27 && error?.codeName !== "IndexNotFound") throw error;
  }
  return { action: "legacy-replaced" };
}

export const contestQueueIndexDefinition = {
  name: INDEX_NAME,
  key: KEY_SPEC,
  options: DESIRED_OPTIONS,
};
