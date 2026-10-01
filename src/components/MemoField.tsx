import { useEffect, useRef, useState } from "react";

interface MemoFieldProps {
  value: string;
  onEdit: (value: string) => void;
  onCommit: (value: string) => void;
  className: string;
  rows?: number;
}

function clipField(value: string): string {
  return value.slice(0, 2000);
}

export function MemoField({ value, onEdit, onCommit, className, rows }: MemoFieldProps) {
  const [draft, setDraft] = useState(value);
  const composing = useRef(false);
  const timer = useRef(0);

  useEffect(() => {
    return () => window.clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (composing.current) {
      return;
    }
    setDraft(value);
  }, [value]);

  const commit = (next: string) => {
    window.clearTimeout(timer.current);
    onCommit(clipField(next));
  };

  return (
    <textarea
      value={draft}
      rows={rows}
      maxLength={2000}
      placeholder="이 PC에만 저장됩니다"
      onCompositionStart={() => {
        composing.current = true;
        window.clearTimeout(timer.current);
      }}
      onCompositionEnd={(event) => {
        const next = clipField(event.currentTarget.value);
        composing.current = false;
        setDraft(next);
        onEdit(next);
        commit(next);
      }}
      onChange={(event) => {
        const next = clipField(event.target.value);
        setDraft(next);
        onEdit(next);
        if (composing.current) {
          return;
        }
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => onCommit(next), 400);
      }}
      onBlur={(event) => {
        if (composing.current) {
          return;
        }
        commit(event.currentTarget.value);
      }}
      className={className}
    />
  );
}
