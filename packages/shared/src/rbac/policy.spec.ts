import { describe, expect, it } from "vitest";
import { roleHasPermission } from "./policy";

describe("RBAC policy", () => {
  it("allows SuperAdmin high-risk data operations", () => {
    expect(roleHasPermission("SuperAdmin", "compensation:manage")).toBe(true);
    expect(roleHasPermission("SuperAdmin", "synthetic:manage")).toBe(true);
  });

  it("keeps Viewer read-only", () => {
    expect(roleHasPermission("Viewer", "dashboard:read")).toBe(true);
    expect(roleHasPermission("Viewer", "devices:manage")).toBe(false);
  });
});
