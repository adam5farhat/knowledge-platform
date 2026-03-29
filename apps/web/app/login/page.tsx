import LoginClient from "./LoginClient";

/** Direct import avoids an extra `next/dynamic` round-trip vs `LoginGate` (faster first paint on `/login`). */
export default function LoginPage() {
  return <LoginClient />;
}
