import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { DEFAULT_PUBLICATION_ID, getDbInstance, settings } from "../db";

export type Settings = {
  clientName: string;
  clientTagline: string;
  clientLogoUrl: string;
  clientFaviconUrl: string;
  emailFromLocal: string;
  aboutBodyEn: string;
  aboutBodyPt: string;
  // Light theme colors
  themePrimaryColor: string;
  colorBgLight: string;
  colorHeaderBgLight: string;
  colorHeadingLight: string;
  colorTextLight: string;
  colorMutedLight: string;
  colorBorderLight: string;
  // Dark theme colors
  colorBgDark: string;
  colorHeaderBgDark: string;
  colorHeadingDark: string;
  colorTextDark: string;
  colorMutedDark: string;
  colorBorderDark: string;
  // Embeddable widget defaults (overridable per-embed via query string)
  widgetDefaultTheme: string; // 'auto' | 'light' | 'dark'
  widgetDefaultLimit: string; // integer string, e.g. '5'
  widgetShowDate: string; // '0' | '1'
  widgetShowExcerpts: string; // '0' | '1'
  widgetMaxWidth: string; // CSS length, e.g. '720px' or ''
  widgetAccentOverride: string; // hex or ''
  widgetAllowedOrigins: string; // comma-separated origins or '*' (informational; CSP allows all parents)
  widgetHideWatermark: string; // '0' show "Powered by Rubrion" pill (default), '1' hide (white-label)
};

export const SETTING_KEYS = [
  "clientName",
  "clientTagline",
  "clientLogoUrl",
  "clientFaviconUrl",
  "emailFromLocal",
  "aboutBodyEn",
  "aboutBodyPt",
  "themePrimaryColor",
  "colorBgLight",
  "colorHeaderBgLight",
  "colorHeadingLight",
  "colorTextLight",
  "colorMutedLight",
  "colorBorderLight",
  "colorBgDark",
  "colorHeaderBgDark",
  "colorHeadingDark",
  "colorTextDark",
  "colorMutedDark",
  "colorBorderDark",
  "widgetDefaultTheme",
  "widgetDefaultLimit",
  "widgetShowDate",
  "widgetShowExcerpts",
  "widgetMaxWidth",
  "widgetAccentOverride",
  "widgetAllowedOrigins",
  "widgetHideWatermark",
] as const satisfies readonly (keyof Settings)[];

export type SettingKey = (typeof SETTING_KEYS)[number];

export const COLOR_KEYS = [
  "themePrimaryColor",
  "colorBgLight",
  "colorHeaderBgLight",
  "colorHeadingLight",
  "colorTextLight",
  "colorMutedLight",
  "colorBorderLight",
  "colorBgDark",
  "colorHeaderBgDark",
  "colorHeadingDark",
  "colorTextDark",
  "colorMutedDark",
  "colorBorderDark",
] as const satisfies readonly SettingKey[];

export type ColorKey = (typeof COLOR_KEYS)[number];

const FALLBACKS: Settings = {
  clientName: "EdgeLetter",
  clientTagline: "",
  clientLogoUrl: "",
  clientFaviconUrl: "",
  emailFromLocal: "noreply",
  aboutBodyEn:
    "{name} is a newsletter and blog. Subscribe to receive new posts in your inbox.",
  aboutBodyPt:
    "{name} é uma newsletter e blog. Assine para receber novas publicações na sua caixa de entrada.",
  themePrimaryColor: "#B44A27",
  // Tactile Editorial Stationery defaults: parchment + espresso ink (light),
  // espresso paper + ivory ink (dark). Tenants override via /admin/settings.
  colorBgLight: "#E7E4DE",
  colorHeaderBgLight: "#F5F3EE",
  colorHeadingLight: "#2A231D",
  colorTextLight: "#3A3129",
  colorMutedLight: "#7A6E62",
  colorBorderLight: "#D8D3CA",
  colorBgDark: "#1A1612",
  colorHeaderBgDark: "#241E19",
  colorHeadingDark: "#F5F3EE",
  colorTextDark: "#E2DCD2",
  colorMutedDark: "#A39684",
  colorBorderDark: "#3A322B",
  widgetDefaultTheme: "auto",
  widgetDefaultLimit: "5",
  widgetShowDate: "1",
  widgetShowExcerpts: "0",
  widgetMaxWidth: "",
  widgetAccentOverride: "",
  widgetAllowedOrigins: "*",
  widgetHideWatermark: "0",
};

