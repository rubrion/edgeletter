import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { sanitizeHtml } from '../lib/sanitize';
import type { Lang } from '../i18n';
import { studio } from '../i18n/studio';

type UploadResult = { url: string; key: string; kind: 'image' | 'video'; size: number };

const ACCEPTED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
]);

const uploadMedia = async (file: File): Promise<UploadResult> => {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/media/upload', {
    method: 'POST',
    credentials: 'same-origin',
    body: fd,
  });
  const j = (await res.json().catch(() => ({}))) as { error?: string } & Partial<UploadResult>;
  if (!res.ok || !j.url) throw new Error(j.error ?? `upload failed (${res.status})`);
  return j as UploadResult;
};

const snippetFor = (r: UploadResult): string =>
  r.kind === 'image' ? `![](${r.url})` : `<video src="${r.url}" controls></video>`;

type RecentPost = {
  id: string;
  title: string;
  slug: string;
  contentMd: string;
  isPublished: boolean;
  publishedAt: string | null;
  lastSentAt: string | null;
};

type AiUsage = { used: number; limit: number };

type Props = {
  recent: RecentPost[];
  initialAiUsage: AiUsage | null;
  /** Post to open on load (from /admin?post=<id>); otherwise a blank draft. */
  openId?: string | null;
  lang?: Lang;
};

type Draft = {
  id: string;
  title: string;
  slug: string;
  contentMd: string;
  isPublished: boolean;
  lastSentAt: string | null;
};

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const blank: Draft = {
  id: '',
  title: '',
  slug: '',
  contentMd: '',
  isPublished: false,
  lastSentAt: null,
};

