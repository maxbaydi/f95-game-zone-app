const Metadata = () => (
  <div className="p-5 text-text">
    <div className="rounded-2xl border border-border bg-primary/40 p-4">
      <div className="text-lg font-semibold">Metadata downloads</div>
      <p className="mt-2 text-sm opacity-70">
        Preview images are now downloaded automatically for library installs and
        updates. The old toggle was removed because it only added confusion and
        did not improve the real workflow.
      </p>
    </div>
  </div>
);

window.Metadata = Metadata;
