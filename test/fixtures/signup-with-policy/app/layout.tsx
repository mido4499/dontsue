import Link from "next/link";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html><body>
      {children}
      <footer><Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link></footer>
    </body></html>
  );
}
