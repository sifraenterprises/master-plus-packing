import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise, Desktop, Pause, Play } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";

const EXPECTED_WORKERS = ["Pritpal", "Pawan", "Gurpreet"];

export default function DesktopWorkersPanel() {
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/worker/status");
      setWorkers(data.workers || []);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);

  const toggle = async (worker) => {
    try {
      await api.put(`/worker/workers/${encodeURIComponent(worker.worker_name)}/active`, {
        active: worker.active === false,
      });
      toast.success(`${worker.worker_name} ${worker.active === false ? "enabled" : "disabled"}`);
      load();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const rows = EXPECTED_WORKERS.map((name) =>
    workers.find((worker) => worker.worker_name?.toLowerCase() === name.toLowerCase()) || {
      worker_name: name,
      online: false,
      active: true,
      state: "not installed",
      capabilities: [],
    }
  );

  return (
    <div className="border border-border bg-card rounded-sm p-6 space-y-5" data-testid="desktop-workers-panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
            <Desktop size={16} className="text-primary" /> Office Desktop Workers
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            One job is claimed atomically by one desktop. Normally keep only the desktop handling the current process open.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="rounded-sm gap-2">
          <ArrowClockwise size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </Button>
      </div>

      <div className="grid gap-3">
        {rows.map((worker) => (
          <div key={worker.worker_name} className="border border-border rounded-sm p-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <span className={`w-2.5 h-2.5 rounded-full ${worker.online ? "bg-emerald-500" : "bg-zinc-500"}`} />
              <div>
                <p className="font-semibold">{worker.worker_name}</p>
                <p className="text-xs text-muted-foreground">
                  {worker.online ? worker.state || "idle" : "offline"}
                  {worker.hostname ? ` · ${worker.hostname}` : ""}
                  {worker.current_job_id ? ` · Job ${worker.current_job_id}` : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={worker.online ? "default" : "secondary"} className="rounded-sm">
                {worker.online ? "Online" : "Offline"}
              </Badge>
              {worker.id && (
                <Button variant="outline" size="sm" onClick={() => toggle(worker)} className="rounded-sm gap-1.5">
                  {worker.active === false ? <Play size={13} /> : <Pause size={13} />}
                  {worker.active === false ? "Enable" : "Disable"}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
