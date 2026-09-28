import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import {
  addDocFolder,
  clearDocIndex,
  docSearchStatus,
  haltDocIndex,
  listDocFolders,
  removeDocFolder,
  startDocIndex,
  type DocFolder,
  type DocStatus,
} from "../services/documentSearchService";

export function DocumentSearchSettings() {
  const [folders, setFolders] = useState<DocFolder[]>([]);
  const [status, setStatus] = useState<DocStatus | null>(null);
  const [message, setMessage] = useState("");

  async function refresh() {
    const [nextFolders, nextStatus] = await Promise.all([listDocFolders(), docSearchStatus()]);
    setFolders(nextFolders);
    setStatus(nextStatus);
  }

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : "문서 검색을 열지 못했습니다.");
    });
  }, []);

  useEffect(() => {
    if (!status?.running) {
      return;
    }
    const timer = window.setInterval(() => {
      void docSearchStatus()
        .then((next) => {
          setStatus(next);
          if (!next.running) {
            setMessage(next.message);
          }
        })
        .catch(() => undefined);
    }, 500);
    return () => window.clearInterval(timer);
  }, [status?.running]);

  return (
    <section className="card-surface space-y-3 p-3.5">
      <h2 className="text-sm font-semibold text-desk">내 문서 검색</h2>
      <p className="text-xs leading-5 text-quiet">
        고른 폴더의 HWPX, XLSX, DOCX, PDF, TXT, MD, CSV 내용만 이 PC에 색인합니다. 문서 내용은 올리지 않습니다. HWP와 스캔 PDF는 아직 읽지 않습니다.
      </p>
      {folders.length === 0 ? (
        <p className="text-sm text-quiet">색인할 폴더가 없습니다.</p>
      ) : (
        <ul className="space-y-1">
          {folders.map((folder) => (
            <li key={folder.path} className="desk-row gap-2">
              <span className="min-w-0 flex-1 truncate text-sm" title={folder.path}>
                {folder.path}
              </span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  void removeDocFolder(folder.path)
                    .then(() => refresh())
                    .then(() => setMessage("폴더를 뺐습니다. 그 폴더의 색인만 지웠습니다."))
                    .catch((error: unknown) => {
                      setMessage(error instanceof Error ? error.message : "폴더를 빼지 못했습니다.");
                    });
                }}
              >
                빼기
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            void (async () => {
              try {
                const selected = await open({ directory: true, multiple: false });
                if (typeof selected !== "string") {
                  return;
                }
                await addDocFolder(selected);
                await refresh();
                setMessage("폴더를 넣었습니다. 지금 색인을 누르면 내용을 읽습니다.");
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "폴더를 넣지 못했습니다.");
              }
            })();
          }}
        >
          폴더 추가
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={status?.running}
          onClick={() => {
            void startDocIndex()
              .then(() => refresh())
              .catch((error: unknown) => {
                setMessage(error instanceof Error ? error.message : "색인을 시작하지 못했습니다.");
              });
          }}
        >
          지금 색인
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={!status?.running}
          onClick={() => {
            void haltDocIndex();
          }}
        >
          중지
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            void clearDocIndex()
              .then(() => refresh())
              .then(() => setMessage("색인을 지웠습니다. 원래 문서는 그대로입니다."))
              .catch((error: unknown) => {
                setMessage(error instanceof Error ? error.message : "색인을 지우지 못했습니다.");
              });
          }}
        >
          색인 지우기
        </button>
      </div>
      {status?.running ? (
        <p className="text-xs leading-5 text-quiet">
          {status.message}
          {status.current ? ` 현재: ${status.current}` : ""}
          {` 넣음 ${status.indexed} · 건너뜀 ${status.skipped} · 실패 ${status.failed}`}
        </p>
      ) : status?.message ? (
        <p className="text-xs leading-5 text-quiet">
          {status.message}
          {` 넣음 ${status.indexed} · 건너뜀 ${status.skipped} · 실패 ${status.failed}`}
        </p>
      ) : null}
      {message ? <p className="text-xs leading-5 text-desk">{message}</p> : null}
    </section>
  );
}