const formatSentAt = (iso: string, locale?: string): string => {
  try {
    return new Date(iso).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
};

const toDraft = (p: RecentPost): Draft => ({
  id: p.id,
  title: p.title,
  slug: p.slug,
  contentMd: p.contentMd,
  isPublished: p.isPublished,
  lastSentAt: p.lastSentAt,
});

export default function AdminEditor({ recent, initialAiUsage, openId, lang = 'en' }: Props) {
  const t = studio(lang);
  const loc = lang === 'pt-BR' ? 'pt-BR' : 'en-US';
  const [posts, setPosts] = useState<RecentPost[]>(recent);
  const opened = openId ? recent.find((p) => p.id === openId) : undefined;
  const [draft, setDraft] = useState<Draft>(opened ? toDraft(opened) : blank);
  const [slugDirty, setSlugDirty] = useState(!!opened);
  const [busy, setBusy] = useState<'idle' | 'saving' | 'publishing' | 'deleting' | 'uploading' | 'reviewing'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(initialAiUsage);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const insertAtCursor = (snippet: string) => {
    const ta = textareaRef.current;
    setDraft((d) => {
      const start = ta?.selectionStart ?? d.contentMd.length;
      const end = ta?.selectionEnd ?? d.contentMd.length;
      const before = d.contentMd.slice(0, start);
      const after = d.contentMd.slice(end);
      // Pad with a newline if we're not on a fresh line, so markdown blocks render cleanly.
      const sep = before.length === 0 || before.endsWith('\n') ? '' : '\n';
      const next = `${before}${sep}${snippet}\n${after}`;
      // Restore caret just after the inserted snippet on the next tick.
      const caret = before.length + sep.length + snippet.length + 1;
      queueMicrotask(() => {
        if (ta) {
          ta.focus();
          ta.setSelectionRange(caret, caret);
        }
      });
      return { ...d, contentMd: next };
    });
  };

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => ACCEPTED_MIME.has(f.type));
    if (list.length === 0) {
      setMessage(t('ed.msgUnsupported'));
      return;
    }
    setBusy('uploading');
    setMessage(`${t('ed.uploading')} (${list.length})`);
    let okCount = 0;
    let failMsg: string | null = null;
    for (const f of list) {
      try {
        const r = await uploadMedia(f);
        insertAtCursor(snippetFor(r));
        okCount++;
      } catch (err) {
        failMsg = err instanceof Error ? err.message : 'upload error';
      }
    }
    setBusy('idle');
    setMessage(
      failMsg
        ? `${okCount}/${list.length} ✓ — ${failMsg}`
        : `${okCount} ✓`,
    );
  };

  useEffect(() => {
    if (!slugDirty) {
      setDraft((d) => ({ ...d, slug: slugify(d.title) }));
    }
  }, [draft.title, slugDirty]);

  const previewHtml = useMemo(() => {
    if (!draft.contentMd) return '';
    return sanitizeHtml(marked.parse(draft.contentMd, { async: false }) as string);
  }, [draft.contentMd]);

  const isExisting = !!draft.id;
  const wasSent = !!draft.lastSentAt;

  const loadPost = (p: RecentPost) => {
    setDraft({
      id: p.id,
      title: p.title,
      slug: p.slug,
      contentMd: p.contentMd,
      isPublished: p.isPublished,
      lastSentAt: p.lastSentAt,
    });
    setSlugDirty(true);
    setMessage(null);
  };

  const newPost = () => {
    setDraft(blank);
    setSlugDirty(false);
    setMessage(null);
  };

  const submit = async (publish: boolean) => {
    if (!draft.title.trim() || !draft.contentMd.trim()) {
      setMessage(t('ed.msgRequired'));
      return;
    }
    setBusy(publish ? 'publishing' : 'saving');
    setMessage(null);
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          id: draft.id || undefined,
          title: draft.title,
          slug: draft.slug || slugify(draft.title),
          content_md: draft.contentMd,
          publish,
        }),
      });
      const json = (await res.json()) as {
        post?: {
          id: string;
          title: string;
          slug: string;
          contentMd: string;
          isPublished: boolean;
          publishedAt: string | null;
        };
        campaign?: { sentAt: string; status: string } | null;
        dispatch?: { recipients: number; queued: boolean; sent: number; failed: number } | null;
        alreadySent?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setMessage(json.error ?? `failed (${res.status})`);
        return;
      }
      if (!json.post) return;

      const sentAtIso =
        json.campaign && (json.campaign.status === 'sent' || json.campaign.status === 'partial')
          ? json.campaign.sentAt
          : draft.lastSentAt;

      const updatedDraft: Draft = {
        id: json.post.id,
        title: json.post.title,
        slug: json.post.slug,
        contentMd: json.post.contentMd,
        isPublished: json.post.isPublished,
        lastSentAt: sentAtIso,
      };
      setDraft(updatedDraft);
      setSlugDirty(true);

      const updatedPost: RecentPost = {
        ...updatedDraft,
        publishedAt: json.post.publishedAt ?? null,
      };
      setPosts((curr) => [updatedPost, ...curr.filter((x) => x.id !== updatedPost.id)]);

      if (json.alreadySent) {
        setMessage(t('ed.msgAlreadySent'));
      } else if (json.dispatch) {
        const d = json.dispatch;
        setMessage(
          d.queued
            ? t('ed.msgQueued', { n: d.recipients })
            : t('ed.msgSentTo', { n: d.sent }) + (d.failed ? t('ed.msgFailed', { n: d.failed }) : ''),
        );
      } else if (publish) {
        setMessage(t('ed.msgPublished'));
      } else {
        setMessage(isExisting ? t('ed.msgUpdated') : t('ed.msgDraft'));
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setBusy('idle');
    }
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, draft.contentMd]);
    setDraft((d) => ({ ...d, contentMd: prev }));
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, draft.contentMd]);
    setDraft((d) => ({ ...d, contentMd: next }));
  };

  const handleAiReview = async () => {
    if (!draft.contentMd.trim()) {
      setMessage(t('ed.msgNothing'));
      return;
    }
    const snapshot = draft.contentMd;
    setBusy('reviewing');
    setMessage(t('ed.msgReviewing'));
    setUndoStack((s) => [...s, snapshot]);
    setRedoStack([]);
    try {
      const res = await fetch('/api/ai/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ contentMd: snapshot }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        contentMd?: string;
        error?: string;
        used?: number;
        limit?: number;
      };
      if (typeof j.used === 'number' && typeof j.limit === 'number') {
        setAiUsage({ used: j.used, limit: j.limit });
      }
      if (!res.ok || !j.contentMd) {
        setUndoStack((s) => s.slice(0, -1));
        setMessage(j.error ?? `AI review failed (${res.status})`);
        return;
      }
      setDraft((d) => ({ ...d, contentMd: j.contentMd! }));
      setMessage(t('ed.msgAiDone'));
    } catch (err) {
      setUndoStack((s) => s.slice(0, -1));
      setMessage(err instanceof Error ? err.message : t('ed.msgAiError'));
    } finally {
      setBusy('idle');
    }
  };

  const handleDelete = async () => {
    if (!draft.id) return;
    const ok = window.confirm(`${draft.title || t('ed.untitled')}\n\n${t('ed.confirmDelete')}`);
    if (!ok) return;
    setBusy('deleting');
    setMessage(null);
    try {
      const res = await fetch(`/api/posts/${draft.id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setMessage(j.error ?? `failed (${res.status})`);
        return;
      }
      const deletedId = draft.id;
      setPosts((curr) => curr.filter((p) => p.id !== deletedId));
      setDraft(blank);
      setSlugDirty(false);
      setMessage(t('ed.msgDeleted'));
    } finally {
      setBusy('idle');
    }
  };

  return (
    <div style={styles.shell}>
      <aside style={styles.sidebar}>
        <button onClick={newPost} style={styles.newBtn}>
          {t('nav.newPost')}
        </button>
        <span style={styles.sidebarLabel}>{t('ed.manuscripts')}</span>
        <div style={styles.list} className="ed-list">
          {posts.length === 0 && <p style={styles.muted}>{t('ed.noPosts')}</p>}
          {posts.map((p) => (
            <button
              key={p.id}
              onClick={() => loadPost(p)}
              style={{
                ...styles.listItem,
                ...(draft.id === p.id ? styles.listItemActive : null),
              }}
            >
              <span style={styles.listTitle}>{p.title || t('ed.untitled')}</span>
              <span style={styles.listMeta}>
                {p.lastSentAt
                  ? `[ ${t('ed.sent', { d: formatSentAt(p.lastSentAt, loc) })} ]`
                  : p.isPublished
                    ? `[ ${t('ed.published')} ]`
                    : `[ ${t('ed.draft')} ]`}
              </span>
            </button>
          ))}
        </div>
      </aside>
      <main style={styles.main}>
        <div style={styles.fields}>
          <input
            type="text"
            placeholder={t('ed.titlePh')}
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            style={styles.titleInput}
          />
          <input
            type="text"
            placeholder="slug"
            value={draft.slug}
            onChange={(e) => {
              setSlugDirty(true);
              setDraft((d) => ({ ...d, slug: e.target.value }));
            }}
            style={styles.slugInput}
          />
        </div>
        <div style={styles.toolbar}>
          <button
            type="button"
            onClick={handleUndo}
            disabled={busy !== 'idle' || undoStack.length === 0}
            style={styles.toolBtn}
            title={t('ed.undoTitle')}
          >
            {t('ed.undo')}
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={busy !== 'idle' || redoStack.length === 0}
            style={styles.toolBtn}
            title={t('ed.redoTitle')}
          >
            {t('ed.redo')}
          </button>
          <span style={styles.toolDivider} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy === 'uploading'}
            style={styles.toolBtn}
          >
            {busy === 'uploading' ? t('ed.uploading') : t('ed.upload')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                void handleFiles(e.target.files);
              }
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => void handleAiReview()}
            disabled={busy !== 'idle'}
            style={busy === 'reviewing'
              ? { ...styles.toolBtn, ...styles.toolBtnAi, opacity: 0.7 }
              : { ...styles.toolBtn, ...styles.toolBtnAi }}
          >
            {busy === 'reviewing' ? t('ed.reviewing') : t('ed.review')}
          </button>
          <span style={styles.toolHint}>{t('ed.dropHint')}</span>
        </div>
        <div style={styles.split}>
          <textarea
            ref={textareaRef}
            placeholder={t('ed.bodyPh')}
            value={draft.contentMd}
            onChange={(e) => setDraft((d) => ({ ...d, contentMd: e.target.value }))}
            onDragOver={(e) => {
              if (e.dataTransfer?.types?.includes('Files')) {
                e.preventDefault();
                setDragOver(true);
              }
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
                e.preventDefault();
                setDragOver(false);
                void handleFiles(e.dataTransfer.files);
              }
            }}
            onPaste={(e) => {
              const files = e.clipboardData?.files;
              if (files && files.length > 0) {
                e.preventDefault();
                void handleFiles(files);
              }
            }}
            style={{
              ...styles.textarea,
              ...(dragOver ? styles.textareaDrop : null),
            }}
            spellCheck
          />
          <div style={styles.preview} className="ed-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
        <div style={styles.actions}>
          {aiUsage && (
            <span
              style={{
                ...styles.aiUsage,
                ...(aiUsage.used / aiUsage.limit >= 0.9 ? styles.aiUsageDanger : null),
              }}
              title={`${aiUsage.used.toLocaleString()} of ${aiUsage.limit.toLocaleString()} AI review tokens used today`}
            >
              ✦ {t('ed.tokens', { used: aiUsage.used.toLocaleString(loc), limit: aiUsage.limit.toLocaleString(loc) })}
            </span>
          )}
          {message && <span style={styles.message}>{message}</span>}
          {wasSent && draft.lastSentAt && (
            <span style={styles.sentBadge}>[ {t('ed.sentBadge', { d: formatSentAt(draft.lastSentAt, loc) })} ]</span>
          )}
          <div style={{ flex: 1 }} />
          {isExisting && (
            <button
              onClick={handleDelete}
              disabled={busy !== 'idle'}
              style={styles.btnDanger}
            >
              {busy === 'deleting' ? t('ed.deleting') : t('ed.delete')}
            </button>
          )}
          <button
            onClick={() => submit(false)}
            disabled={busy !== 'idle'}
            style={styles.btnSecondary}
          >
            {busy === 'saving'
              ? t('ed.saving')
              : isExisting
                ? t('ed.update')
                : t('ed.saveDraft')}
          </button>
          {!wasSent && (
            <button
              onClick={() => submit(true)}
              disabled={busy !== 'idle'}
              style={styles.btnPrimary}
            >
              {busy === 'publishing' ? t('ed.publishing') : t('ed.publish')}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

// Stationery tokens come from src/styles/admin.css (loaded by AdminHead).
const micro: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
};
const sharpBtn: React.CSSProperties = {
  ...micro,
  padding: '0.7rem 1.3rem',
  borderRadius: 0,
  cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'background-color 0.2s, color 0.2s, border-color 0.2s',
};

const styles: Record<string, React.CSSProperties> = {
  shell: { display: 'grid', gridTemplateColumns: '280px 1fr', height: '100%' },
  sidebar: { borderRight: 'var(--hairline)', padding: '1.5rem 1.25rem', display: 'flex', flexDirection: 'column', background: 'var(--paper)' },
  newBtn: { ...sharpBtn, background: 'var(--ink)', color: 'var(--card)', border: '1px solid var(--ink)', marginBottom: '1.75rem' },
  sidebarLabel: { ...micro, color: 'var(--accent)', paddingBottom: '0.6rem', marginBottom: '0.6rem', borderBottom: 'var(--hairline)' },
  list: { display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto', flex: 1, paddingTop: '0.25rem' },
  listItem: { textAlign: 'left', padding: '0.85rem 0.9rem', background: 'transparent', border: '1px solid transparent', borderRadius: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.35rem', fontFamily: 'inherit', color: 'var(--ink)' },
  listItemActive: { background: 'var(--card)', border: 'var(--hairline)', boxShadow: 'var(--shadow-paper)', borderLeft: '2px solid var(--accent)' },
  listTitle: { fontFamily: 'var(--font-display-stack)', fontWeight: 500, fontSize: '1.25rem', lineHeight: 1.15, letterSpacing: '0.005em' },
  listMeta: { ...micro, fontSize: 10, color: 'var(--muted)' },
  muted: { color: 'var(--muted)', fontSize: '0.9rem', fontStyle: 'italic' },
  main: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--card)' },
  fields: { display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.25rem 1.75rem', borderBottom: 'var(--hairline)' },
  titleInput: { flex: 1, minWidth: 0, fontFamily: 'var(--font-display-stack)', fontWeight: 500, wordSpacing: '0.05em', fontSize: '2.1rem', letterSpacing: '0.005em', lineHeight: 1.1, border: 'none', outline: 'none', padding: '0.25rem 0', background: 'transparent', color: 'var(--ink)', boxShadow: 'none' },
  slugInput: { width: 240, flex: 'none', fontSize: '0.85rem', fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace" },
  toolbar: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', padding: '0.7rem 1.75rem', borderBottom: 'var(--hairline)', background: 'var(--paper)' },
  toolBtn: { ...micro, fontSize: 10.5, padding: '0.45rem 0.8rem', background: 'var(--card)', color: 'var(--ink)', border: 'var(--hairline)', borderRadius: 0, cursor: 'pointer', fontFamily: 'inherit' },
  toolBtnAi: { background: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid var(--accent)' },
  toolDivider: { display: 'inline-block', width: 1, height: '1.3rem', background: 'var(--hairline-color)', margin: '0 0.35rem' },
  toolHint: { fontSize: '0.8rem', fontStyle: 'italic', color: 'var(--muted)', marginLeft: 'auto' },
  split: { flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden' },
  textarea: { padding: '1.5rem 1.75rem', border: 'none', borderRight: 'var(--hairline)', borderRadius: 0, outline: 'none', resize: 'none', minHeight: 0, height: '100%', background: '#FBFAF7', color: 'var(--ink)', boxShadow: 'none', fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", fontSize: '0.9rem', lineHeight: 1.7 },
  textareaDrop: { background: 'color-mix(in srgb, var(--accent) 6%, #FBFAF7)', boxShadow: 'inset 0 0 0 1px var(--accent)' },
  preview: { padding: '2rem 2.5rem', overflowY: 'auto', background: 'var(--card)', lineHeight: 1.7, fontSize: '1.02rem' },
  actions: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.9rem 1.75rem', borderTop: 'var(--hairline)', background: 'var(--paper)' },
  message: { fontSize: '0.9rem', fontStyle: 'italic', color: 'var(--muted)' },
  aiUsage: { ...micro, fontSize: 10, color: 'var(--accent-deep)', whiteSpace: 'nowrap' },
  aiUsageDanger: { color: '#9C2F14' },
  sentBadge: { ...micro, fontSize: 10.5, color: '#4F6B3A', whiteSpace: 'nowrap' },
  btnSecondary: { ...sharpBtn, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--ink)' },
  btnDanger: { ...sharpBtn, background: 'transparent', color: '#9C2F14', border: '1px solid transparent', padding: '0.7rem 0.5rem' },
  btnPrimary: { ...sharpBtn, background: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid var(--accent)' },
};
