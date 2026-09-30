import { describe, expect, it } from "vitest";
import { checkBoundary } from "../src/rules.js";
import { fixtureContext, makeFixtureRepo, removeFixtureRepo } from "./helpers.js";

/** One context shared by read-only boundary tests. */
const withCtx = (fn: (root: string) => void): void => {
  const root = makeFixtureRepo();
  try {
    fn(root);
  } finally {
    removeFixtureRepo(root);
  }
};

describe("boundary containment", () => {
  it("rejects ../ traversal as outside the repo", () => {
    withCtx((root) => {
      const v = checkBoundary(fixtureContext(root), "../escape.txt", "write");
      expect(v.insideRepo).toBe(false);
      expect(v.allowed).toBe(false);
      expect(v.reason).toMatch(/traversal/);
      expect(v.matchedRule).toBeUndefined();
    });
  });

  it("rejects nested traversal like a/../../b", () => {
    withCtx((root) => {
      const v = checkBoundary(fixtureContext(root), "a/../../b.txt", "write");
      expect(v.insideRepo).toBe(false);
      expect(v.reason).toMatch(/traversal/);
    });
  });

  it("rejects absolute POSIX paths", () => {
    withCtx((root) => {
      const v = checkBoundary(fixtureContext(root), "/etc/hosts", "read");
      expect(v.insideRepo).toBe(false);
      expect(v.reason).toMatch(/absolute/i);
    });
  });

  it("rejects Windows drive paths", () => {
    withCtx((root) => {
      const v = checkBoundary(fixtureContext(root), "C:\\Windows\\system32", "read");
      expect(v.insideRepo).toBe(false);
    });
  });

  it("rejects null bytes", () => {
    withCtx((root) => {
      const v = checkBoundary(fixtureContext(root), "src/\0evil.txt", "write");
      expect(v.insideRepo).toBe(false);
      expect(v.reason).toMatch(/null byte/i);
    });
  });

  it("rejects dirty segments: '.' and empty", () => {
    withCtx((root) => {
      const dot = checkBoundary(fixtureContext(root), "src/./file.ts", "write");
      expect(dot.allowed).toBe(false);
      expect(dot.reason).toMatch(/clean/);
      const empty = checkBoundary(fixtureContext(root), "src//file.ts", "write");
      expect(empty.allowed).toBe(false);
      expect(empty.reason).toMatch(/clean/);
    });
  });

  it("allows clean repository-relative paths", () => {
    withCtx((root) => {
      const v = checkBoundary(fixtureContext(root), "src/records/store.ts", "write");
      expect(v.insideRepo).toBe(true);
      expect(v.allowed).toBe(true);
      expect(v.reason).toMatch(/no forbidden rule/);
    });
  });

  it("flags forbidden directories as inside the repo but not allowed, citing the rule", () => {
    withCtx((root) => {
      for (const path of ["dist/bundle.js", "node_modules/pkg/index.js", ".freebuff/state.json"]) {
        const v = checkBoundary(fixtureContext(root), path, "write");
        expect(v.insideRepo, path).toBe(true);
        expect(v.allowed, path).toBe(false);
        expect(v.matchedRule, path).toBe("no-internal-state");
      }
    });
  });

  it("matches dot-directories via dot: true", () => {
    withCtx((root) => {
      const v = checkBoundary(fixtureContext(root), ".freebuff/deep/nested/file", "read");
      expect(v.allowed).toBe(false);
    });
  });
});
