import { ChatWorkspace } from "@/components/chat-workspace/chat-workspace";
import { ProviderList } from "@/components/provider-list/provider-list";
import { ProjectGraph } from "@/components/project-graph/project-graph";
import {
  sampleProjectGraphEdges,
  sampleProjectGraphNodes,
} from "@/lib/graph/sample-project-graph";
import styles from "./App.module.css";

const projects = [
  { name: "Prometheus", meta: "Desktop workspace" },
  { name: "Study Graph", meta: "Planned workspace" },
];

export function App() {
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

      <div className={styles.main}>
        <ChatWorkspace />
      </div>

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
