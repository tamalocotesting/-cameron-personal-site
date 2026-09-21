export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-workspace">
      <a href="#auth-main" className="skip-link">
        Skip to content
      </a>
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
        <div className="mb-5">
          <p className="text-[19px] font-semibold tracking-tight text-ink">RecruiterOS</p>
          <p className="mt-0.5 text-[13px] text-ink-faint">AI prepares. Recruiter decides.</p>
        </div>
        <main id="auth-main">{children}</main>
        <p className="mt-6 text-[12px] leading-relaxed text-ink-faint">
          Staff access is invitation only. RecruiterOS is software for a recruiting office; it is not
          government-authorized, certified, or approved for real applicant data.
        </p>
      </div>
    </div>
  );
}
