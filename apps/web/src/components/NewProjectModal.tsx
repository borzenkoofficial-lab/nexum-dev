interface NewProjectModalProps {
  open: boolean;
  name: string;
  loading: boolean;
  onNameChange: (name: string) => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

export function NewProjectModal({ open, name, loading, onNameChange, onClose, onSubmit }: NewProjectModalProps) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-project-title"><div className="modal-header"><div><span className="eyebrow">PROJECTS</span><h2 id="new-project-title">New Project</h2></div><button className="icon-button" type="button" aria-label="Close new project dialog" onClick={onClose}>×</button></div><form onSubmit={onSubmit}><label htmlFor="project-name">Project name</label><input id="project-name" value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="e.g. Client Website" autoFocus maxLength={64} /><div className="modal-actions"><button className="cancel-button" type="button" onClick={onClose}>Cancel</button><button className="create-button" type="submit" disabled={loading || !name.trim()}>{loading ? "Creating..." : "Create"}</button></div></form></div>
    </div>
  );
}
