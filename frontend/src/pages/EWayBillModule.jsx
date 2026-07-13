import { useState } from "react";
import { Receipt } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/context/AuthContext";
import EwayEntryTab from "@/components/eway/EwayEntryTab";
import SelectorConfigTab from "@/components/eway/SelectorConfigTab";

export default function EWayBillModule() {
  const { user } = useAuth();
  const [tab, setTab] = useState("entry");

  return (
    <div className="max-w-7xl space-y-6" data-testid="eway-module-page">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-primary mb-2">Automation Module</p>
          <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
            <Receipt size={32} weight="duotone" className="text-primary" /> E-Way Bill Automation
          </h1>
        </div>
        <Badge className="rounded-sm text-[10px] uppercase tracking-widest" data-testid="eway-status-badge">Active</Badge>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-sm bg-secondary">
          <TabsTrigger value="entry" className="rounded-sm" data-testid="tab-eway-entry">E-Way Entry</TabsTrigger>
          {user?.role === "admin" && (
            <TabsTrigger value="config" className="rounded-sm" data-testid="tab-eway-config">Selector Config & Validation</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="entry" className="mt-6">
          <EwayEntryTab />
        </TabsContent>
        {user?.role === "admin" && (
          <TabsContent value="config" className="mt-6">
            <SelectorConfigTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
