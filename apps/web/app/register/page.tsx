import Link from "next/link";
import AuthCard from "../../components/AuthCard";

export default function RegisterInfoPage() {
  return (
    <AuthCard
      title="Getting an account"
      subtitle={
        <>
          There is <strong>no self-registration</strong>. New accounts are created by an administrator.
        </>
      }
      footer={
        <>
          <Link href="/login">Sign in</Link>
          {" · "}
          <Link prefetch={false} href="/documents">Home</Link>
        </>
      }
    >
      <p style={{ color: "#52525b", lineHeight: 1.5, margin: 0 }}>
        If you need access, contact your administrator and ask them to create your account from the admin panel.
      </p>
    </AuthCard>
  );
}
