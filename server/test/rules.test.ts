import { describe, expect, it } from "vitest";
import { validateChanges, checkBoundary } from "../src/rules.js";
import type { ProjectContext } from "../src/config.js";
import type { RulesFile } from "../src/config.js";
import { DEFAULT_FIXTURE_RULES, fixtureContext, makeFixtureRepo, removeFixtureRepo } from "./helpers.js";

/** Context built from an inline rules file, without touching disk docs. */
function contextWith(rules: RulesFile): ProjectContext {
  const root = makeFixtureRepo({ rules });
  try {
    return fixtureContext(root);
  } finally {
    removeFixtureRepo(root);
  }
}

describe("forbidden rules", () => {
  it("flags changes inside forbidden directories as errors", () => {
    const ctx = contextWith({
      version: 1,
      rules: [
        {
          type: "forbidden",
          id: "no-dist",
          match: ["dist/**"],
          reason: "Build output.",
          severity: "error",
        },
      ],
    });
    const report = validateChanges(ctx, [{ path: "dist/bundle.js", changeType: "modify" }]);
    expect(report.valid).toBe(false);
    expect(report.violations[0]).toMatchObject({ ruleId: "no-dist", severity: "error", path: "dist/bundle.js" });
    expect(report.warnings).toHaveLength(0);
  });

  it("does not flag paths outside the rule's globs", () => {
    const ctx = contextWith({
      version: 1,
      rules: [
        { type: "forbidden", id: "no-dist", match: ["dist/**"], reason: "Build output.", severity: "error" },
      ],
    });
    const report = validateChanges(ctx, [{ path: "src/dist-lookalike.ts", changeType: "create" }]);
    expect(report.valid).toBe(true);
    expect(report.violations).toHaveLength(0);
  });
});

describe("requireAdr rules", () => {
  const acceptedCtx = (): ProjectContext => {
    const root = makeFixtureRepo();
    return fixtureContext(root);
  };

  it("passes when the referenced ADR is accepted", () => {
    const report = validateChanges(acceptedCtx(), [
      { path: "src/records/store.ts", changeType: "modify" },
      { path: "src/records/store.test.ts", changeType: "create" },
    ]);
    expect(report.violations).toHaveLength(0);
    expect(report.valid).toBe(true);
  });

  it("fails when the referenced ADR is only proposed, with an actionable message", () => {
    const report = validateChanges(acceptedCtx(), [{ path: "src/queues/worker.ts", changeType: "create" }]);
    expect(report.valid).toBe(false);
  });

  it("fails when the referenced ADR is missing from the repo", () => {
    const root = makeFixtureRepo({
      rules: {
        version: 1,
        rules: [
          {
            type: "requireAdr",
            id: "ghost-adr",
            match: ["src/x/**"],
            adr: "0042",
            reason: "Governed by a ghost.",
            severity: "error",
          },
        ],
      },
    });
    try {
      const report = validateChanges(fixtureContext(root), [{ path: "src/x/a.ts", changeType: "create" }]);
      expect(report.valid).toBe(false);
      expect(report.violations[0]?.message).toContain("ADR-0042 not found");
    } finally {
      removeFixtureRepo(root);
    }
  });

  it("ignores paths not matched by any rule (ADR nor requireTest)", () => {
    const report = validateChanges(acceptedCtx(), [
      { path: "docs/free/misc.md", changeType: "create" },
    ]);
    expect(report.violations).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
  });
});

describe("requireTest rules", () => {
  it("fails a src change with no test in the change set", () => {
    const root = makeFixtureRepo();
    try {
      const report = validateChanges(fixtureContext(root), [{ path: "src/index.ts", changeType: "modify" }]);
      expect(report.valid).toBe(false);
      expect(report.violations[0]?.ruleId).toBe("src-needs-tests");
      expect(report.violations[0]?.message).toContain("*.test.ts");
    } finally {
      removeFixtureRepo(root);
    }
  });

  it("passes when any change in the set matches testMatch", () => {
    const root = makeFixtureRepo();
    try {
      const report = validateChanges(fixtureContext(root), [
        { path: "src/index.ts", changeType: "modify" },
        { path: "test/index.test.ts", changeType: "create" },
      ]);
      expect(report.valid).toBe(true);
    } finally {
      removeFixtureRepo(root);
    }
  });

  it("honors testExempt globs", () => {
    const root = makeFixtureRepo();
    try {
      const report = validateChanges(fixtureContext(root), [{ path: "src/types.d.ts", changeType: "modify" }]);
      expect(report.valid).toBe(true);
    } finally {
      removeFixtureRepo(root);
    }
  });

  it("a test-only change set does not satisfy the rule for itself", () => {
    const root = makeFixtureRepo();
    try {
      // test file matches testMatch, so src-needs-tests is satisfied; but the
      // test file itself is not matched by the rule's match globs (src/**).
      const report = validateChanges(fixtureContext(root), [{ path: "test/solo.test.ts", changeType: "create" }]);
      expect(report.valid).toBe(true);
      expect(report.violations).toHaveLength(0);
    } finally {
      removeFixtureRepo(root);
    }
  });
});

