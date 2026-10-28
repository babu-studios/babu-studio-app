import { Component, type ReactNode } from "react";

type DialogErrorBoundaryProps = {
  onClose: () => void;
  children: ReactNode;
};

type DialogErrorBoundaryState = {
  error: Error | null;
};

/**
 * Catches render-time failures inside the AI dialog and shows the error
 * message in place of a blank screen, so the failure names itself and the
 * rest of the app keeps working.
 */
export class DialogErrorBoundary extends Component<DialogErrorBoundaryProps, DialogErrorBoundaryState> {
  state: DialogErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): DialogErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error("AI dialog failed to render:", error);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="export-progress-backdrop">
          <section className="export-progress-dialog" role="alertdialog" aria-label="AI dialog error">
            <div className="export-progress-heading">
              <h2>Something went wrong opening this popup</h2>
            </div>
            <p className="export-progress-path">
              <code>{this.state.error.message}</code>
            </p>
            <div className="ai-step-actions">
              <button
                className="ai-step-button"
                type="button"
                onClick={() => {
                  this.setState({ error: null });
                  this.props.onClose();
                }}
              >
                Close
              </button>
            </div>
          </section>
        </div>
      );
    }
    return this.props.children;
  }
}
