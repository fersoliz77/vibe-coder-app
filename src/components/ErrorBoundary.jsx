import { Component } from 'react';

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-splash" role="alert">
        <div className="app-splash__brand"><span className="app-splash__mark" aria-hidden="true">V</span><span className="app-splash__name">Vibe IDE Code</span></div>
        <div className="app-splash__slow">
          <strong>Vibe IDE Code no pudo mostrar esta pantalla</strong>
          <p>{this.state.error?.message || 'Ocurrio un error inesperado.'}</p>
          <button className="btn btn--primary" type="button" onClick={() => window.location.reload()}>Reiniciar ventana</button>
          <button className="btn" type="button" onClick={() => window.electronAPI?.window?.confirmClose()}>Cerrar</button>
        </div>
      </main>
    );
  }
}
