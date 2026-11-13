// The app's own "/resend" route must not be mistaken for the Resend email service.
export function VerifyEmail() {
  async function resend() {
    await fetch("/api/auth/verify/resend", { method: "POST" });
  }
  return <button onClick={resend}>Resend code</button>;
}
