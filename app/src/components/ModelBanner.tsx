import type { ModelProgress } from '../api';
import { modelName } from '../format';

// First-run model download/warm banner. The on-device model can be a multi-GB download; without
// this the app looks frozen. Driven by the snapshot in /api/state (also streamed via SSE at
// /api/model/progress). Hidden once the model is ready.
export default function ModelBanner({ progress }: { progress: ModelProgress | undefined }) {
  if (!progress || progress.phase === 'ready') return null;

  if (progress.phase === 'error') {
    return (
      <div className="model-banner err">
        <span>Model failed to load: {progress.message ?? 'unknown error'}</span>
      </div>
    );
  }

  const downloading = progress.phase === 'downloading';
  const pct = Math.max(0, Math.min(100, Math.round(progress.percentage ?? 0)));
  return (
    <div className="model-banner">
      <div className="mb-row">
        <span className="mb-spin" />
        <span className="mb-text">
          {downloading
            ? `Downloading on-device model ${progress.model ? `(${modelName(progress.model)})` : ''} — first run only`
            : 'Warming up the on-device model…'}
        </span>
        {downloading && <span className="mb-pct">{pct}%</span>}
      </div>
      {downloading && (
        <div className="mb-meter"><span style={{ width: `${pct}%` }} /></div>
      )}
    </div>
  );
}
