// Resend is called over HTTP, with no SDK in package.json.
const FROM = process.env.EMAIL_FROM ?? "App <onboarding@resend.dev>";

export async function sendEmail(to: string, subject: string, html: string) {
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
}
