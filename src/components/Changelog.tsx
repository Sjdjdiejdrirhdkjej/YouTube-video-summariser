import React from 'react';
import { marked } from 'marked';

export default function Changelog({ onBack }: { onBack: () => void }) {
  const [content, setContent] = React.useState('');
  const [loading, setLoading] = React.useState(true);

  const [error, setError] = React.useState('');

  React.useEffect(() => {
    fetch('/api/changelog')
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load changelog: ${r.status}`);
        return r.json();
      })
      .then((data) => setContent(data.content))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const html = React.useMemo(() => {
    if (!content) return '';
    return marked.parse(content) as string;
  }, [content]);

  return (
    <div className="changelog-page">
      <button type="button" className="back-btn" onClick={onBack}>
        ← Back
      </button>
      {loading ? (
        <p className="changelog-loading">Loading changelog…</p>
      ) : error ? (
        <p className="changelog-error">{error}</p>
      ) : (
        <div
          className="changelog-content markdown-body"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
