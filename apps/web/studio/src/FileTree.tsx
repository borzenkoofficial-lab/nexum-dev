import { useMemo, useState } from "react";
import { ancestorDirs, buildFileTree, type FileNode } from "./model.ts";

/** Keyboard-accessible project file tree (buttons; Enter/Space toggle and open). */
export function FileTree({ files, selected, onOpen }: { files: string[]; selected: string | null; onOpen: (path: string) => void }) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(selected ? ancestorDirs(selected) : []));
  const toggle = (path: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const render = (nodes: FileNode[], depth: number) => (
    <ul role={depth === 0 ? "tree" : "group"} aria-label={depth === 0 ? "Файлы проекта" : undefined} className="st-tree">
      {nodes.map((node) => {
        const expanded = node.kind === "dir" && (open.has(node.path) || ancestorDirs(selected ?? "").includes(node.path));
        return (
          <li key={node.path} role="treeitem" aria-expanded={node.kind === "dir" ? expanded : undefined} aria-selected={node.path === selected}>
            <button
              type="button"
              className={"st-tree-item" + (node.path === selected ? " is-selected" : "")}
              style={{ paddingLeft: 10 + depth * 14 }}
              onClick={() => (node.kind === "dir" ? toggle(node.path) : onOpen(node.path))}
              title={node.path}
            >
              <span aria-hidden="true" className="st-tree-icon">{node.kind === "dir" ? (expanded ? "▾" : "▸") : "·"}</span>
              <span className="st-tree-name">{node.name}</span>
            </button>
            {expanded && node.children.length > 0 && render(node.children, depth + 1)}
          </li>
        );
      })}
    </ul>
  );
  if (!files.length) return <p className="st-muted st-pad">Файлов пока нет. Опишите задачу агенту — он создаст проект.</p>;
  return render(tree, 0);
}
