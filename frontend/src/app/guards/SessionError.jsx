import { useAppSession } from "../../context/SessionContext";

export default function SessionError() {
  const { checkSession } = useAppSession();

  async function handleRetry() {
    await checkSession();
  }

  return (
    <main className="route-status">
      <div className="route-status-card">
        <h2>Unable to verify your session</h2>

        <p>
          Check your connection and ensure the backend is running.
          A temporary connection error does not automatically log
          you out.
        </p>

        <button
          type="button"
          className="route-retry-button"
          onClick={handleRetry}
        >
          Retry
        </button>
      </div>
    </main>
  );
}