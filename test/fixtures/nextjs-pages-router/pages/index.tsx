import Link from "next/link";
export default function Home() {
  return (
    <main>
      <input type="email" />
      <Link href="/privacy-policy">Privacy policy</Link>
    </main>
  );
}
