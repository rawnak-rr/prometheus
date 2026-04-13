import { useEffect, useState } from "react";

import type { LocalProvider } from "@/lib/providers/types";
import styles from "./provider-list.module.css";

const loadingProviders: LocalProvider[] = [
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    description: "Checking local terminal environment.",
    status: "missing",
  },
  {
    id: "claude",
    name: "Claude",
    command: "claude",
    description: "Checking local terminal environment.",
    status: "missing",
  },
];

export function ProviderList() {
  const [providers, setProviders] = useState<LocalProvider[]>(loadingProviders);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadProviders() {
      try {
        const data = await window.prometheus.providers.list();

        if (isMounted) {
          setProviders(data.providers);
          setError(null);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Local provider detection failed.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadProviders();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <>
      <div className={styles.list} aria-busy={isLoading}>
        {providers.map((provider) => (
          <div className={styles.item} key={provider.id}>
            <div className={styles.heading}>
              <strong>{provider.name}</strong>
              <span className={`${styles.badge} ${styles[provider.status]}`}>
                {isLoading ? "checking" : provider.status}
              </span>
            </div>
            <span className={styles.meta}>{provider.description}</span>
            <span className={styles.command}>Command: {provider.command}</span>
          </div>
        ))}
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}
    </>
  );
}
