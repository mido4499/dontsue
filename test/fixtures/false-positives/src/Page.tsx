const geolocation = { lat: 0, lng: 0 }; // a local variable, not navigator.geolocation
export function Page() {
  return (
    <div>
      <p>Email us at hi@example.com or call our phone line.</p>
      {/* <input type="email" /> */}
      <input type="text" name="username" />
      <input type="hidden" name="email" value="x" />
      <input type="search" name="q" />
      <span>{geolocation.lat}</span>
    </div>
  );
}
