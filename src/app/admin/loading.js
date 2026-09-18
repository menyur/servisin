export default function Loading() {
  return (
    <div className="max-w-6xl mx-auto px-5 py-10 animate-pulse" aria-busy="true" aria-live="polite">
      <div className="h-9 w-64 bg-line/60 rounded-lg mb-3" />
      <div className="h-4 w-96 bg-line/40 rounded mb-8" />
      <div className="h-10 w-full max-w-md bg-line/40 rounded-xl mb-8" />
      <div className="grid lg:grid-cols-4 gap-5">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-28 rounded-2xl bg-paper border border-line" />
        ))}
      </div>
    </div>
  );
}
