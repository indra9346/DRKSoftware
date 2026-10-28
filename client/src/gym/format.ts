import { BRAND } from "@shared/brand";
export const inr = (value: number | string | null | undefined) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));

export const prettyDate = (value?: string | Date | null) => {
  if (!value) return "—";
  const date =
    value instanceof Date
      ? value
      : new Date(`${value.slice(0, 10)}T12:00:00+05:30`);
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
};

export const daysBetween = (from: string, to: string) => {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
};

export const todayLocal = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export const csvExport = (
  filename: string,
  rows: Array<Record<string, unknown>>
) => {
  if (!rows.length) return;
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const cell = (value: unknown) => {
    const raw = String(value ?? "");
    const safe =
      typeof value === "string" && /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const csv = [
    columns.map(cell).join(","),
    ...rows.map(row => columns.map(key => cell(row[key])).join(",")),
  ].join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    char =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!
  );

export function printReceipt(input: {
  gymName?: string | null;
  logoUrl?: string | null;
  address?: string | null;
  contactPhone?: string | null;
  businessDetails?: string | null;
  receiptNumber: string;
  memberName: string;
  memberCode: string;
  amount: number;
  mode: string;
  recordedAt: string | Date;
  notes?: string | null;
}) {
  const popup = window.open("", "_blank", "width=720,height=780");
  if (!popup) {
    window.print();
    return;
  }
  // The owner's logo (Settings) if set, otherwise the gym's bundled print logo.
  const logoSrc = input.logoUrl?.toLowerCase().startsWith("https://")
    ? input.logoUrl
    : new URL(BRAND.printLogo, window.location.origin).href;
  const logoMarkup = `<img src="${escapeHtml(logoSrc)}" alt="" style="max-width:96px;max-height:96px;object-fit:contain">`;
  const html = `<!doctype html><html><head><title>Receipt ${escapeHtml(input.receiptNumber)}</title><style>
  *{box-sizing:border-box}body{font:14px Arial,sans-serif;color:#171820;margin:0;padding:42px}.paper{max-width:640px;margin:auto;border:1px solid #ddd;padding:36px}.brand{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #4d6b00;padding-bottom:22px}.name{font-size:26px;font-weight:800;letter-spacing:.05em}.eyebrow{font-size:10px;letter-spacing:.18em;color:#4d6b00;text-transform:uppercase;margin-bottom:8px}.muted{color:#777;font-size:12px;line-height:1.7}.amount{font-size:32px;font-weight:700;margin:28px 0}.line{display:flex;justify-content:space-between;gap:16px;padding:13px 0;border-bottom:1px solid #eee}.line span:first-child{color:#777}.footer{margin-top:30px;padding-top:15px;border-top:1px dashed #ddd;font-size:11px;color:#777}.print{margin:24px auto;display:block;background:#4d6b00;border:0;color:white;padding:12px 24px;border-radius:6px}@media print{body{padding:0}.paper{border:0}.print{display:none}}
  </style></head><body><article class="paper"><header class="brand"><div style="display:flex;align-items:center;gap:14px">${logoMarkup}<div><div class="eyebrow">Payment received</div><div class="name">${escapeHtml(input.gymName || BRAND.name)}</div><div class="muted">${escapeHtml(input.address)}<br/>${escapeHtml(input.contactPhone)}</div></div></div><div style="text-align:right"><div class="eyebrow">Receipt</div><strong>${escapeHtml(input.receiptNumber)}</strong><div class="muted">${escapeHtml(new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(input.recordedAt)))}</div></div></header><div class="amount">${escapeHtml(new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(input.amount))}</div><div class="line"><span>Member</span><strong>${escapeHtml(input.memberName)}</strong></div><div class="line"><span>Member ID</span><strong>${escapeHtml(input.memberCode)}</strong></div><div class="line"><span>Payment mode</span><strong>${escapeHtml(input.mode.toUpperCase())}</strong></div>${input.notes ? `<div class="line"><span>Note</span><strong>${escapeHtml(input.notes)}</strong></div>` : ""}<div class="footer">${escapeHtml(input.businessDetails || "Thank you for choosing us.")}<br/>Computer-generated receipt · Keep this for your records</div></article><button class="print" onclick="window.print()">Print / Save as PDF</button></body></html>`;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
}
