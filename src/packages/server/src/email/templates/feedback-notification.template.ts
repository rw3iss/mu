/**
 * Admin notification email for a new feedback submission. Rendered by
 * {@link renderTemplate} from {@link FeedbackNotificationData}.
 *
 *  - `{{key}}`   → HTML-escaped value
 *  - `{{{body}}}` → raw (pre-escaped, newline→<br>) feedback text
 */
export const FEEDBACK_NOTIFICATION_TEMPLATE = `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="margin:0;background:#0d0f16;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e7e9ee;">
    <div style="max-width:560px;margin:0 auto;background:#141826;border:1px solid #232838;border-radius:12px;overflow:hidden;">
      <div style="padding:18px 24px;background:#1b2030;border-bottom:1px solid #232838;">
        <h1 style="margin:0;font-size:18px;font-weight:700;color:#fff;">New feedback received</h1>
      </div>
      <div style="padding:24px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:4px 0;color:#9aa3b5;width:96px;">From</td><td style="padding:4px 0;color:#fff;">{{name}}</td></tr>
          <tr><td style="padding:4px 0;color:#9aa3b5;">Email</td><td style="padding:4px 0;color:#fff;">{{email}}</td></tr>
          <tr><td style="padding:4px 0;color:#9aa3b5;">Page</td><td style="padding:4px 0;color:#8ab4ff;">{{pageUrl}}</td></tr>
          <tr><td style="padding:4px 0;color:#9aa3b5;">When</td><td style="padding:4px 0;color:#fff;">{{createdAt}}</td></tr>
        </table>
        <div style="margin-top:16px;padding:16px;background:#0d0f16;border:1px solid #232838;border-radius:8px;line-height:1.6;color:#e7e9ee;">{{{body}}}</div>
        {{{screenshotNote}}}
      </div>
      <div style="padding:14px 24px;background:#1b2030;border-top:1px solid #232838;font-size:12px;color:#6b7488;">
        Manage feedback in <a href="{{adminUrl}}" style="color:#8ab4ff;text-decoration:none;">Mu → Feedback</a>.
      </div>
    </div>
  </body>
</html>`;
