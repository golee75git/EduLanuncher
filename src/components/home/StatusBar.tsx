import { APP_CONFIG } from "../../config/app";

export function StatusBar() {
  return (
    <p className="mx-auto w-full max-w-[600px] shrink-0 bg-paper px-7 pb-2 text-right text-[10px] text-quiet">
      {APP_CONFIG.displayName} · 준비됨
    </p>
  );
}
