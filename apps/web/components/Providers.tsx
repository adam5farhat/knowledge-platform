"use client";

import type { ReactNode } from "react";
import { ToastProvider } from "./Toast";
import { ConfirmProvider } from "./ConfirmDialog";
import { NotificationProvider } from "./NotificationContext";
import { NotificationPanel } from "./NotificationPanel";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <NotificationProvider>
          {children}
          <NotificationPanel />
        </NotificationProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
