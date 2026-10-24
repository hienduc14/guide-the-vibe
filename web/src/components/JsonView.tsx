export function JsonView({ value, label = "Chi tiết" }: { value: unknown; label?: string }) {
  return (
    <details>
      <summary>{label}</summary>
      <pre className="json">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