describe("requireDocUpdate rules", () => {
  it("warns (not fails) when the required doc is absent from the change set", () => {
    const root = makeFixtureRepo();
    try {
      const report = validateChanges(fixtureContext(root), [
        { path: "src/records/store.ts", changeType: "modify" },
        { path: "src/records/store.test.ts", changeType: "create" },
      ]);
      expect(report.valid).toBe(true);
      // one advisory per matched change (store.ts and store.test.ts both match)
      expect(report.warnings).toHaveLength(2);
      expect(report.warnings.every((w) => w.ruleId === "architecture-docs-stale" && w.severity === "warning")).toBe(true);
      expect(report.requiredActions[0]).toContain("[architecture-docs-stale]");
      expect(report.requiredActions[0]).toContain("docs/ARCHITECTURE.md");
    } finally {
      removeFixtureRepo(root);
    }
  });

  it("clears when the doc is part of the change set", () => {
    const root = makeFixtureRepo();
    try {
      const report = validateChanges(fixtureContext(root), [
        { path: "src/records/store.ts", changeType: "modify" },
        { path: "src/records/store.test.ts", changeType: "create" },
        { path: "docs/ARCHITECTURE.md", changeType: "modify" },
      ]);
      expect(report.warnings).toHaveLength(0);
      expect(report.requiredActions).toHaveLength(0);
    } finally {
      removeFixtureRepo(root);
    }
  });

  it("does not count a deleted doc as an update", () => {
    const root = makeFixtureRepo();
    try {
      const report = validateChanges(fixtureContext(root), [
        { path: "src/records/store.ts", changeType: "modify" },
        { path: "src/records/store.test.ts", changeType: "create" },
        { path: "docs/ARCHITECTURE.md", changeType: "delete" },
      ]);
      // the deleted doc does not satisfy the rule: still one advisory per matched change
      expect(report.warnings).toHaveLength(2);
    } finally {
      removeFixtureRepo(root);
    }
  });
});

describe("report shape", () => {
  it("emits requiredActions for both violations and warnings, prefixed by rule id", () => {
    const root = makeFixtureRepo();
    try {
      const ctx = fixtureContext(root);
      const report = validateChanges(ctx, [
        { path: "node_modules/pkg/index.js", changeType: "create" },
        { path: "src/records/store.ts", changeType: "modify" },
        { path: "src/records/store.test.ts", changeType: "create" },
      ]);
      // forbidden path: error; each records change: doc-update warning (ADR-0001 is accepted)
      expect(report.valid).toBe(false);
      expect(report.violations).toHaveLength(1);
      expect(report.violations[0]?.ruleId).toBe("no-internal-state");
      expect(report.warnings).toHaveLength(2);
      expect(report.requiredActions).toHaveLength(3);
      expect(report.requiredActions.every((a) => /^\[.+\] .+: .+$/.test(a))).toBe(true);
    } finally {
      removeFixtureRepo(root);
    }
  });

  it("deduplicates repeated paths", () => {
    const root = makeFixtureRepo();
    try {
      const report = validateChanges(fixtureContext(root), [
        { path: "src/index.ts", changeType: "modify" },
        { path: "src/index.ts", changeType: "modify" },
      ]);
      expect(report.violations).toHaveLength(1);
    } finally {
      removeFixtureRepo(root);
    }
  });

  it("reports out-of-bounds paths as errors and skips rule matching for them", () => {
    const root = makeFixtureRepo();
    try {
      const report = validateChanges(fixtureContext(root), [
        { path: "../escape.ts", changeType: "create" },
        { path: "node_modules/pkg/index.js", changeType: "create" },
      ]);
      expect(report.valid).toBe(false);
      expect(report.violations.map((v) => v.path)).toEqual(["../escape.ts", "node_modules/pkg/index.js"]);
      expect(report.violations[0]?.message).toContain("traversal");
    } finally {
      removeFixtureRepo(root);
    }
  });

  it("accepts the default fixture rules verbatim", () => {
    expect(DEFAULT_FIXTURE_RULES.version).toBe(1);
    expect(DEFAULT_FIXTURE_RULES.rules).toHaveLength(4);
  });
});
