import { ApiError } from "@/lib/api";
import type { ApiErrorBody } from "@/lib/types";

const nf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

export const num = (n: number) => nf.format(n);
export const rupiah = (n: number) => `Rp ${nf.format(Math.round(n))}`;

export const PAYMENT_LABELS: Record<string, string> = {
  cash: "Cash",
  qris: "QRIS",
  transfer: "Transfer",
  debit: "Debit",
  kredit: "Kredit",
  ewallet: "E-Wallet",
};

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    const b = e.body as ApiErrorBody | null;
    return b?.message ?? `Gagal (${e.status})`;
  }
  return "Tidak dapat terhubung ke server";
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function stockStatus(stock: number, min: number): "habis" | "menipis" | "aman" {
  if (stock <= 0) return "habis";
  if (stock <= min) return "menipis";
  return "aman";
}
