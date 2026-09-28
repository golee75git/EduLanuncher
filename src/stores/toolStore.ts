import { create } from "zustand";
import { EDUCATION_PACK, mergePackTools, type LauncherPack } from "../data/educationPack";
import {
  COMMON_WORK_TOOLS,
  DOC_SHRINK_TOOL,
  PDF_PAGES_TOOL,
  PRIVACY_MASK_TOOL,
  URL_MARK_TOOL,
} from "../data/sampleTools";
import { loadTools, saveTools } from "../services/storageService";
import type { ToolItem } from "../types/tool";

interface ToolState {
  tools: ToolItem[];
  loaded: boolean;
  hydrate: (tools: ToolItem[]) => void;
  seedIfEmpty: () => Promise<void>;
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

const WORK_TOOL_ORDER = [PRIVACY_MASK_TOOL, DOC_SHRINK_TOOL, URL_MARK_TOOL, PDF_PAGES_TOOL];

function relabelBuiltin(tool: ToolItem): ToolItem {
  const known = WORK_TOOL_ORDER.find((item) => tool.id === item.id || tool.target === item.target);
  if (!known) {
    return tool;
  }
  return {
    ...tool,
    name: known.name,
    description: known.description,
    keywords: known.keywords,
  };
}

function placeWorkTools(tools: ToolItem[]): { tools: ToolItem[]; changed: boolean } {
  const next = tools.slice();
  let cursor = 0;
  let changed = false;
  for (const builtin of WORK_TOOL_ORDER) {
    const index = next.findIndex((tool) => tool.id === builtin.id || tool.target === builtin.target);
    if (index === -1) {
      next.splice(cursor, 0, { ...builtin, origin: "local" });
      changed = true;
      cursor += 1;
    } else {
      cursor = index + 1;
    }
  }
  return { tools: next, changed };
}

function withOrigin(tools: ToolItem[]): ToolItem[] {
  const packIds = new Set(EDUCATION_PACK.tools.map((tool) => tool.id));
  return tools.map((tool) => {
    const labeled = relabelBuiltin(tool);
    if (labeled.origin) {
      return labeled;
    }
    if (packIds.has(labeled.id)) {
      return { ...labeled, origin: "pack", packName: EDUCATION_PACK.name };
    }
    return { ...labeled, origin: "local" };
  });
}

export const useToolStore = create<ToolState>((set, get) => ({
  tools: [],
  loaded: false,
  hydrate: (tools) => set({ tools: withOrigin(tools), loaded: true }),
  seedIfEmpty: async () => {
    if (get().tools.length === 0) {
      const tools = COMMON_WORK_TOOLS.map((tool) => ({ ...tool, origin: "local" as const }));
      set({ tools });
      await persist(tools);
      return;
    }
    const labeled = withOrigin(get().tools);
    const changed = labeled.some((tool, index) => {
      const prev = get().tools[index];
      return (
        !prev ||
        prev.name !== tool.name ||
        prev.description !== tool.description ||
        JSON.stringify(prev.keywords) !== JSON.stringify(tool.keywords)
      );
    });
    if (changed) {
      set({ tools: labeled });
      await persist(labeled);
    }
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
  let tools = withOrigin(loaded);
  let changed = loaded.some((tool) => !tool.origin);
  if (tools.length > 0) {
    const placed = placeWorkTools(tools);
    tools = placed.tools;
    changed = changed || placed.changed;
  }
  useToolStore.getState().hydrate(tools);
  if (changed) {
    await persist(tools);
  }
}
