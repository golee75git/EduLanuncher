interface HomeJumpButtonProps {
  onClick: () => void;
  label?: string;
}

export function HomeJumpButton({ onClick, label = "처음 화면" }: HomeJumpButtonProps) {
  return (
    <button
      type="button"
      className="rounded-full border border-line bg-card px-2.5 py-1 text-[11px] font-medium text-ink shadow-card hover:bg-ink-soft"
      onClick={onClick}
    >
      {label}
    </button>
  );
}
