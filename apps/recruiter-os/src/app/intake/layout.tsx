export default function IntakeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-workspace">
      <a href="#intake-main" className="skip-link">
        Skip to content
      </a>
      {/* Mobile-first: one column, generous targets, no horizontal scroll at 375px. */}
      <div className="mx-auto w-full max-w-lg px-4 py-6">
        <main id="intake-main">{children}</main>
      </div>
    </div>
  );
}
