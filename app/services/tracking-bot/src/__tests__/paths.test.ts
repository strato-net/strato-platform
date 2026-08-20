import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchesAny, resolveInside } from "../workspace/paths";

describe("glob matcher", () => {
  const allowed = ["app/services/tracking/**", "docker-compose.tracking.tpl.yml", "BUILD_METADATA"];
  it("accepts files inside the tracking tree at any depth", () => {
    assert.equal(matchesAny("app/services/tracking/src/index.ts", allowed), true);
    assert.equal(matchesAny("app/services/tracking/ui/src/pages/LinksPage.tsx", allowed), true);
    assert.equal(matchesAny("app/services/tracking/README.md", allowed), true);
    assert.equal(matchesAny("docker-compose.tracking.tpl.yml", allowed), true);
    assert.equal(matchesAny("BUILD_METADATA", allowed), true);
  });
  it("rejects everything else", () => {
    assert.equal(matchesAny("app/ui/src/main.tsx", allowed), false);
    assert.equal(matchesAny("app/services/tracking-bot/src/index.ts", allowed), false);
    assert.equal(matchesAny("pipelines/Jenkinsfile.autobuild", allowed), false);
    assert.equal(matchesAny("docker-compose.tracking.tpl.yml.bak", allowed), false);
  });
  it("supports single-segment wildcards", () => {
    assert.equal(matchesAny("docs/readme.md", ["**/*.md"]), true);
    assert.equal(matchesAny("readme.md", ["**/*.md"]), true);
    assert.equal(matchesAny("src/a/b.ts", ["src/*.ts"]), false);
    assert.equal(matchesAny("src/b.ts", ["src/*.ts"]), true);
  });
  it("refuses path escapes", () => {
    assert.throws(() => resolveInside("/repo", "../etc/passwd"));
    assert.throws(() => resolveInside("/repo", "/etc/passwd"));
    assert.equal(resolveInside("/repo", "app/x.ts").rel, "app/x.ts");
    assert.equal(resolveInside("/repo", "./app/../app/x.ts").rel, "app/x.ts");
  });
});
