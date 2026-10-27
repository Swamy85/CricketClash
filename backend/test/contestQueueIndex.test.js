import test from "node:test";
import assert from "node:assert/strict";
import Contest from "../src/models/Contest.js";
import { contestQueueIndexDefinition, migrateContestQueueIndex } from "../src/services/contestQueueIndexService.js";

function modelWithIndexes(indexes, duplicateKeys = []) {
  const state = { indexes: structuredClone(indexes), aggregateCalls: 0, drops: 0 };
  return {
    state,
    collection: {
      async indexes() { return state.indexes; },
      aggregate(pipeline) {
        state.aggregateCalls += 1;
        assert.deepEqual(pipeline[0], { $match: { activeQueueKey: { $type: "string" } } });
        return { async toArray() { return duplicateKeys; } };
      },
      async dropIndex(name) {
        assert.equal(name, "activeQueueKey_1");
        state.drops += 1;
        state.indexes = state.indexes.filter((index) => index.name !== name);
      },
    },
  };
}

const oldSparseIndex = {
  name: "activeQueueKey_1",
  key: { activeQueueKey: 1 },
  unique: true,
  sparse: true,
};
const currentIndex = {
  name: contestQueueIndexDefinition.name,
  key: contestQueueIndexDefinition.key,
  ...contestQueueIndexDefinition.options,
};

test("Contest schema declares unique string-only queue keys and disables unsafe auto-indexing", () => {
  const queueIndex = Contest.schema.indexes().find(([keys]) => keys.activeQueueKey === 1);
  assert.deepEqual(queueIndex[0], { activeQueueKey: 1 });
  assert.equal(queueIndex[1].unique, true);
  assert.deepEqual(queueIndex[1].partialFilterExpression, { activeQueueKey: { $type: "string" } });
  assert.equal(Contest.schema.options.autoIndex, false);
});

test("queue index migration replaces only the known sparse index after checking duplicate string keys", async () => {
  const Model = modelWithIndexes([oldSparseIndex]);
  assert.deepEqual(await migrateContestQueueIndex(Model), { action: "legacy-replaced" });
  assert.equal(Model.state.aggregateCalls, 1);
  assert.equal(Model.state.drops, 1);
});

test("queue index migration refuses duplicate keys without dropping the existing index", async () => {
  const Model = modelWithIndexes([oldSparseIndex], [{ _id: "match:tier", count: 2 }]);
  await assert.rejects(migrateContestQueueIndex(Model), /duplicate string activeQueueKey values/);
  assert.equal(Model.state.drops, 0);
  assert.equal(Model.state.indexes[0].sparse, true);
});

test("queue index migration is idempotent for the desired index", async () => {
  const Model = modelWithIndexes([currentIndex]);
  assert.deepEqual(await migrateContestQueueIndex(Model), { action: "current" });
  assert.equal(Model.state.aggregateCalls, 0);
  assert.equal(Model.state.drops, 0);
});

test("queue index migration refuses unknown index definitions without modifying them", async () => {
  const unknown = { ...oldSparseIndex, expireAfterSeconds: 30 };
  const Model = modelWithIndexes([unknown]);
  await assert.rejects(migrateContestQueueIndex(Model), /not the known legacy sparse definition/);
  assert.equal(Model.state.drops, 0);
});
