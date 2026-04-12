import styles from "./page.module.css";

const projects = [
  { name: "Prometheus", meta: "Active repository" },
  { name: "Study Graph", meta: "Planned workspace" },
];

const providers = [
  { name: "Codex", meta: "Local terminal provider" },
  { name: "Claude", meta: "Local terminal provider" },
];

const graphNodes = [
  { label: "Project", x: 32, y: 34 },
  { label: "Chat", x: 178, y: 48 },
  { label: "Files", x: 96, y: 164 },
  { label: "Topics", x: 224, y: 178 },
];

const graphEdges = [
  { x: 96, y: 76, width: 92, rotate: 8 },
  { x: 82, y: 116, width: 88, rotate: 116 },
  { x: 190, y: 120, width: 72, rotate: 66 },
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
          <div className={styles.list}>
            {providers.map((provider) => (
              <div className={styles.listItem} key={provider.name}>
                <strong>{provider.name}</strong>
                <span>{provider.meta}</span>
              </div>
            ))}
          </div>
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
        <h2>Graph</h2>
        <p>Project, chat, file, and topic nodes will live here.</p>

        <div className={styles.graphPreview} aria-label="Seeded graph preview">
          {graphEdges.map((edge) => (
            <span
              aria-hidden="true"
              className={styles.edge}
              key={`${edge.x}-${edge.y}`}
              style={{
                left: edge.x,
                top: edge.y,
                width: edge.width,
                transform: `rotate(${edge.rotate}deg)`,
              }}
            />
          ))}
          {graphNodes.map((node) => (
            <span
              className={styles.node}
              key={node.label}
              style={{ left: node.x, top: node.y }}
            >
              {node.label}
            </span>
          ))}
        </div>

        <div className={styles.nodeDetails}>
          <strong>Selected: Project</strong>
          <p>Next step: replace this preview with a real interactive graph library.</p>
        </div>
      </aside>
    </main>
  );
}
