import { useToast } from "../hooks/useToast";

/** A command or secret shown in a dark block with a Copy button. */
export function CopyCommand({ text, label = "Copy" }: { text: string; label?: string }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Đã copy");
    } catch {
      toast("Trình duyệt chặn copy: hãy bôi đen rồi copy tay", true);
    }
  };
  return (
    <div className="cmd">
      <code>{text}</code>
      <button className="btn sm" type="button" onClick={copy}>
        {label}
      </button>
    </div>
  );
}
