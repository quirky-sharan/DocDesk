/** Slow colour fields and a whisper of grain behind the whole app. Purely decorative. */
export default function AppBackdrop() {
  return (
    <div className="app-backdrop" aria-hidden="true">
      <div className="aurora aurora-1" />
      <div className="aurora aurora-2" />
      <div className="aurora aurora-3" />
      <div className="grain" />
    </div>
  );
}
