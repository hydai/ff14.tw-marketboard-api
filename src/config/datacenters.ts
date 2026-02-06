export interface World {
  id: number;
  name: string;
  nameEn: string;
}

export interface Datacenter {
  id: number;
  name: string;
  region: string;
  regionCode: number;
  worlds: World[];
}

export const DC_LUHANGNIAO: Datacenter = {
  id: 151,
  name: "陸行鳥",
  region: "繁中服",
  regionCode: 8,
  worlds: [
    { id: 4028, name: "伊弗利特", nameEn: "Ifrit" },
    { id: 4029, name: "迦樓羅", nameEn: "Garuda" },
    { id: 4030, name: "利維坦", nameEn: "Leviathan" },
    { id: 4031, name: "鳳凰", nameEn: "Phoenix" },
    { id: 4032, name: "奧汀", nameEn: "Odin" },
    { id: 4033, name: "巴哈姆特", nameEn: "Bahamut" },
    { id: 4034, name: "拉姆", nameEn: "Ramuh" },
    { id: 4035, name: "泰坦", nameEn: "Titan" },
  ],
};

export const WORLDS_BY_ID = new Map<number, World>(
  DC_LUHANGNIAO.worlds.map((w) => [w.id, w])
);

export const WORLDS_BY_NAME = new Map<string, World>(
  DC_LUHANGNIAO.worlds.map((w) => [w.name, w])
);

export const WORLDS_BY_EN_NAME = new Map<string, World>(
  DC_LUHANGNIAO.worlds.map((w) => [w.nameEn.toLowerCase(), w])
);

export function resolveWorld(nameOrId: string): World | undefined {
  const asNum = Number(nameOrId);
  if (!isNaN(asNum)) return WORLDS_BY_ID.get(asNum);
  return WORLDS_BY_NAME.get(nameOrId) ?? WORLDS_BY_EN_NAME.get(nameOrId.toLowerCase());
}
