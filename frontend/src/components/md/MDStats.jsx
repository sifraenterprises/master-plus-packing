import { useEffect, useState } from "react";
import api from "@/lib/api";

const TILES = [
  { key: "total", label: "Total Dispatches" },
  { key: "today", label: "Today's Dispatches" },
  { key: "pending", label: "Pending" },
  { key: "ready_for_asn", label: "Ready for ASN" },
  { key: "ready_for_eway", label: "Ready for E-Way" },
  { key: "completed", label: "Completed" },
  { key: "ocr_errors", label: "OCR Errors", danger: true },
];

export default function MDStats({ refreshKey = 0 }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.get("/master-dispatch/stats").then((r) => setStats(r.data)).catch(() => {});
  }, [refreshKey]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 border border-border rounded-sm overflow-hidden" data-testid="md-stats">
      {TILES.map((t, i) => (
        <div
          key={t.key}
          className={`bg-card p-4 border-border ${i < TILES.length - 1 ? "sm:border-r" : ""} border-b sm:border-b-0 ${i % 2 === 0 ? "border-r" : ""}`}
          data-testid={`md-stat-${t.key}`}
        >
          <p className="text-[9px] uppercase tracking-[0.15em] text-muted-foreground mb-1.5">{t.label}</p>
          <p className={`text-xl font-black font-mono ${t.danger && stats?.[t.key] > 0 ? "text-red-400" : "text-foreground"}`}>
            {stats ? stats[t.key] : "—"}
          </p>
        </div>
      ))}
    </div>
  );
}
