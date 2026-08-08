const EMAIL_WORKER_URL = "https://bartolini-ticket-email.marcinkolacz.workers.dev";

export async function sendEmailNotification(
  actor: any,
  recipients: string[],
  subject: string,
  message: string
): Promise<{ ok: number; total: number }> {
  if (recipients.length === 0) return { ok: 0, total: 0 };
  const staffToken = await actor.requestStaffActionToken();
  let ok = 0;
  for (const to of recipients) {
    try {
      await fetch(EMAIL_WORKER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + staffToken,
        },
        body: JSON.stringify({ to, subject, message }),
      });
      ok += 1;
    } catch {
      // keep sending to remaining recipients even if one fails
    }
  }
  return { ok, total: recipients.length };
}
