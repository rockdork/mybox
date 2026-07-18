export function ErrorBanner({ msg, onClose }: { msg: string; onClose: () => void }) {
  if (!msg) return null;
  return (
    <div className="error" onClick={onClose}>
      {msg}（点击关闭）
    </div>
  );
}
