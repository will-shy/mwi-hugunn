import { gameData } from "./game-data";
import type { I18nAPI } from "./types";

class LiteI18n implements I18nAPI {
  getLang(): "zh" | "en" {
    try {
      const lng = localStorage.getItem("i18nextLng") || "";
      if (lng.toLowerCase().startsWith("zh")) return "zh";
      if (lng.toLowerCase().startsWith("en")) return "en";
    } catch {
      // Ignore
    }
    const htmlLang = document.documentElement?.lang?.toLowerCase() || "";
    if (htmlLang.startsWith("zh")) return "zh";
    if (location.hostname.includes("milkywayidlecn")) return "zh";
    const reactLang = gameData.getReactGameCore()?.language;
    if (typeof reactLang === "string" && reactLang.toLowerCase().startsWith("zh")) return "zh";
    return "en";
  }

  isZh(): boolean {
    return this.getLang() === "zh";
  }

  t(zh: string, en: string): string {
    return this.isZh() ? zh : en;
  }

  getName(hrid: string, category: string): string {
    if (!hrid) return "";
    const core = gameData.getReactGameCore();
    const lang = core?.language || this.getLang();
    const dict = core?.props?.i18n?.options?.resources?.[lang]?.translation?.[category];
    if (dict && typeof dict[hrid] === "string") {
      return dict[hrid];
    }
    return "";
  }

  getItemName(itemHrid: string): string {
    const translated = this.getName(itemHrid, "itemNames");
    if (translated) return translated;
    const detail = gameData.getClientData()?.itemDetailMap?.[itemHrid];
    return detail?.name || itemHrid.replace("/items/", "").replace(/_/g, " ");
  }

  getActionName(actionHrid: string): string {
    const translated = this.getName(actionHrid, "actionNames");
    if (translated) return translated;
    const detail = gameData.getClientData()?.actionDetailMap?.[actionHrid];
    return detail?.name || actionHrid.replace("/actions/", "").replace(/_/g, " ");
  }

  getSkillName(skillHrid: string): string {
    const translated = this.getName(skillHrid, "skillNames");
    if (translated) return translated;
    const detail = gameData.getClientData()?.skillDetailMap?.[skillHrid];
    return detail?.name || skillHrid.replace("/skills/", "").replace(/_/g, " ");
  }

  getMonsterName(monsterHrid: string): string {
    const translated = this.getName(monsterHrid, "monsterNames");
    if (translated) return translated;
    const detail = gameData.getClientData()?.monsterDetailMap?.[monsterHrid];
    return detail?.name || monsterHrid.replace("/monsters/", "").replace(/_/g, " ");
  }

  getHouseRoomName(roomHrid: string): string {
    const translated = this.getName(roomHrid, "houseRoomNames");
    if (translated) return translated;
    const detail = gameData.getClientData()?.houseRoomDetailMap?.[roomHrid];
    return detail?.name || roomHrid.replace("/house_rooms/", "").replace(/_/g, " ");
  }

  getItemHridByName(name: string): string | null {
    const target = name.trim().toLowerCase();
    if (!target) return null;

    const core = gameData.getReactGameCore();
    const resources = core?.props?.i18n?.options?.resources;
    const langs = [core?.language, this.getLang(), "zh", "en"].filter(Boolean) as string[];
    for (const lang of langs) {
      const itemNames = resources?.[lang]?.translation?.itemNames;
      if (!itemNames) continue;
      for (const [hrid, label] of Object.entries(itemNames)) {
        if (typeof label === "string" && label.trim().toLowerCase() === target) {
          return hrid;
        }
      }
    }

    const itemMap = gameData.getClientData()?.itemDetailMap;
    if (itemMap) {
      for (const [hrid, item] of Object.entries<any>(itemMap)) {
        if (typeof item?.name === "string" && item.name.trim().toLowerCase() === target) {
          return hrid;
        }
      }
    }
    return null;
  }
}

export const i18n: I18nAPI = new LiteI18n();
