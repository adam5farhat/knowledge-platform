"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import s from "./ConfirmDialog.module.css";

type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be inside <ConfirmProvider>");
  return ctx;
}

type DialogState = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setDialog({ ...opts, resolve });
    });
  }, []);

  const close = useCallback(
    (result: boolean) => {
      dialog?.resolve(result);
      setDialog(null);
    },
    [dialog],
  );

  useEffect(() => {
    if (!dialog) return;
    const btn = dialog.danger ? cancelRef.current : confirmRef.current;
    btn?.focus();
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dialog, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <div className={s.overlay} onClick={() => close(false)} role="presentation">
          <div
            className={s.dialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="kp-confirm-title"
            aria-describedby="kp-confirm-msg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="kp-confirm-title" className={s.title}>
              {dialog.title ?? "Confirm"}
            </h2>
            <p id="kp-confirm-msg" className={s.message}>
              {dialog.message}
            </p>
            <div className={s.actions}>
              <button
                ref={cancelRef}
                className={s.cancel}
                onClick={() => close(false)}
              >
                {dialog.cancelLabel ?? "Cancel"}
              </button>
              <button
                ref={confirmRef}
                className={`${s.confirm} ${dialog.danger ? s.danger : ""}`}
                onClick={() => close(true)}
              >
                {dialog.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
