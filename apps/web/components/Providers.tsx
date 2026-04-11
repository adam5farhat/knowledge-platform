"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { ToastProvider } from "./Toast";
import { ConfirmProvider } from "./ConfirmDialog";
import { NotificationProvider } from "./NotificationContext";
import { NotificationPanel } from "./NotificationPanel";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="kp-theme" disableTransitionOnChange>
      <ToastProvider>
        <ConfirmProvider>
          <NotificationProvider>
            {children}
            <NotificationPanel />
          </NotificationProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
