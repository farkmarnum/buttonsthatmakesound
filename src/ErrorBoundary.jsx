import { Component } from "react";

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, textAlign: "center", color: "#e77" }}>
          <h2>Something went wrong</h2>
          <p style={{ color: "#888", marginTop: 8 }}>{this.state.error.message}</p>
          <button
            type="button"
            style={{
              marginTop: 16, padding: "8px 24px", borderRadius: 8,
              border: "none", background: "#333", color: "#fff", cursor: "pointer",
            }}
            onClick={() => this.setState({ error: null })}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
