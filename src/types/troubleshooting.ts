export const TROUBLE_CATEGORIES = ["network", "printer", "windows"] as const;

export type TroubleCategory = (typeof TROUBLE_CATEGORIES)[number];

export type TroubleRisk = "safe" | "caution" | "danger";

export interface TroubleOption {
  label: string;
  next: string;
}

export interface TroubleQuestion {
  id: string;
  question: string;
  options: TroubleOption[];
}

export interface TroubleSolution {
  id: string;
  name: string;
  difficulty: string;
  risk: TroubleRisk;
  adminRequired: boolean;
  estimatedTime: string;
  dataLossRisk: string;
  prerequisites: string[];
  steps: string[];
  nextIfUnresolved: string;
}

export interface TroubleSource {
  publisher: string;
  title: string;
  type: string;
  url: string;
}

export interface TroubleSupport {
  message: string;
  collect: string[];
}

export interface TroubleCard {
  id: string;
  category: TroubleCategory;
  title: string;
  aliases: string[];
  keywords: string[];
  symptoms: string[];
  errorMessages: string[];
  windowsVersion: string;
  environment: string[];
  risk: TroubleRisk;
  adminRequired: boolean;
  actionType: string;
  organizationNotice: string;
  questions: TroubleQuestion[];
  solutions: TroubleSolution[];
  related: string[];
  sources: TroubleSource[];
  support: TroubleSupport;
}

export const TROUBLE_CATEGORY_LABEL: Record<TroubleCategory, string> = {
  network: "인터넷",
  printer: "프린터",
  windows: "Windows",
};
