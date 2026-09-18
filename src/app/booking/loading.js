export default function Loading() {
  return (
    <div className="max-w-6xl mx-auto px-5 py-10 animate-pulse" aria-busy="true" aria-live="polite">
      <div className="h-9 w-72 bg-line/60 rounded-lg mb-3" />
      <div className="h-4 w-80 bg-line/40 rounded mb-8" />
      <div className="grid lg:grid-cols-3 gap-5">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-44 rounded-2xl bg-paper border border-line" />
        ))}
      </div>
    </div>
  );
}
