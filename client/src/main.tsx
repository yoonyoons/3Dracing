import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

/** 예상 못 한 오류가 나도 빈 화면 대신 안내를 보여 줍니다. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page center">
        <div className="hero-emoji">😵</div>
        <h1>앗, 문제가 생겼어요</h1>
        <p className="sub">새로고침해 보세요. 계속되면 선생님께 알려 주세요.</p>
        <code className="card">{this.state.error.message}</code>
        <button className="btn primary" onClick={() => window.location.reload()}>새로고침</button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
