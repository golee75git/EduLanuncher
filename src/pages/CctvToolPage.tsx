import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { calculateIpv4Range } from "../services/ipv4Math";
import {
  loadThisPcIpv4,
  scanCctvRange,
  type HostHit,
  type LocalAddress,
} from "../services/networkService";

interface CctvToolPageProps {
  title: string;
  onBack: () => void;
}

export function CctvToolPage({ title, onBack }: CctvToolPageProps) {
  const [localAddresses, setLocalAddresses] = useState<LocalAddress[]>([]);
  const [hits, setHits] = useState<HostHit[]>([]);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [didScan, setDidScan] = useState(false);

  const runScan = async (adapters: LocalAddress[]) => {
    const source = adapters[0];
    if (!source) {
      setError("이 PC 주소를 읽지 못했습니다.");
      return;
    }
    const range = calculateIpv4Range(source.ip, source.mask || "24");
    if (!range?.firstHost || !range.lastHost) {
      setError("검색할 호스트 구간이 없습니다.");
      return;
    }
    if (range.prefix < 24) {
      setError("한 번에 /24 이하 구간만 검색합니다.");
      return;
    }
    setScanning(true);
    setError("");
    setHits([]);
    setDidScan(false);
    try {
      setHits(await scanCctvRange(range.firstHost, range.lastHost));
      setDidScan(true);
    } catch (scanError) {
      setError(nativeMessage(scanError, "CCTV 검색에 실패했습니다."));
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const found = await loadThisPcIpv4();
        if (cancelled) {
          return;
        }
        setLocalAddresses(found);
        await runScan(found);
      } catch (loadError) {
        if (!cancelled) {
          setError(nativeMessage(loadError, "이 PC 주소를 읽지 못했습니다. 런처 앱에서 확인하세요."));
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-[15px] font-semibold text-desk">{title}</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-xs leading-5 text-quiet">
          이 PC가 붙은 구간에서 이름 단서 또는 RTSP(554)로 CCTV를 추정합니다. 카메라에 로그인하거나 영상을 열지
          않습니다.
        </p>
        {localAddresses[0] ? (
          <p className="text-sm text-desk">
            검색 구간 {localAddresses[0].ip} / {localAddresses[0].mask || "24"}
          </p>
        ) : null}
        <button
          type="button"
          className="btn-primary h-11"
          onClick={() => void runScan(localAddresses)}
          disabled={scanning || localAddresses.length === 0}
        >
          {scanning ? "검색 중..." : "다시 검색"}
        </button>
        {error ? <p className="text-sm text-desk">{error}</p> : null}
        {!scanning && didScan && hits.length === 0 && !error ? (
          <p className="text-sm text-quiet">
            CCTV로 보이는 주소가 없습니다. ping이나 554가 막혀 있으면 목록이 비어 있을 수 있습니다.
          </p>
        ) : null}
        {hits.length > 0 ? (
          <ul className="card-surface space-y-1 p-2">
            {hits.map((hit) => (
              <li key={hit.ip} className="rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-paper">
                <p className="text-sm font-medium text-desk">{hit.name?.trim() || hit.ip}</p>
                <p className="text-xs text-quiet">
                  {[hit.name ? hit.ip : null, hit.mac, hit.rtsp ? "RTSP 554" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function nativeMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return fallback;
}
