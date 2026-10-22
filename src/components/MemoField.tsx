import { useEffect, useLayoutEffect, useRef, useState } from "react";

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

function caretIn(at: number, length: number): number {
  if (!Number.isFinite(at) || at < 0) {
    return 0;
  }
  if (at > length) {
    return length;
  }
  return at;
}

export function MemoField({ value, onEdit, onCommit, className, rows }: MemoFieldProps) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(value);
  const composing = useRef(false);
  const timer = useRef(0);
  const caretAt = useRef<number | null>(null);
  const sent = useRef(value);
  const typedAt = useRef(0);

  useLayoutEffect(() => {
    const node = fieldRef.current;
    const saved = caretAt.current;
    if (!node || saved === null) {
      return;
    }
    caretAt.current = null;
    if (document.activeElement !== node) {
      return;
    }
    const at = caretIn(saved, node.value.length);
    if (node.selectionStart !== at || node.selectionEnd !== at) {
      node.setSelectionRange(at, at);
    }
  });

  useEffect(() => {
    return () => window.clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (composing.current) {
      return;
    }
    const node = fieldRef.current;
    const focused = node !== null && document.activeElement === node;
    if (focused && node && Date.now() - typedAt.current < 700) {
      const live = clipField(node.value);
      if (live !== value) {
        caretAt.current = node.selectionStart;
        if (live !== draft) {
          sent.current = live;
          setDraft(live);
        }
        return;
      }
    }
    if (focused && node && value !== sent.current) {
      caretAt.current = node.selectionStart;
    }
    sent.current = value;
    setDraft(value);
  }, [value]);

  const commit = (next: string) => {
    window.clearTimeout(timer.current);
    onCommit(clipField(next));
  };

  const publish = (node: HTMLTextAreaElement, next: string) => {
    typedAt.current = Date.now();
    caretAt.current = node.selectionStart;
    sent.current = next;
    setDraft(next);
    onEdit(next);
  };

  return (
    <textarea
      ref={fieldRef}
      value={draft}
      rows={rows}
      maxLength={2000}
      placeholder="이 PC에만 저장됩니다"
      onCompositionStart={() => {
        composing.current = true;
        window.clearTimeout(timer.current);
      }}
      onCompositionEnd={(event) => {
        const node = event.currentTarget;
        const next = clipField(node.value);
        composing.current = false;
        typedAt.current = Date.now();
        if (next === draft) {
          sent.current = next;
          onEdit(next);
          commit(next);
          return;
        }
        publish(node, next);
        commit(next);
      }}
      onChange={(event) => {
        const node = event.target;
        const next = clipField(node.value);
        publish(node, next);
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
