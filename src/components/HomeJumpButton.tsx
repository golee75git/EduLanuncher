interface HomeJumpButtonProps {
  onClick: () => void;
  label?: string;
  solid?: boolean;
}

export function HomeJumpButton({ onClick, label = "처음 화면", solid = false }: HomeJumpButtonProps) {
  return (
    <button
      type="button"
      className={
        solid
          ? "rounded-full bg-ink px-2.5 py-1 text-[11px] font-bold text-white shadow-card hover:bg-ink-strong"
          : "rounded-full border border-line bg-card px-2.5 py-1 text-[11px] font-medium text-ink shadow-card hover:bg-ink-soft"
      }
      onClick={onClick}
    >
      {label}
    </button>
  );
}
