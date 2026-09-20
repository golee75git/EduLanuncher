interface HomeJumpButtonProps {
  onClick: () => void;
}

export function HomeJumpButton({ onClick }: HomeJumpButtonProps) {
  return (
    <button
      type="button"
      className="rounded-full border border-line bg-card px-2.5 py-1 text-[11px] font-medium text-ink shadow-card hover:bg-ink-soft"
      onClick={onClick}
    >
      처음 화면
    </button>
  );
}
