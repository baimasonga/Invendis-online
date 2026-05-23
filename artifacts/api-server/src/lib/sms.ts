function normalisePhone(raw: string): string {
  let p = raw.replace(/\D/g, "");
  if (p.startsWith("0")) p = "232" + p.slice(1);
  if (!p.startsWith("232")) p = "232" + p;
  return p;
}

export async function sendSms(to: string, text: string): Promise<void> {
  const username = process.env.EASYSENDSMS_USERNAME;
  const password = process.env.EASYSENDSMS_PASSWORD;
  const sender   = process.env.EASYSENDSMS_SENDER ?? "AgriPoD";

  if (!username || !password) {
    throw new Error("EasySendSMS credentials not configured");
  }

  const params = new URLSearchParams({
    username,
    password,
    from:   sender,
    to:     normalisePhone(to),
    text,
    type:   "0",
  });

  const resp = await fetch(`https://api.easysendsms.app/bulksms?${params}`, { method: "GET" });
  const body = (await resp.text()).trim();

  if (!body.toUpperCase().startsWith("OK:")) {
    throw new Error(`EasySendSMS error: ${body}`);
  }
}
