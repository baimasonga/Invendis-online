function normalisePhone(raw: string): string {
  let p = raw.replace(/\D/g, "");
  if (p.startsWith("0")) p = "232" + p.slice(1);
  if (!p.startsWith("232")) p = "232" + p;
  return p;
}

export async function sendSms(to: string, text: string): Promise<void> {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_PHONE_NUMBER;

  if (!sid || !token || !from) {
    throw new Error("Twilio credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER)");
  }

  const e164 = "+" + normalisePhone(to);
  const body = new URLSearchParams({ From: from, To: e164, Body: text });

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    }
  );

  const json = await resp.json() as { error_message?: string };
  if (!resp.ok || json.error_message) {
    throw new Error(`Twilio SMS error: ${json.error_message ?? resp.status}`);
  }
}
