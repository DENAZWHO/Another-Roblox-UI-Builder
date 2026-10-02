// The Projects window: every saved design, with live thumbnails.
import { memo, useEffect, useMemo, useState } from 'react';
import { Copy, Download, FolderOpen, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { computeLayout } from '../model/layout';
import { applyPixelScale, pixelScaleFactor } from '../model/pixelScale';
import { screenRoots, screensOf } from '../model/screens';
import type { Doc } from '../model/types';
import { createProject, deleteProject, duplicateProject, exportProject, openProjectById, refreshProjects, renameProject, useProjects, type ProjectInfo } from '../projects';
import { openProject } from '../files';
import { ScreenView, type RenderCtx } from './render';
import { useFontEpoch } from './hooks';
import { Modal } from './Dialogs';

const THUMB_W = 208;
const THUMB_H = 124;
const close = () => useStore.setState({ dialog: null });

/** The project's first screen, drawn by the real renderer */
const ProjectThumb = memo(function ProjectThumb({ doc }: { doc: Doc }) {
  const epoch = useFontEpoch();
  const view = useMemo(() => {
    const roots = screenRoots(doc, screensOf(doc)[0].id);
    const nodes = applyPixelScale(doc.nodes, doc.rootIds, pixelScaleFactor(doc));
    return { roots, nodes, layout: computeLayout(nodes, roots, doc.device) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, epoch]);
  const { w, h } = doc.device;
  const k = Math.min(THUMB_W / w, THUMB_H / h);
  const ctx: RenderCtx = { nodes: view.nodes, layout: view.layout, interactive: false, previewUser: doc.previewUser, pixelScale: pixelScaleFactor(doc) };
  return (
    <div className="project-thumb">
      <div className="project-thumb-screen" style={{ width: w, height: h, transform: `scale(${k})`, left: (THUMB_W - w * k) / 2, top: (THUMB_H - h * k) / 2 }}>
        {view.roots.map((id) => <ScreenView key={id} id={id} ctx={ctx} />)}
      </div>
    </div>
  );
});

function ago(t: number): string {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
}

function ProjectCard({ p, open }: { p: ProjectInfo; open: boolean }) {
  const liveDoc = useStore((s) => (open ? s.doc : null));
  const liveName = useStore((s) => (open ? s.project?.name : null));
  const [renaming, setRenaming] = useState(false);
  const name = liveName ?? p.name;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
      className={`project-card ${open ? 'open' : ''}`}
      title={open ? 'Open now' : `Open "${name}"`}
      onClick={() => {
        if (renaming) return;
        close();
        void openProjectById(p.id);
      }}
    >
      <ProjectThumb doc={liveDoc ?? p.doc} />
      <div className="project-meta">
        {renaming ? (
          <input
            className="prefab-rename"
            autoFocus
            defaultValue={name}
            onClick={stop}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              if (e.target.value.trim() && e.target.value.trim() !== name) void renameProject(p.id, e.target.value);
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <span className="project-name" onDoubleClick={(e) => (stop(e), setRenaming(true))}>{name}</span>
        )}
        <span className="muted project-time">{open ? <b className="project-open">Open</b> : `Edited ${ago(p.updatedAt)}`}</span>
      </div>
      <div className="project-actions" onClick={stop}>
        <button className="icon-btn" title="Rename" onClick={() => setRenaming(true)}><Pencil size={12} /></button>
        <button className="icon-btn" title="Duplicate" onClick={() => void duplicateProject(p.id)}><Copy size={12} /></button>
        <button className="icon-btn" title="Download as a project file" onClick={() => void exportProject(p.id)}><Download size={12} /></button>
        <button
          className="icon-btn danger"
          title="Delete"
          onClick={() => {
            if (confirm(`Delete "${name}"? This can't be undone (download it first to keep a copy).`)) void deleteProject(p.id);
          }}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

export function ProjectsDialog() {
  const { projects, loaded } = useProjects();
  const current = useStore((s) => s.project);
  const [query, setQuery] = useState('');
  useEffect(() => void refreshProjects(), []);
  const shown = projects.filter((p) => (p.id === current?.id ? current.name : p.name).toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Modal title="Projects" onClose={close} wide>
      <div className="projects-top">
        <button
          className="primary"
          onClick={() => {
            close();
            void createProject();
          }}
        >
          <Plus size={14} /> New project
        </button>
        <button
          className="btn"
          title="Open a .uibuilder.json file as a new project"
          onClick={() => {
            close();
            void openProject();
          }}
        >
          <FolderOpen size={14} /> Open file…
        </button>
        <span style={{ flex: 1 }} />
        {projects.length > 4 && (
          <label className="projects-search">
            <Search size={12} />
            <input placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </label>
        )}
      </div>
      {!current && loaded ? (
        <p className="hint">Projects are kept in this browser's storage, which isn't available here (private window?). Your work is still autosaved, and you can download it with Save project.</p>
      ) : (
        <>
          <div className="projects-grid">
            {shown.map((p) => <ProjectCard key={p.id} p={p} open={p.id === current?.id} />)}
          </div>
          {loaded && !shown.length && <p className="hint">No project matches "{query}".</p>}
          <p className="hint">Projects are saved in this browser automatically as you work. Download one to back it up or move it to another computer.</p>
        </>
      )}
    </Modal>
  );
}
