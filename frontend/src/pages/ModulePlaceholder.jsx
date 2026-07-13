import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Package, Truck, Receipt, Handshake, SealCheck, ArrowLeft, PlugsConnected } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";

const ICONS = { Package, Truck, Receipt, Handshake, SealCheck };

export default function ModulePlaceholder() {
  const { moduleKey } = useParams();
  const [mod, setMod] = useState(null);
  const [pinging, setPinging] = useState(false);

  useEffect(() => {
    setMod(null);
    api.get(`/modules/${moduleKey}`).then((r) => setMod(r.data)).catch(() => {});
  }, [moduleKey]);

  const handlePing = async () => {
    setPinging(true);
    try {
      const { data } = await api.post(`/modules/${moduleKey}/ping`);
      toast.success(data.message);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setPinging(false);
    }
  };

  if (!mod)
    return (
      <div className="flex items-center justify-center py-32" data-testid="module-loading">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );

  const Icon = ICONS[mod.icon] || Package;

  return (
    <div className="max-w-3xl" data-testid={`module-page-${moduleKey}`}>
      <Link to="/portal" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8 w-fit" data-testid="module-back-link">
        <ArrowLeft size={16} /> Back to dashboard
      </Link>

      <div className="border border-border bg-card rounded-sm p-8 sm:p-12 rise-in">
        <div className="flex items-start justify-between mb-8">
          <div className="w-16 h-16 bg-primary/15 flex items-center justify-center rounded-sm">
            <Icon size={36} weight="duotone" className="text-primary" />
          </div>
          <Badge variant="secondary" className="rounded-sm text-[10px] uppercase tracking-widest" data-testid="module-status-badge">
            Coming Soon
          </Badge>
        </div>

        <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-4" data-testid="module-title">{mod.name}</h1>
        <p className="text-muted-foreground leading-relaxed mb-10 max-w-xl" data-testid="module-description">{mod.description}</p>

        <div className="border border-dashed border-border rounded-sm p-6 mb-10 bg-background/50">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">Module Architecture</p>
          <ul className="text-sm text-muted-foreground space-y-2 font-mono">
            <li>→ API namespace reserved: <span className="text-primary">/api/modules/{moduleKey}</span></li>
            <li>→ Independent routes, database collections & configuration</li>
            <li>→ Plugs into this platform without redesign</li>
          </ul>
        </div>

        <Button
          onClick={handlePing}
          disabled={pinging}
          data-testid="integration-ready-button"
          className="rounded-sm font-bold gap-2 h-12 px-8 active:scale-95 transition-transform"
        >
          <PlugsConnected size={20} weight="bold" />
          {pinging ? "Checking..." : "Integration Ready"}
        </Button>

        <div className="hazard-stripe h-1.5 w-full mt-12 rounded-sm opacity-60" aria-hidden="true" />
      </div>
    </div>
  );
}
