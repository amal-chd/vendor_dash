import { describe, it, expect, vi, beforeEach } from "vitest";

// A Firestore batch takes at most 500 writes. The failure mode this guards is
// nasty precisely because it is invisible until scale: the hotel subscription
// cron batched an unlimited query, so it worked fine with 2 hotels and would
// have rejected the ENTIRE commit at 501 — moving none of them to grace, while
// looking like a cron with nothing to do.

const commits: number[] = [];
let batchSize = 0;

const fakeBatch = () => {
  batchSize = 0;
  return {
    update: () => { batchSize++; },
    set: () => { batchSize++; },
    delete: () => { batchSize++; },
    commit: async () => { commits.push(batchSize); },
  };
};

vi.mock("firebase-admin", () => ({
  firestore: () => ({ batch: fakeBatch }),
}));

const { commitInChunks } = await import("../src/batchWrite");

beforeEach(() => {
  commits.length = 0;
});

const docs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `d${i}` }));

describe("commitInChunks", () => {
  it("writes everything in a single commit when it fits", async () => {
    const written = await commitInChunks(docs(10), (b) => b.update());
    expect(written).toBe(10);
    expect(commits).toEqual([10]);
  });

  it("never exceeds Firestore's limit, however many documents arrive", async () => {
    const written = await commitInChunks(docs(1300), (b) => b.update());
    expect(written).toBe(1300);
    expect(commits).toEqual([450, 450, 400]);
    expect(Math.max(...commits)).toBeLessThan(500);
  });

  it("commits exactly once at the chunk boundary", async () => {
    await commitInChunks(docs(450), (b) => b.update());
    expect(commits).toEqual([450]);
  });

  it("does nothing, and commits nothing, for an empty list", async () => {
    const written = await commitInChunks([], (b) => b.update());
    expect(written).toBe(0);
    expect(commits).toEqual([]);
  });

  it("sizes the chunk in WRITES, not documents", async () => {
    // A caller that mirrors each row into an audit log does two writes per
    // document. Chunking by document count would put 2x450 = 900 writes in one
    // batch and be rejected for the same reason as the original bug.
    await commitInChunks(docs(500), (b) => { b.set(); b.set(); }, 2);
    expect(Math.max(...commits)).toBeLessThanOrEqual(450);
    expect(commits).toEqual([450, 450, 100]); // 225 docs, 225 docs, 50 docs
  });
});
