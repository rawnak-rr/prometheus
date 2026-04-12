import { ProviderList } from "@/components/provider-list/provider-list";
import { ProjectGraph } from "@/components/project-graph/project-graph";
import {
  sampleProjectGraphEdges,
  sampleProjectGraphNodes,
} from "@/lib/graph/sample-project-graph";
import styles from "./page.module.css";

const projects = [
  { name: "Prometheus", meta: "Active repository" },
  { name: "Study Graph", meta: "Planned workspace" },
];

export default function Home() {
  return (
    <main className={styles.workspace}>
      <aside className={styles.sidebar} aria-label="Project navigation">
        <div className={styles.brand}>
          <p className={styles.eyebrow}>Prometheus</p>
          <h1>Project memory</h1>
          <p>Chat with local coding agents while the repository map stays visible.</p>
        </div>

        <section className={styles.section}>
          <h2>Projects</h2>
          <div className={styles.list}>
            {projects.map((project) => (
              <div className={styles.listItem} key={project.name}>
                <strong>{project.name}</strong>
                <span>{project.meta}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h2>Providers</h2>
          <ProviderList />
        </section>
      </aside>

      <section className={styles.main} aria-label="Chat workspace">
        <header className={styles.chatHeader}>
          <h2>Prometheus bootstrap</h2>
          <p>First pass of the coding workspace before provider sessions are connected.</p>
        </header>

        <div className={styles.thread}>
          <article className={styles.message}>
            <strong>User</strong>
            <p>Build the first project shell with chat, providers, and graph context.</p>
          </article>
          <article className={styles.message}>
            <strong>Prometheus</strong>
            <p>
              The workspace is ready for the first real graph renderer, Supabase schema,
              and local provider session layer.
            </p>
          </article>
        </div>

        <footer className={styles.composer}>
          <div className={styles.composerBox}>
            <input aria-label="Message" placeholder="Start a project-aware chat" />
            <button type="button">Send</button>
          </div>
        </footer>
      </section>

      <aside className={styles.graphPanel} aria-label="Project graph">
        <div className={styles.graphHeader}>
          <h2>Graph</h2>
          <p>Project, chat, file, topic, summary, and provider nodes.</p>
        </div>
        <ProjectGraph nodes={sampleProjectGraphNodes} edges={sampleProjectGraphEdges} />
      </aside>
    </main>
  );
}
