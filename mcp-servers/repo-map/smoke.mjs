import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

const child = spawn("node", ["dist/index.js"], {
  cwd: process.cwd(),
  env: { ...process.env, REPO_MAP_ROOT: "/Users/rawnakhossaindeepto/prometheus" },
  stdio: ["pipe", "pipe", "pipe"],
});

child.stderr.on("data", (b) => process.stderr.write(`[server-stderr] ${b}`));

const rl = createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;

rl.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    } else {
      console.log("[notification]", JSON.stringify(msg));
    }
  } catch (e) {
    console.log("[raw]", line);
  }
});

function send(method, params) {
  const id = nextId++;
  const req = { jsonrpc: "2.0", id, method, params };
  child.stdin.write(JSON.stringify(req) + "\n");
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, 30000);
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

try {
  const init = await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.0.0" },
  });
  console.log("initialize:", init.result?.serverInfo);

  notify("notifications/initialized", {});

  const list = await send("tools/list", {});
  console.log("tools:", list.result?.tools?.map((t) => t.name));

  const sym = await send("tools/call", {
    name: "find_definition",
    arguments: { name: "startClaudeAgentTurn" },
  });
  console.log("\n--- find_definition startClaudeAgentTurn ---");
  console.log(sym.result?.content?.[0]?.text);

  const refs = await send("tools/call", {
    name: "find_references",
    arguments: { name: "startClaudeAgentTurn" },
  });
  console.log("\n--- find_references startClaudeAgentTurn ---");
  console.log(refs.result?.content?.[0]?.text);

  const related = await send("tools/call", {
    name: "related_files",
    arguments: { path: "src/lib/chat/local-chat-runner.ts" },
  });
  console.log("\n--- related_files local-chat-runner.ts ---");
  console.log(related.result?.content?.[0]?.text);

  const exports = await send("tools/call", {
    name: "symbols_in_file",
    arguments: { path: "src/lib/chat/claude-agent-runner.ts" },
  });
  console.log("\n--- symbols_in_file claude-agent-runner.ts ---");
  console.log(exports.result?.content?.[0]?.text);
} finally {
  child.kill();
  await once(child, "exit").catch(() => {});
}
