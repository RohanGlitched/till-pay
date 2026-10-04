"use client";

import type { ReactNode } from "react";
import { LiveProvider } from "@/lib/live";
import { WalletProvider } from "@/lib/wallet";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <LiveProvider>{children}</LiveProvider>
    </WalletProvider>
  );
}
