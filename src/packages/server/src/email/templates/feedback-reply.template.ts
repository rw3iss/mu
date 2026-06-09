/**
 * Email sent to a feedback submitter when an admin resolves and/or replies to
 * their submission. Flexible for both cases — the dynamic `intro`, `replyBlock`
 * and `closing` are built by EmailService.sendFeedbackReply and injected raw.
 */
export const FEEDBACK_REPLY_TEMPLATE = `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="margin:0;background:#0d0f16;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e7e9ee;">
    <div style="max-width:560px;margin:0 auto;background:#141826;border:1px solid #232838;border-radius:12px;overflow:hidden;">
      <div style="padding:18px 24px;background:#1b2030;border-bottom:1px solid #232838;">
        <h1 style="margin:0;font-size:18px;font-weight:700;color:#fff;">{{heading}}</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 16px;line-height:1.6;color:#e7e9ee;">{{{intro}}}</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px;">
          <tr><td style="padding:3px 0;color:#9aa3b5;width:110px;">Ticket</td><td style="padding:3px 0;color:#fff;">#{{ticketId}}</td></tr>
          <tr><td style="padding:3px 0;color:#9aa3b5;">Reported</td><td style="padding:3px 0;color:#fff;">{{reportedAt}}</td></tr>
        </table>
        <div style="margin:0 0 4px;font-size:12px;color:#9aa3b5;">Your feedback</div>
        <blockquote style="margin:0;padding:14px 16px;background:#0d0f16;border-left:3px solid #2f3650;border-radius:6px;line-height:1.6;color:#c7ccd8;font-style:italic;">{{{originalBody}}}</blockquote>
        {{{replyBlock}}}
        {{{closing}}}
      </div>
      <div style="padding:14px 24px;background:#1b2030;border-top:1px solid #232838;font-size:12px;color:#6b7488;">
        This message was sent from your Mu server.
      </div>
    </div>
  </body>
</html>`;
