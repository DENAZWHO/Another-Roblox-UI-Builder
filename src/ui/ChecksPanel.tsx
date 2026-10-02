// The Checks tab: accessibility problems in the design, with one-click fixes.
import { useEffect, useState, type CSSProperties } from 'react';
import { CheckCircle2, Eye, EyeOff, Wand2 } from 'lucide-react';
import { useStore } from '../store';
import { CHECK_LABELS, runChecks, type CheckIssue, type CheckKind } from '../model/a11y';
import type { Doc } from '../model/types';
import { fixCheckIssues, ignoreChecks } from '../actions';
import { ClassIcon } from './icons';
import { useFontEpoch } from './hooks';
import { zoomToSelection } from './viewport';

let cache: { doc: Doc; epoch: number; issues: CheckIssue[] } | null = null;
function checksFor(doc: Doc, epoch: number): CheckIssue[] {
  if (cache?.doc !== doc || cache.epoch !== epoch) cache = { doc, epoch, issues: runChecks(doc) };
  return cache.issues;
}

/** Current check results (recomputed shortly after edits stop); ignored ones are filtered out unless asked */
export function useCheckIssues(withIgnored = false): CheckIssue[] {
  const doc = useStore((s) => s.doc);
  const epoch = useFontEpoch();
  const [issues, setIssues] = useState<CheckIssue[]>(() => checksFor(doc, epoch));
  useEffect(() => {
    const t = setTimeout(() => setIssues(checksFor(useStore.getState().doc, epoch)), 250);
    return () => clearTimeout(t);
  }, [doc, epoch]);
  if (withIgnored) return issues;
  const ignored = new Set(doc.checksIgnored ?? []);
  return issues.filter((i) => !ignored.has(i.key) && doc.nodes[i.id]);
}

const ORDER: CheckKind[] = ['tap', 'contrast', 'world', 'textSize'];
const fixable = (i: CheckIssue) => i.kind === 'tap' || !!i.fix;
function fixLabel(i: CheckIssue): string {
  if (i.kind === 'tap') return 'Fix: add a UISizeConstraint with MinSize 44×44';
  if (i.fix?.textColor) return `Fix: change the text colour to ${i.fix.textColor.toUpperCase()}`;
  if (i.fix?.strokeColor) return `Fix: outline the text (${i.fix.strokeColor === '#000000' ? 'black' : 'white'} UIStroke, ${i.fix.strokeThickness ?? 2} px)`;
  if (i.fix?.textSize) return `Fix: TextSize ${i.fix.textSize}`;
  return '';
}

export function ChecksTab() {
  const doc = useStore((s) => s.doc);
  const all = useCheckIssues(true);
  const [showIgnored, setShowIgnored] = useState(false);
  const ignored = new Set(doc.checksIgnored ?? []);
  const live = all.filter((i) => doc.nodes[i.id]);
  const open = live.filter((i) => !ignored.has(i.key));
  const hidden = live.filter((i) => ignored.has(i.key));

  const fix = (list: CheckIssue[]) => {
    const n = fixCheckIssues(list);
    useStore.getState().showToast(n ? `Fixed ${n} problem${n === 1 ? '' : 's'} (Ctrl+Z to undo)` : 'Nothing to fix automatically');
  };

  return (
    <div className="checks-tab">
      <div className="checks-summary">
        {open.length ? (
          <>
            <b>{open.length} problem{open.length === 1 ? '' : 's'}</b>
            {open.some(fixable) && (
              <button className="btn small" title="Apply every suggested fix (one undo step)" onClick={() => fix(open.filter(fixable))}>
                <Wand2 size={12} /> Fix all
              </button>
            )}
          </>
        ) : (
          <span className="checks-ok"><CheckCircle2 size={14} /> No problems found</span>
        )}
      </div>
      <p className="hint checks-note">Checked as the UI looks on a small phone (667×375){doc.device.name !== 'Small phone' ? ` and on ${doc.device.name}` : ''}, including hidden panels.</p>

      {ORDER.map((kind) => {
        const list = open.filter((i) => i.kind === kind);
        if (!list.length) return null;
        return (
          <section key={kind} className="checks-group">
            <div className="insert-title checks-title">
              <span>{CHECK_LABELS[kind].title} <span className="muted">{list.length}</span></span>
              {list.some(fixable) && list.length > 1 && (
                <button className="link-btn" title="Apply the suggested fix to each" onClick={() => fix(list.filter(fixable))}>Fix these</button>
              )}
            </div>
            <p className="hint checks-help">{CHECK_LABELS[kind].help}</p>
            {list.map((i) => <IssueRow key={i.key} issue={i} onFix={() => fix([i])} />)}
          </section>
        );
      })}

      {hidden.length > 0 && (
        <section className="checks-group">
          <button className="link-btn checks-ignored-toggle" onClick={() => setShowIgnored(!showIgnored)}>
            {showIgnored ? 'Hide' : 'Show'} {hidden.length} ignored
          </button>
          {showIgnored && hidden.map((i) => <IssueRow key={i.key} issue={i} ignored />)}
        </section>
      )}
    </div>
  );
}

function IssueRow({ issue, ignored, onFix }: { issue: CheckIssue; ignored?: boolean; onFix?: () => void }) {
  const node = useStore((s) => s.doc.nodes[issue.id]);
  const selected = useStore((s) => s.selection.includes(issue.id));
  if (!node) return null;
  return (
    <div
      className={`check-row ${ignored ? 'ignored' : ''} ${selected ? 'on' : ''}`}
      onClick={() => {
        useStore.getState().select([issue.id]);
        requestAnimationFrame(() => zoomToSelection());
      }}
      title="Select it on the canvas"
    >
      <span className={`check-dot ${issue.severity}`} />
      <span className="check-text">
        <span className="check-name"><ClassIcon cls={node.className} size={12} /> {node.name}{ignored && <span className="muted"> · {CHECK_LABELS[issue.kind].title.toLowerCase()}</span>}</span>
        <span className="muted check-msg">
          {issue.kind === 'contrast' && issue.fix?.textColor && <span className="check-swatch" style={{ background: node.props.TextColor3 }} />}
          {issue.message}
        </span>
      </span>
      <span className="check-actions" onClick={(e) => e.stopPropagation()}>
        {!ignored && fixable(issue) && onFix && (
          <button className="icon-btn" title={fixLabel(issue)} onClick={onFix}>
            <Wand2 size={12} />
          </button>
        )}
        <button className="icon-btn" title={ignored ? 'Check this again' : "Ignore — it's fine as it is"} onClick={() => ignoreChecks([issue.key], !ignored)}>
          {ignored ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </span>
    </div>
  );
}

/** Canvas outlines on the elements with problems (while the Checks tab is open) */
export function CheckMarks({ boxStyle }: { boxStyle: (id: string) => CSSProperties | null }) {
  const issues = useCheckIssues();
  const worst = new Map<string, CheckIssue['severity']>();
  for (const i of issues) if (worst.get(i.id) !== 'error') worst.set(i.id, i.severity);
  return (
    <>
      {[...worst].map(([id, sev]) => {
        const st = boxStyle(id);
        return st && <div key={'chk' + id} className={`check-box ${sev}`} style={st} />;
      })}
    </>
  );
}
