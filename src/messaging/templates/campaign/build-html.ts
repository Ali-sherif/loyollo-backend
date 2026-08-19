import { escapeHtml } from "../html";

/** Campaign HTML wrapper — parity with `src/lib/campaigns.functions.ts` `buildHtml`. */
export function buildCampaignHtml(businessName: string, message: string): string {
  const paragraphs = escapeHtml(message)
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0;line-height:1.55;color:#0a152f;font-size:15px;">${p.replace(/\n/g, "<br/>")}</p>`,
    )
    .join("");
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:14px;padding:32px;border:1px solid #eef1f7;">
      <h1 style="margin:0 0 20px 0;font-size:20px;color:#0a152f;">${escapeHtml(businessName)}</h1>
      ${paragraphs}
    </div>
    <p style="margin:16px 0 0;text-align:center;font-size:12px;color:#8698bb;">Sent by ${escapeHtml(businessName)} via Loyollo</p>
  </div>
</body></html>`;
}
