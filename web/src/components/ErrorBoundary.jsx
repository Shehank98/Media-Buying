import { Component } from 'react';
import { reportError } from '../lib/errorReporter';

// Catches render-time crashes anywhere below it, reports them to the error log,
// and shows a friendly fallback with a reload option instead of a white screen.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    reportError({
      message: error?.message || 'React render error',
      stack: `${error?.stack || ''}\n\nComponent stack:${info?.componentStack || ''}`,
      url: window.location.href,
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg, #F5F6F8)', padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: 'center', background: '#fff', border: '1px solid #E5E8ED', borderRadius: 14, padding: '32px 28px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#16243C', marginBottom: 8 }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: '#6B7790', marginBottom: 20, lineHeight: 1.5 }}>
            The page hit an unexpected error. It has been logged for the team. You can reload to continue.
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{ border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '9px 18px', borderRadius: 9, fontFamily: 'inherit', background: '#C44A18', color: '#fff' }}
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
