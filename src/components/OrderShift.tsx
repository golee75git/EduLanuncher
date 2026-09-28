interface OrderShiftProps {
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
}

export function OrderShift({ first, last, onUp, onDown }: OrderShiftProps) {
  return (
    <>
      <button
        type="button"
        className="shrink-0 rounded-full px-2 py-1 text-[11px] font-medium text-ink hover:bg-ink-soft disabled:opacity-40"
        disabled={first}
        aria-label="위로"
        onClick={onUp}
      >
        위
      </button>
      <button
        type="button"
        className="shrink-0 rounded-full px-2 py-1 text-[11px] font-medium text-ink hover:bg-ink-soft disabled:opacity-40"
        disabled={last}
        aria-label="아래로"
        onClick={onDown}
      >
        아래
      </button>
    </>
  );
}
