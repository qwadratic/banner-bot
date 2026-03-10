import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG } from "./config.js";

const CONFIG_PATH = path.resolve(process.cwd(), "runtime-config.json");

interface RuntimeOverrides {
  haikusSystemPrompt?: string;
  sonnetSystemPrompt?: string;
  imagePromptTemplate?: string;
  doctorPortrait?: { path: string; promptHint: string };
  bannerStyles?: Array<{ path: string | null; role: string; promptHint: string }>;
  stageModuleDefaults?: Record<string, Record<string, string>>;
  moduleOptions?: Record<string, string[]>;
}

let overrides: RuntimeOverrides = {};

export function initRuntimeConfig(): void {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      overrides = JSON.parse(raw);
    }
  } catch {
    overrides = {};
  }
}

function persist(): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(overrides, null, 2), "utf-8");
}

// ── Getters ──────────────────────────────────────────────────────────────

export function getHaikuPrompt(): string {
  return overrides.haikusSystemPrompt ?? CONFIG.haikusSystemPrompt;
}

export function getSonnetPrompt(): string {
  return overrides.sonnetSystemPrompt ?? CONFIG.sonnetSystemPrompt;
}

export function getImageTemplate(): string {
  return overrides.imagePromptTemplate ?? CONFIG.imagePromptTemplate;
}

export function getDoctorPortrait(): { path: string; role: string; promptHint: string } {
  if (overrides.doctorPortrait) {
    return { ...overrides.doctorPortrait, role: "identity" };
  }
  return { ...CONFIG.referenceAssets.doctorPortrait };
}

export function getBannerStyles(): Array<{ path: string | null; role: string; promptHint: string }> {
  if (overrides.bannerStyles) {
    return overrides.bannerStyles.map((s) => ({ ...s }));
  }
  return CONFIG.referenceAssets.bannerStyles.map((s) => ({ ...s }));
}

export function getStageModuleDefaults(): Record<string, Record<string, string>> {
  if (overrides.stageModuleDefaults) {
    return overrides.stageModuleDefaults;
  }
  return CONFIG.stageModuleDefaults;
}

export function getModuleOptions(): Record<string, string[]> {
  if (overrides.moduleOptions) {
    return overrides.moduleOptions;
  }
  return CONFIG.moduleOptions;
}

// ── Setters ──────────────────────────────────────────────────────────────

export function setHaikuPrompt(value: string): void {
  overrides.haikusSystemPrompt = value;
  persist();
}

export function setSonnetPrompt(value: string): void {
  overrides.sonnetSystemPrompt = value;
  persist();
}

export function setImageTemplate(value: string): void {
  overrides.imagePromptTemplate = value;
  persist();
}

export function setDoctorPortrait(filePath: string, promptHint?: string): void {
  const current = getDoctorPortrait();
  overrides.doctorPortrait = {
    path: filePath,
    promptHint: promptHint ?? current.promptHint,
  };
  persist();
}

export function setDoctorAnnotation(promptHint: string): void {
  const current = getDoctorPortrait();
  overrides.doctorPortrait = {
    path: current.path,
    promptHint,
  };
  persist();
}

export function deleteDoctorPortrait(): void {
  if (overrides.doctorPortrait?.path?.includes("_rt.")) {
    try {
      fs.unlinkSync(path.resolve(process.cwd(), overrides.doctorPortrait.path));
    } catch { /* ignore */ }
  }
  // Set path to null-equivalent — override with empty path
  overrides.doctorPortrait = {
    path: "",
    promptHint: getDoctorPortrait().promptHint,
  };
  persist();
}

export function setBannerStyle(index: number, filePath: string | null, promptHint?: string): void {
  if (!overrides.bannerStyles) {
    overrides.bannerStyles = CONFIG.referenceAssets.bannerStyles.map((s) => ({ ...s }));
  }
  while (overrides.bannerStyles.length <= index) {
    overrides.bannerStyles.push({ path: null, role: "style", promptHint: "" });
  }
  overrides.bannerStyles[index] = {
    path: filePath,
    role: "style",
    promptHint: promptHint ?? overrides.bannerStyles[index]?.promptHint ?? "",
  };
  persist();
}

export function setBannerAnnotation(index: number, promptHint: string): void {
  if (!overrides.bannerStyles) {
    overrides.bannerStyles = CONFIG.referenceAssets.bannerStyles.map((s) => ({ ...s }));
  }
  if (overrides.bannerStyles[index]) {
    overrides.bannerStyles[index].promptHint = promptHint;
  }
  persist();
}

export function deleteBannerStyle(index: number): void {
  if (!overrides.bannerStyles) {
    overrides.bannerStyles = CONFIG.referenceAssets.bannerStyles.map((s) => ({ ...s }));
  }
  if (overrides.bannerStyles[index]) {
    if (overrides.bannerStyles[index].path?.includes("_rt.")) {
      try {
        fs.unlinkSync(path.resolve(process.cwd(), overrides.bannerStyles[index].path!));
      } catch { /* ignore */ }
    }
    overrides.bannerStyles[index].path = null;
  }
  persist();
}

export function setStageModuleDefault(stage: string, module: string, value: string): void {
  if (!overrides.stageModuleDefaults) {
    overrides.stageModuleDefaults = JSON.parse(JSON.stringify(CONFIG.stageModuleDefaults));
  }
  if (!overrides.stageModuleDefaults![stage]) {
    const base = (CONFIG.stageModuleDefaults as Record<string, Record<string, string>>)[stage];
    overrides.stageModuleDefaults![stage] = base ? { ...base } : {};
  }
  overrides.stageModuleDefaults![stage][module] = value;
  persist();
}

export function addModuleOption(category: string, option: string): boolean {
  if (!overrides.moduleOptions) {
    overrides.moduleOptions = JSON.parse(JSON.stringify(CONFIG.moduleOptions));
  }
  if (!overrides.moduleOptions![category]) {
    const base = (CONFIG.moduleOptions as Record<string, string[]>)[category];
    overrides.moduleOptions![category] = base ? [...base] : [];
  }
  if (overrides.moduleOptions![category].includes(option)) return false;
  overrides.moduleOptions![category].push(option);
  persist();
  return true;
}

export function removeModuleOption(category: string, option: string): boolean {
  if (!overrides.moduleOptions) {
    overrides.moduleOptions = JSON.parse(JSON.stringify(CONFIG.moduleOptions));
  }
  if (!overrides.moduleOptions![category]) return false;
  const idx = overrides.moduleOptions![category].indexOf(option);
  if (idx === -1) return false;
  overrides.moduleOptions![category].splice(idx, 1);
  persist();
  return true;
}

export function resetField(field: keyof RuntimeOverrides): void {
  // Clean up uploaded files if resetting assets
  if (field === "doctorPortrait" && overrides.doctorPortrait?.path?.includes("_rt.")) {
    try {
      fs.unlinkSync(path.resolve(process.cwd(), overrides.doctorPortrait.path));
    } catch { /* ignore */ }
  }
  if (field === "bannerStyles" && overrides.bannerStyles) {
    for (const s of overrides.bannerStyles) {
      if (s.path?.includes("_rt.")) {
        try { fs.unlinkSync(path.resolve(process.cwd(), s.path)); } catch { /* ignore */ }
      }
    }
  }
  delete overrides[field];
  persist();
}

export function hasOverride(field: keyof RuntimeOverrides): boolean {
  return field in overrides && overrides[field] !== undefined;
}
