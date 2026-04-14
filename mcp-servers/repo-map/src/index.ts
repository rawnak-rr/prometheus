#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { RepoIndexer, type SymbolHit } from "./indexer.js";

const rootDir = process.env.REPO_MAP_ROOT?.trim() || process.cwd();
const indexer = new RepoIndexer(rootDir);

const server = new McpServer({
  name: "repo-map",
  version: "0.1.0",
});

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

function formatSymbolHit(hit: SymbolHit, signature?: string): string {
  const base = `${hit.filePath}:${hit.line}:${hit.column}  [${hit.kind}] ${hit.name}`;
  return signature ? `${base}\n    ${signature}` : base;
}

server.registerTool(
  "find_definition",
  {
    title: "Find symbol definition",
    description:
      "Locate where a named symbol is declared. Returns one or more candidate definition sites (file:line:col), each with a one-line signature. Use the optional file_hint to disambiguate when a name is common.",
    inputSchema: {
      name: z.string().describe("Symbol name to look up (identifier)."),
      file_hint: z
        .string()
        .optional()
        .describe("Optional file path (relative to repo root) to restrict the search."),
    },
  },
  async ({ name, file_hint }) => {
    const hits = await indexer.findSymbols(name, file_hint);
    if (hits.length === 0) return text(`No definition found for "${name}".`);

    const top = hits.slice(0, 25);
    const signatures = await Promise.all(top.map((hit) => indexer.signatureOf(hit)));
    const lines = top.map((hit, i) => formatSymbolHit(hit, signatures[i]));
    const more = hits.length > 25 ? `\n… ${hits.length - 25} more candidates omitted.` : "";
    return text(lines.join("\n") + more);
  },
);

server.registerTool(
  "find_references",
  {
    title: "Find symbol references",
    description:
      "Find all reference sites of a named symbol across the repo. Returns file:line:col with a one-line snippet per reference. Use file_hint to disambiguate.",
    inputSchema: {
      name: z.string().describe("Symbol name to find references for."),
      file_hint: z
        .string()
        .optional()
        .describe("Optional file path (relative to repo root) to pin the declaration."),
    },
  },
  async ({ name, file_hint }) => {
    const refs = await indexer.findReferences(name, file_hint);
    if (refs.length === 0) return text(`No references found for "${name}".`);

    const lines = refs
      .slice(0, 100)
      .map((ref) => `${ref.filePath}:${ref.line}:${ref.column}  ${ref.snippet}`);
    const more = refs.length > 100 ? `\n… ${refs.length - 100} more references omitted.` : "";
    return text(`${refs.length} reference(s) for "${name}":\n${lines.join("\n")}${more}`);
  },
);

server.registerTool(
  "related_files",
  {
    title: "Related files (imports / imported-by)",
    description:
      "For a given file, list the files it imports and the files that import it (one hop). Useful for mapping a neighborhood before reading sources.",
    inputSchema: {
      path: z.string().describe("File path (relative to repo root or absolute)."),
    },
  },
  async ({ path }) => {
    const { imports, importedBy } = await indexer.relatedFiles(path);
    if (imports.length === 0 && importedBy.length === 0) {
      return text(`No imports or importers resolved for "${path}". Is this a source file in the project?`);
    }

    const parts: string[] = [];
    parts.push(`File: ${path}`);
    parts.push(`Imports (${imports.length}):`);
    parts.push(imports.length ? imports.map((p) => `  ${p}`).join("\n") : "  (none)");
    parts.push(`Imported by (${importedBy.length}):`);
    parts.push(importedBy.length ? importedBy.map((p) => `  ${p}`).join("\n") : "  (none)");
    return text(parts.join("\n"));
  },
);

server.registerTool(
  "symbols_in_file",
  {
    title: "Exported symbols in a file",
    description:
      "List the exported symbols of a file with one-line signatures — gives the agent a file's public surface without reading the whole body.",
    inputSchema: {
      path: z.string().describe("File path (relative to repo root or absolute)."),
    },
  },
  async ({ path }) => {
    const hits = await indexer.symbolsInFile(path);
    if (hits.length === 0) return text(`No exported symbols found in "${path}".`);

    const signatures = await Promise.all(hits.map((hit) => indexer.signatureOf(hit)));
    const lines = hits.map((hit, i) => formatSymbolHit(hit, signatures[i]));
    return text(`Exports in ${path}:\n${lines.join("\n")}`);
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`repo-map-mcp failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
