import { open } from "@tauri-apps/plugin-dialog";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { TOOL_CATEGORIES } from "../data/categories";
import { TOOL_ICON_OPTIONS } from "../data/toolIcons";
import { useToolStore } from "../stores/toolStore";
import type { ToolItem, ToolType } from "../types/tool";

interface ToolEditPageProps {
  tool?: ToolItem;
  createType?: ToolType;
  onBack: () => void;
}

function iconForType(type: ToolType): string {
  if (type === "url") {
    return "globe";
  }
  if (type === "file") {
    return "file";
  }
  if (type === "folder") {
    return "folder";
  }
  if (type === "app") {
    return "monitor";
  }
  return "wrench";
}

const TYPES: Array<{ id: ToolType; label: string }> = [
  { id: "url", label: "URL" },
  { id: "file", label: "파일" },
  { id: "folder", label: "폴더" },
  { id: "app", label: "프로그램" },
  { id: "internal", label: "내부 기능" },
];

export function ToolEditPage({ tool, createType, onBack }: ToolEditPageProps) {
  const addTool = useToolStore((state) => state.addTool);
  const updateTool = useToolStore((state) => state.updateTool);
  const initialType = tool?.type ?? createType ?? "url";
  const [name, setName] = useState(tool?.name ?? "");
  const [type, setType] = useState<ToolType>(initialType);
  const [target, setTarget] = useState(tool?.target ?? "");
  const [category, setCategory] = useState(tool?.category ?? "기타");
  const [keywords, setKeywords] = useState((tool?.keywords ?? []).join(", "));
  const [favorite, setFavorite] = useState(tool?.favorite ?? true);
  const [icon, setIcon] = useState(tool?.icon ?? iconForType(initialType));
  const [description, setDescription] = useState(tool?.description ?? "");
  const [error, setError] = useState("");

  const pickPath = async () => {
    const selected = await open({
      directory: type === "folder",
      multiple: false,
      filters:
        type === "app"
          ? [{ name: "프로그램", extensions: ["exe"] }]
          : undefined,
    });
    if (typeof selected === "string") {
      setTarget(selected);
    }
  };

  const save = async () => {
    if (!name.trim()) {
      setError("도구명을 입력하세요.");
      return;
    }
    const next: ToolItem = {
      id: tool?.id ?? crypto.randomUUID(),
      name: name.trim(),
      description: description.trim() || undefined,
      type,
      target: target.trim(),
      icon,
      iconImage: icon === (tool?.icon ?? iconForType(initialType)) ? tool?.iconImage : undefined,
      category,
      favorite,
      keywords: keywords
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      lastUsedAt: tool?.lastUsedAt,
      usageCount: tool?.usageCount ?? 0,
      enabled: true,
      origin: tool?.origin ?? "local",
      packName: tool?.origin === "pack" ? tool.packName : undefined,
    };
    if (tool) {
      await updateTool(tool.id, next);
    } else {
      await addTool(next);
    }
    onBack();
  };

  return (
    <div className="flex h-full flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-[15px] font-semibold text-desk">{tool ? "도구 편집" : "도구 추가"}</h1>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <Field label="도구명">
          <input value={name} onChange={(event) => setName(event.target.value)} className="field-input" />
        </Field>
        <Field label="도구 유형">
          <select
            value={type}
            onChange={(event) => setType(event.target.value as ToolType)}
            className="field-input"
          >
            {TYPES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={type === "url" ? "URL" : type === "internal" ? "내부 기능 ID" : "경로"}>
          <div className="flex gap-2">
            <input
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="field-input"
              placeholder={
                type === "url"
                  ? "https://"
                  : type === "internal"
                    ? "network"
                    : "파일 또는 폴더 선택"
              }
            />
            {type === "file" || type === "folder" || type === "app" ? (
              <button
                type="button"
                className="shrink-0 rounded-lg bg-desk px-3 text-sm text-white transition-colors duration-150 hover:bg-desk/90"
                onClick={() => void pickPath()}
              >
                찾아보기
              </button>
            ) : null}
          </div>
        </Field>
        <Field label="카테고리">
          <select value={category} onChange={(event) => setCategory(event.target.value)} className="field-input">
            {TOOL_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Field>
        <Field label="키워드">
          <input
            value={keywords}
            onChange={(event) => setKeywords(event.target.value)}
            className="field-input"
            placeholder="쉼표로 구분"
          />
        </Field>
        <Field label="설명">
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="field-input"
          />
        </Field>
        <Field label="아이콘">
          <select value={icon} onChange={(event) => setIcon(event.target.value)} className="field-input">
            {TOOL_ICON_OPTIONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-desk">
          <input
            type="checkbox"
            checked={favorite}
            onChange={(event) => setFavorite(event.target.checked)}
            className="h-4 w-4 rounded border-line"
          />
          즐겨찾기
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button type="button" onClick={() => void save()} className="btn-primary h-11 font-medium">
          저장
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm text-desk">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}
