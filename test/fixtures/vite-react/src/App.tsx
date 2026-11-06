import posthog from "posthog-js";

posthog.init("phc_xxx");

export function App() {
  const locate = () => navigator.geolocation.getCurrentPosition((p) => console.log(p));
  return <button onClick={locate}>Find stores near me</button>;
}
