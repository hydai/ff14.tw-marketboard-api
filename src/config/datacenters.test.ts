import { describe, it, expect } from "vitest";
import {
  resolveWorld,
  DC_LUHANGNIAO,
  WORLDS_BY_ID,
  WORLDS_BY_NAME,
  WORLDS_BY_EN_NAME,
} from "./datacenters.js";

describe("DC_LUHANGNIAO", () => {
  it("has correct id", () => {
    expect(DC_LUHANGNIAO.id).toBe(151);
  });

  it("has correct name", () => {
    expect(DC_LUHANGNIAO.name).toBe("陸行鳥");
  });

  it("has 8 worlds", () => {
    expect(DC_LUHANGNIAO.worlds).toHaveLength(8);
  });
});

describe("world maps", () => {
  it("WORLDS_BY_ID has 8 entries", () => {
    expect(WORLDS_BY_ID.size).toBe(8);
  });

  it("WORLDS_BY_NAME has 8 entries", () => {
    expect(WORLDS_BY_NAME.size).toBe(8);
  });

  it("WORLDS_BY_EN_NAME has 8 entries", () => {
    expect(WORLDS_BY_EN_NAME.size).toBe(8);
  });

  it("WORLDS_BY_EN_NAME stores lowercase keys", () => {
    expect(WORLDS_BY_EN_NAME.has("ifrit")).toBe(true);
    expect(WORLDS_BY_EN_NAME.has("Ifrit")).toBe(false);
  });
});

describe("resolveWorld", () => {
  it("resolves by numeric ID string", () => {
    const world = resolveWorld("4028");
    expect(world).toBeDefined();
    expect(world!.nameEn).toBe("Ifrit");
  });

  it("resolves Titan by ID", () => {
    const world = resolveWorld("4035");
    expect(world).toBeDefined();
    expect(world!.nameEn).toBe("Titan");
  });

  it("resolves by Chinese name", () => {
    const world = resolveWorld("伊弗利特");
    expect(world).toBeDefined();
    expect(world!.nameEn).toBe("Ifrit");
  });

  it("resolves Bahamut by Chinese name", () => {
    const world = resolveWorld("巴哈姆特");
    expect(world).toBeDefined();
    expect(world!.nameEn).toBe("Bahamut");
  });

  it("resolves by English name (exact case)", () => {
    const world = resolveWorld("Ifrit");
    expect(world).toBeDefined();
    expect(world!.id).toBe(4028);
  });

  it("resolves by English name (case-insensitive)", () => {
    expect(resolveWorld("ifrit")?.id).toBe(4028);
    expect(resolveWorld("IFRIT")?.id).toBe(4028);
    expect(resolveWorld("iFrIt")?.id).toBe(4028);
  });

  it("returns undefined for unknown numeric ID", () => {
    expect(resolveWorld("9999")).toBeUndefined();
  });

  it("returns undefined for unknown name", () => {
    expect(resolveWorld("NonExistent")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(resolveWorld("")).toBeUndefined();
  });
});
