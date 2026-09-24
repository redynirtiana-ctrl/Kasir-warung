import { FileSpreadsheet, FileText } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

type Entity = "products" | "sales" | "purchases" | "customers" | "suppliers";

/** Excel + CSV download links for /api/v1/export/{entity}.{fmt} (cookie auth rides the same-origin request). */
export default function ExportButtons({ entity, start, end }: { entity: Entity; start?: string; end?: string }) {
  const qs = new URLSearchParams();
  if (start) qs.set("start", start);
  if (end) qs.set("end", end);
  const q = qs.toString() ? `?${qs}` : "";
  return (
    <div className="flex gap-1">
      <a className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/v1/export/${entity}.xlsx${q}`} data-testid={`export-${entity}-xlsx`}><FileSpreadsheet /> Excel</a>
      <a className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/v1/export/${entity}.csv${q}`} data-testid={`export-${entity}-csv`}><FileText /> CSV</a>
    </div>
  );
}
