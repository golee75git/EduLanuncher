import { create } from "zustand";
import { EDUCATION_PACK, mergePackTools, type LauncherPack } from "../data/educationPack";
import { SAMPLE_TOOLS } from "../data/sampleTools";
import { loadTools, saveTools } from "../services/storageService";
import type { ToolItem } from "../types/tool";

interface ToolState {
  tools: ToolItem[];
  loaded: boolean;
  hydrate: (tools: ToolItem[]) => void;
  seedIfEmpty: () => Promise<void>;
  applyEducationPack: () => Promise<{ added: number; updated: number }>;
  applyLauncherPack: (pack: LauncherPack) => Promise<{ added: number; updated: number }>;
  addTool: (tool: ToolItem) => Promise<void>;
  updateTool: (id: string, patch: Partial<ToolItem>) => Promise<void>;
  removeTool: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  markUsed: (id: string) => Promise<void>;
  getById: (id: string) => ToolItem | undefined;
}

async function persist(tools: ToolItem[]): Promise<void> {
  await saveTools(tools);
}

function withOrigin(tools: ToolItem[]): ToolItem[] {
  const packIds = new Set(EDUCATION_PACK.tools.map((tool) => tool.id));
  return tools.map((tool) => {
    if (tool.origin) {
      return tool;
    }
    if (packIds.has(tool.id)) {
      return { ...tool, origin: "pack", packName: EDUCATION_PACK.name };
    }
    return { ...tool, origin: "local" };
  });
}

export const useToolStore = create<ToolState>((set, get) => ({
  tools: [],
  loaded: false,
  hydrate: (tools) => set({ tools: withOrigin(tools), loaded: true }),
  seedIfEmpty: async () => {
    if (get().tools.length > 0) {
      return;
    }
    const { tools } = mergePackTools(
      EDUCATION_PACK.tools.map((tool) => ({
        ...tool,
        origin: "pack" as const,
        packName: EDUCATION_PACK.name,
      })),
      SAMPLE_TOOLS.map((tool) => ({ ...tool, origin: "local" as const })),
    );
    set({ tools });
    await persist(tools);
  },
  applyEducationPack: async () => {
    const { tools, added, updated } = mergePackTools(get().tools, EDUCATION_PACK.tools, {
      name: EDUCATION_PACK.name,
    });
    set({ tools });
    await persist(tools);
    return { added, updated };
  },
  applyLauncherPack: async (pack) => {
    const { tools, added, updated } = mergePackTools(get().tools, pack.tools, { name: pack.name });
    set({ tools });
    await persist(tools);
    return { added, updated };
  },
  addTool: async (tool) => {
    const next = { ...tool, origin: tool.origin ?? "local" };
    const tools = [next, ...get().tools];
    set({ tools });
    await persist(tools);
  },
  updateTool: async (id, patch) => {
    const tools = get().tools.map((tool) => (tool.id === id ? { ...tool, ...patch } : tool));
    set({ tools });
    await persist(tools);
  },
  removeTool: async (id) => {
    const tools = get().tools.filter((tool) => tool.id !== id);
    set({ tools });
    await persist(tools);
  },
  toggleFavorite: async (id) => {
    const tools = get().tools.map((tool) =>
      tool.id === id ? { ...tool, favorite: !tool.favorite } : tool,
    );
    set({ tools });
    await persist(tools);
  },
  markUsed: async (id) => {
    const now = new Date().toISOString();
    const tools = get().tools.map((tool) =>
      tool.id === id
        ? {
            ...tool,
            lastUsedAt: now,
            usageCount: (tool.usageCount ?? 0) + 1,
          }
        : tool,
    );
    set({ tools });
    await persist(tools);
  },
  getById: (id) => get().tools.find((tool) => tool.id === id),
}));

export async function hydrateTools(): Promise<void> {
  const loaded = await loadTools();
  const tools = withOrigin(loaded);
  useToolStore.getState().hydrate(tools);
  if (loaded.some((tool) => !tool.origin)) {
    await persist(tools);
  }
}
