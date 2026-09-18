import { save } from "@tauri-apps/plugin-dialog";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { RangeCheckBar } from "../components/RangeCheckBar";
import { calculateIpv4Range } from "../services/ipv4Math";
import {
  haltRangeCheck,
  hostsToCsv,
  loadThisPcIpv4,
  lookupPublicIpv4,
  scanIpv4Range,
  writeCsvFile,
  type HostHit,
  type LocalAddress,
} from "../services/networkService";

interface NetworkToolPageProps {
  title: string;
  onBack: () => void;
}

export function NetworkToolPage({ title, onBack }: NetworkToolPageProps) {
  const [address, setAddress] = useState("192.168.0.10");
  const [prefix, setPrefix] = useState("24");
  const [localAddresses, setLocalAddresses] = useState<LocalAddress[]>([]);
  const [publicIp, setPublicIp] = useState("");
  const [publicError, setPublicError] = useState("");
  const [publicLoading, setPublicLoading] = useState(false);
  const [hits, setHits] = useState<HostHit[]>([]);
  const [scanError, setScanError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [didScan, setDidScan] = useState(false);
  const [stopped, setStopped] = useState(false);
  const haltRef = useRef(false);
  const [exportMessage, setExportMessage] = useState("");
  const result = useMemo(() => calculateIpv4Range(address, prefix), [address, prefix]);

  const applyLocal = (item: LocalAddress) => {
    setAddress(item.ip);
    if (item.mask) {
      setPrefix(item.mask);
    }
  };

  const refreshPublic = async () => {
    setPublicLoading(true);
    setPublicError("");
    try {
      setPublicIp(await lookupPublicIpv4());
    } catch (error) {
      setPublicIp("");
      setPublicError(nativeMessage(error, "공인 IP를 확인하지 못했습니다."));
    } finally {
      setPublicLoading(false);
    }
  };

  const runScan = async () => {
    if (!result?.firstHost || !result.lastHost) {
      setScanError("검색할 호스트 구간이 없습니다.");
      return;
    }
    if (result.prefix < 24) {
      setScanError("한 번에 /24 이하 구간만 검색합니다.");
      return;
    }
    setScanning(true);
    setScanError("");
    setHits([]);
    setDidScan(false);
    setStopped(false);
    haltRef.current = false;
    setExportMessage("");
    try {
      setHits(await scanIpv4Range(result.firstHost, result.lastHost));
      setDidScan(true);
      if (haltRef.current) {
        setStopped(true);
        setScanError("검색을 멈췄습니다.");
      }
    } catch (error) {
      setScanError(nativeMessage(error, "구간 검색에 실패했습니다."));
    } finally {
      setScanning(false);
    }
  };

  const exportExcel = async () => {
    if (!didScan || !result?.firstHost || !result.lastHost) {
      return;
    }
    try {
      const selected = await save({
        defaultPath: "구간검색.csv",
        filters: [{ name: "Excel CSV", extensions: ["csv"] }],
      });
      if (typeof selected !== "string") {
        return;
      }
      const path = selected.toLowerCase().endsWith(".csv") ? selected : `${selected}.csv`;
      await writeCsvFile(path, hostsToCsv(hits, result.firstHost, result.lastHost));
      setExportMessage("엑셀에서 열 수 있는 CSV로 저장했습니다. 미연결 주소도 포함됩니다.");
    } catch (error) {
      setExportMessage(nativeMessage(error, "저장하지 못했습니다."));
    }
  };

  const requestHalt = async () => {
    haltRef.current = true;
    setStopped(true);
    try {
      await haltRangeCheck();
    } catch {
      // Browser preview has no native commands.
    }
  };

  useEffect(() => {
    return () => {
      void haltRangeCheck().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const found = await loadThisPcIpv4();
        if (cancelled || found.length === 0) {
          return;
        }
        setLocalAddresses(found);
        applyLocal(found[0]);
      } catch {
        // Browser preview has no native commands.
      }
    };
    void load();
    void refreshPublic();
    return () => {
      cancelled = true;
    };
  }, []);

  const behindNat = Boolean(publicIp && localAddresses.some((item) => item.ip !== publicIp));

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <header className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="icon-btn" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-[15px] font-semibold text-desk">{title}</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <section className="card-surface p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-desk">이 PC · 공인 IP</h2>
            <button
              type="button"
              className="rounded-full border border-line px-2.5 py-1 text-xs text-desk transition-colors duration-150 hover:border-ink/30 hover:bg-ink-soft/50"
              onClick={() => void refreshPublic()}
              disabled={publicLoading}
            >
              {publicLoading ? "확인 중..." : "공인 IP 확인"}
            </button>
          </div>
          {localAddresses.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {localAddresses.map((item) => (
                <button
                  key={item.ip}
                  type="button"
                  onClick={() => applyLocal(item)}
                  className={`rounded-lg border px-2 py-1 text-left text-xs transition-colors duration-150 ${
                    item.ip === address
                      ? "border-ink/40 bg-ink-soft text-ink-strong"
                      : "border-line text-desk hover:border-ink/30 hover:bg-ink-soft/40"
                  }`}
                >
                  {item.name ? <span className="block font-medium">{item.name}</span> : null}
                  {item.ip}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-quiet">이 PC 주소는 런처 앱에서 읽어 옵니다.</p>
          )}
          <dl className="mt-2 space-y-1.5 text-sm">
            <Row
              label="컴퓨터 이름"
              value={localAddresses.find((item) => item.name)?.name || "-"}
            />
            <Row label="공인 IP" value={publicIp || publicError || (publicLoading ? "확인 중..." : "-")} />
          </dl>
          {behindNat ? (
            <p className="mt-2 text-xs leading-5 text-quiet">
              이 PC 주소와 공인 IP가 다릅니다. NAT 바깥에서 보이는 주소입니다.
            </p>
          ) : null}
        </section>

        <label className="block text-sm text-desk">
          <span className="mb-1 block">IP 주소</span>
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            className="field-input"
            placeholder="192.168.0.10"
          />
        </label>
        <label className="block text-sm text-desk">
          <span className="mb-1 block">접두 길이 또는 마스크</span>
          <input
            value={prefix}
            onChange={(event) => setPrefix(event.target.value)}
            className="field-input"
            placeholder="24 또는 255.255.255.0"
          />
        </label>
        {result ? (
          <dl className="card-surface space-y-2 p-3 text-sm">
            <Row label="네트워크" value={`${result.network}/${result.prefix}`} />
            <Row label="마스크" value={result.mask} />
            <Row label="브로드캐스트" value={result.broadcast} />
            <Row label="시작 호스트" value={result.firstHost ?? "-"} />
            <Row label="끝 호스트" value={result.lastHost ?? "-"} />
            <Row label="사용 가능 호스트" value={String(result.usableHosts)} />
          </dl>
        ) : (
          <p className="text-sm text-quiet">IP와 마스크를 확인하세요. 예: 10.0.0.5 와 24</p>
        )}

        <section className="space-y-2">
          <button
            type="button"
            className="btn-primary h-11"
            onClick={() => void runScan()}
            disabled={scanning || !result?.firstHost}
          >
            {scanning ? "구간 검색 중..." : "이 구간에서 응답 검색"}
          </button>
          {scanning ? (
            <button type="button" className="btn-secondary h-11" onClick={() => void requestHalt()}>
              중지
            </button>
          ) : null}
          <RangeCheckBar active={scanning} waitMs={400} plannedTotal={result?.usableHosts} />
          <p className="text-xs leading-5 text-quiet">
            이름은 DNS·컴퓨터 이름에서 가져옵니다. 종류는 이 PC, 기본 게이트웨이(공유기), 이름 규칙으로 추정하며 단정이 아닙니다.
          </p>
          {scanError ? <p className="text-sm text-desk">{scanError}</p> : null}
          {exportMessage ? <p className="text-sm text-desk">{exportMessage}</p> : null}
          {!scanning && !stopped && !scanError && didScan && hits.length === 0 ? (
            <p className="text-sm text-quiet">
              응답하는 주소가 없습니다. ICMP가 막혀 있으면 목록이 비어 있을 수 있습니다.
            </p>
          ) : null}
          {didScan ? (
            <button type="button" className="btn-secondary" onClick={() => void exportExcel()}>
              엑셀로 저장
            </button>
          ) : null}
          {hits.length > 0 ? (
            <ul className="card-surface space-y-1 p-2">
              {hits.map((hit) => (
                <li key={hit.ip} className="rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-paper">
                  <p className="text-sm font-medium text-desk">
                    {hit.kindLabel}
                    {hit.name?.trim() ? ` · ${hit.name.trim()}` : ""}
                  </p>
                  <p className="text-xs text-quiet">
                    {[hit.ip, hit.ms != null ? `${hit.ms}ms` : null, hit.mac]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-quiet">{label}</dt>
      <dd className="break-all text-right font-medium text-desk">{value}</dd>
    </div>
  );
}
