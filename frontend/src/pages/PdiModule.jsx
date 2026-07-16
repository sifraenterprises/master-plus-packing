import { useState } from "react";
import { SealCheck } from "@phosphor-icons/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import GeneratePanel from "@/components/pdi/GeneratePanel";
import ReportsHistory from "@/components/pdi/ReportsHistory";
import TemplateLibrary from "@/components/pdi/TemplateLibrary";

export default function PdiModule() {
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    return ["generate", "reports", "library"].includes(t) ? t : "generate";
  });
  return (
    <div className="space-y-6" data-testid="pdi-module">
      <div>
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2.5">
          <SealCheck size={26} weight="duotone" className="text-primary" /> AI PDI Generator
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Auto-generated Final / Pre-Dispatch Inspection reports — handwritten look, observations always within tolerance.
        </p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-sm">
          <TabsTrigger value="generate" className="rounded-sm" data-testid="pdi-tab-generate">Generate</TabsTrigger>
          <TabsTrigger value="reports" className="rounded-sm" data-testid="pdi-tab-reports">Reports</TabsTrigger>
          <TabsTrigger value="library" className="rounded-sm" data-testid="pdi-tab-library">Template Library</TabsTrigger>
        </TabsList>
        <TabsContent value="generate" className="mt-5"><GeneratePanel onGenerated={() => {}} /></TabsContent>
        <TabsContent value="reports" className="mt-5"><ReportsHistory /></TabsContent>
        <TabsContent value="library" className="mt-5"><TemplateLibrary /></TabsContent>
      </Tabs>
    </div>
  );
}
