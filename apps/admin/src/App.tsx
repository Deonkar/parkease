import { useEffect, useState } from 'react';

interface HealthResponse {
  status: string;
  version: string;
  timestamp: string;
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
        return res.json() as Promise<HealthResponse>;
      })
      .then(setHealth)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Unknown error');
      });
  }, []);

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif' }}>
      <h1>ParkEase Admin</h1>
      {error ? (
        <p style={{ color: 'red' }}>API error: {error}</p>
      ) : health ? (
        <pre>{JSON.stringify(health, null, 2)}</pre>
      ) : (
        <p>Loading...</p>
      )}
    </div>
  );
}
