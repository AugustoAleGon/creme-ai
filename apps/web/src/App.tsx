import { useEffect, useState } from 'react';
import type { HealthResponse } from '@creme/contracts';
import './styles.css';

export function App() {
  const [status, setStatus] = useState<'checking' | 'connected' | 'unavailable'>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function checkConnection() {
      try {
        const response = await fetch('/api/health', { signal: controller.signal });
        const health: Partial<HealthResponse> | null = await response.json();
        if (!response.ok || health?.status !== 'ok' || health.database !== 'connected') {
          throw new Error('Health check failed');
        }
        if (!controller.signal.aborted) setStatus('connected');
      } catch {
        if (!controller.signal.aborted) setStatus('unavailable');
      }
    }
    void checkConnection();
    return () => controller.abort();
  }, [attempt]);

  return (
    <main>
      <p className="eyebrow">CREME / OPERATIONS</p>
      <h1>A foundation for better worker operations.</h1>
      <p className="intro">The workspace is ready for the next increment: the data model and seed scenarios.</p>
      <section aria-labelledby="connection-heading">
        <h2 id="connection-heading">Development connection</h2>
        {status === 'unavailable' ? (
          <div role="alert">
            <p>Connection unavailable. Check that PostgreSQL and the API are running.</p>
            <button onClick={() => {
              setStatus('checking');
              setAttempt((value) => value + 1);
            }}>Try again</button>
          </div>
        ) : (
          <output>{status === 'checking'
            ? 'Checking API and database…'
            : 'API and PostgreSQL connected'}</output>
        )}
      </section>
      <p className="note">Setup only. Worker records, QC and scheduling are not implemented yet.</p>
    </main>
  );
}
