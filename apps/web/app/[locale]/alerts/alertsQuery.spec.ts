import { describe, expect, it } from "vitest";
import { buildAlertsListPath } from "./alertsQuery";

describe("buildAlertsListPath", () => {
  it("omits empty and all filters", () => {
    expect(buildAlertsListPath({ current: 1, pageSize: 20, status: "", level: "all" })).toBe("/alerts?page=1&pageSize=20");
  });

  it("keeps valid filters", () => {
    expect(buildAlertsListPath({ current: 2, pageSize: 50, status: "active", level: "warning" })).toBe(
      "/alerts?page=2&pageSize=50&status=active&level=warning"
    );
  });
});
