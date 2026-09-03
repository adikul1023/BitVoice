import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  return (
    <main className="shell">
      <p className="eyebrow">SecureVoice / Phase 0</p>
      <h1>A quieter way to connect.</h1>
      <p className="intro">
        The project foundation is ready. Calling, identity, and private transport arrive in later phases.
      </p>
      <div className="status" role="status">
        <span className="status-dot" />
        Repository scaffold online
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
