import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The four Flutter apps share one "What's new" implementation, copied into
// each app's lib/changelog/. If one copy is patched and the others aren't,
// customers, restaurants, riders and hosts start seeing different behaviour
// for the same release note — this keeps them in lockstep.

import { existsSync } from "node:fs";

const ROOT = existsSync(join(__dirname, "..", "..", "..", "..", "Mobile Apps"))
  ? join(__dirname, "..", "..", "..", "..", "Mobile Apps")
  : join(__dirname, "..", "..", "..", "Mobile Apps");
const APPS = ["customer_mobile_app", "vendor_mobile_app", "delivery_mobile_app", "host_mobile_app"];
const FILES = ["changelog_models.dart", "changelog_service.dart", "whats_new_screen.dart"];

describe("Flutter changelog files stay identical across apps", () => {
  for (const file of FILES) {
    it(`${file} matches in all four apps`, () => {
      const reference = readFileSync(join(ROOT, APPS[0], "lib", "changelog", file), "utf8");
      for (const app of APPS.slice(1)) {
        const copy = readFileSync(join(ROOT, app, "lib", "changelog", file), "utf8");
        expect(copy, `${app}/lib/changelog/${file} has drifted from ${APPS[0]}`).toBe(reference);
      }
    });
  }

  // The apps render the server's block tree; if the server adds a block type
  // the Dart renderer doesn't know, it is silently skipped. Keep them aligned.
  it("renders every block type the server parser can emit", () => {
    const parser = readFileSync(join(__dirname, "..", "src", "changelog", "markdown.ts"), "utf8");
    const dart = readFileSync(join(ROOT, APPS[0], "lib", "changelog", "changelog_models.dart"), "utf8");
    const serverTypes = new Set<string>();
    for (const m of parser.matchAll(/t: "([a-z0-9]+)"/g)) serverTypes.add(m[1]);
    for (const m of parser.matchAll(/\| \{ t: "([a-z0-9]+)"(?: \| "([a-z0-9]+)")*/g)) {
      serverTypes.add(m[1]);
    }
    for (const t of ["h2", "h3", "p", "quote", "ul", "ol", "img", "hr"]) serverTypes.add(t);
    for (const t of serverTypes) {
      expect(dart, `Dart model does not handle block type "${t}"`).toContain(`'${t}'`);
    }
  });
});
