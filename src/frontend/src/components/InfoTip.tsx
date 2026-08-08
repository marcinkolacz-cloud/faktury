import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function InfoTip({ text }: { text: string }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; below: boolean } | null>(null);

  const computePos = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const tipHeight = 90; // rough estimate for flip decision
    const openBelow = r.top < tipHeight + 16;
    setPos({
      top: openBelow ? r.bottom : r.top,
      left: Math.min(Math.max(r.left + r.width / 2, 136), window.innerWidth - 136),
      below: openBelow,
    });
  };

  const open = () => { computePos(); setShow(true); };
  const close = () => setShow(false);

  useEffect(() => {
    if (!show) return;
    const onScroll = () => computePos();
    const onDocClick = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) close();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("click", onDocClick);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("click", onDocClick);
    };
  }, [show]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={open}
        onMouseLeave={close}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); show ? close() : open(); }}
        className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-cyan-600 text-white text-[12px] font-bold leading-none ml-1.5 shadow-sm hover:bg-cyan-500 ring-2 ring-cyan-600/20 align-middle"
        aria-label="Pomoc"
      >
        ?
      </button>
      {show && pos && createPortal(
        <div
          style={{
            position: "fixed",
            top: pos.below ? pos.top + 8 : pos.top - 8,
            left: pos.left,
            transform: pos.below ? "translate(-50%, 0)" : "translate(-50%, -100%)",
          }}
          className="z-[9999] w-64 p-2.5 rounded-md bg-[var(--bg-card)] border-2 border-cyan-600 text-[12px] leading-relaxed text-[var(--text-primary)] shadow-xl"
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={() => setShow(true)}
          onMouseLeave={close}
        >
          {text}
        </div>,
        document.body
      )}
    </>
  );
}
