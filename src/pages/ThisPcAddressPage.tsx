import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { loadThisPcIpv4, lookupPublicIpv4 } from "../services/networkService";

interface ThisPcAddressPageProps {
  title?: string;
  onBack: () => void;
}

export function ThisPcAddressPage({ title = "이 PC 주소", onBack }: ThisPcAddressPageProps) {
  const [localIps, setLocalIps] = useState<string[]>([]);
  const [publicIp, setPublicIp] = useState("");
  const [localNote, setLocalNote] = useState("");
  const [publicNote, setPublicNote] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setLocalNote("");
    setPublicNote("");
    try {
      const found = await loadThisPcIpv4();
      const ips = uniqueIps(found.map((item) => item.ip));
      setLocalIps(ips);
      if (ips.length === 0) {
        setLocalNote("이 PC 주소가 없습니다.");
      }
    } catch {
      setLocalIps([]);
      setLocalNote("런처 앱에서만 이 PC 주소를 읽습니다.");
    }
    try {
      setPublicIp(await lookupPublicIpv4());
    } catch (error) {
      setPublicIp("");
      setPublicNote(asMessage(error, "공인 주소를 확인하지 못했습니다."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const localText = localIps.length > 0 ? localIps.join("\n") : localNote || "-";
  const publicText = publicIp || publicNote || (loading ? "확인 중..." : "-");

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="뒤로">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 text-[15px] font-semibold text-desk">{title}</h1>
        <button
          type="button"
          className="rounded-full border border-line px-2.5 py-1 text-xs text-desk transition-colors duration-150 hover:border-ink/30 hover:bg-ink-soft/50"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "확인 중..." : "다시 확인"}
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <section className="card-surface space-y-3 p-3">
          <div>
            <p className="text-xs text-quiet">이 PC 주소</p>
            <p className="mt-1 whitespace-pre-line break-all text-sm font-medium text-desk">{localText}</p>
          </div>
          <div>
            <p className="text-xs text-quiet">공인 주소</p>
            <p className="mt-1 break-all text-sm font-medium text-desk">{publicText}</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function uniqueIps(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const ip = value.trim();
    if (!ip || seen.has(ip)) {
      continue;
    }
    seen.add(ip);
    result.push(ip);
  }
  return result;
}

function asMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
