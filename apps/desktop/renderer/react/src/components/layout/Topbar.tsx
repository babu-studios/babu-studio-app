import type { ReactNode } from "react";
import { ResourceMonitor } from "@/components/system/ResourceMonitor";
import { Brand } from "./Brand";

export function Topbar({ children }: { children: ReactNode }) {
  return (
    <header className="topbar">
      <Brand />
      <div className="topbar-actions">
        <ResourceMonitor />
        {children}
      </div>
    </header>
  );
}
