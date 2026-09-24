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
  hutang: "Hutang",
};

export const todayLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/** wa.me deep link; normalises 08xx / +62 numbers to 62xx. Empty phone → WhatsApp contact picker. */
export function waLink(phone: string, text: string): string {
  let n = phone.replace(/\D/g, "");
  if (n.startsWith("0")) n = "62" + n.slice(1);
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

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
