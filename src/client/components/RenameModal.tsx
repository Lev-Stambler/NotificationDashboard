import { useEffect, useState } from "react";
import type { AgentSession } from "../types";

interface Props {
  session: AgentSession | null;
  onClose: () => void;
  onSave: (session: AgentSession, name: string | null) => Promise<void>;
}

export function RenameModal({ session, onClose, onSave }: Props) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!session) return;
    setValue(session.customName || "");
  }, [session]);

  if (!session) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave(session, value.trim() ? value.trim() : null);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Rename agent"
        onClick={(event) => event.stopPropagation()}
      >
        <h2>Rename Agent</h2>
        <p>Default name: {session.defaultName}</p>
        <form onSubmit={handleSubmit}>
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Type custom name"
          />
          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" disabled={saving}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