// Optional seed-fallback env-var name for each setting. Vars may or may not be
// in wrangler.jsonc; we look them up by string against an unknown-cast env bag.
// emailFromLocal has no env fallback (the legacy EMAIL_FROM_ADDRESS was a full
// address, not a local-part).
const ENV_KEY: Partial<Record<SettingKey, string>> = {
  clientName: "CLIENT_NAME",
  clientTagline: "CLIENT_TAGLINE",
  clientLogoUrl: "CLIENT_LOGO_URL",
  clientFaviconUrl: "CLIENT_FAVICON_URL",
  themePrimaryColor: "THEME_PRIMARY_COLOR",
};

// Env seeds only apply to the default publication (single-tenant deploys);
// self-serve publications start from FALLBACKS.
const envValue = (publicationId: string, key: SettingKey): string => {
  if (publicationId !== DEFAULT_PUBLICATION_ID) return "";
  const name = ENV_KEY[key];
  if (!name) return "";
  const v = (env as unknown as Record<string, string | undefined>)[name];
  return typeof v === "string" ? v : "";
};

// Header, footer, head and page each ask for settings on one request; a short
// per-isolate cache keeps that to one D1 read. Saves invalidate it.
const CACHE_TTL_MS = 5_000;
const cache = new Map<string, { value: Settings; at: number }>();

export const loadSettings = async (publicationId: string): Promise<Settings> => {
  const hit = cache.get(publicationId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let rows: { key: string; value: string }[] = [];
  try {
    rows = await getDbInstance()
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(eq(settings.publicationId, publicationId));
  } catch {
    // Settings table may not exist yet (e.g. fresh deploy before migration). Fall back gracefully.
    rows = [];
  }
  const dbMap = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const out = {} as Settings;
  for (const key of SETTING_KEYS) {
    out[key] = (dbMap[key]?.trim() ||
      envValue(publicationId, key).trim() ||
      FALLBACKS[key]) as string;
  }
  cache.set(publicationId, { value: out, at: Date.now() });
  return out;
};

export const saveSettings = async (publicationId: string, patch: Partial<Settings>): Promise<void> => {
  const db = getDbInstance();
  const now = new Date();
  cache.delete(publicationId);
  for (const key of SETTING_KEYS) {
    if (!(key in patch)) continue;
    const raw = patch[key];
    if (raw === undefined) continue;
    const value = raw.trim();
    if (value === "") {
      // Empty ⇒ revert to env fallback by removing the override row.
      await db
        .delete(settings)
        .where(and(eq(settings.publicationId, publicationId), eq(settings.key, key)));
      continue;
    }
    await db
      .insert(settings)
      .values({ publicationId, key, value, updatedAt: now })
      .onConflictDoUpdate({
        target: [settings.publicationId, settings.key],
        set: { value, updatedAt: now },
      });
  }
  cache.delete(publicationId);
};

// Convert "#RRGGBB" / "#RGB" to "r, g, b" tuple string, suitable for use in
// `rgb(var(--token))` / `rgba(var(--token), x%)` in global.css.
export const hexToRgbTuple = (hex: string): string => {
  const m = hex.trim().replace(/^#/, "");
  const expand =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  if (!/^[0-9a-fA-F]{6}$/.test(expand)) return "0, 0, 0";
  const n = parseInt(expand, 16);
  return `${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}`;
};
