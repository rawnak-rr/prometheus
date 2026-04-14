import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { Identifier, Node, Project, SourceFile } from "ts-morph";

export type IndexerOptions = {
  rootDir: string;
};

export type SymbolHit = {
  name: string;
  kind: string;
  filePath: string;
  line: number;
  column: number;
};

export type ReferenceHit = {
  filePath: string;
  line: number;
  column: number;
  snippet: string;
};

function findTsconfig(start: string): string | null {
  let dir = start;
  for (;;) {
    const candidate = resolve(dir, "tsconfig.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export class RepoIndexer {
  private project: Project | null = null;
  private loadPromise: Promise<Project> | null = null;
  private readonly mtimes = new Map<string, number>();
  constructor(private readonly rootDir: string) {}

  private async ensureProject(): Promise<Project> {
    if (this.project) return this.project;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      const tsconfig = findTsconfig(this.rootDir);
      const project = tsconfig
        ? new Project({ tsConfigFilePath: tsconfig, skipAddingFilesFromTsConfig: false })
        : new Project({ compilerOptions: { allowJs: true, checkJs: false } });

      if (!tsconfig) {
        project.addSourceFilesAtPaths([
          resolve(this.rootDir, "**/*.{ts,tsx,js,jsx,mjs,cjs}"),
          `!${resolve(this.rootDir, "**/node_modules/**")}`,
          `!${resolve(this.rootDir, "**/dist/**")}`,
          `!${resolve(this.rootDir, "**/out/**")}`,
        ]);
      }

      for (const sf of project.getSourceFiles()) {
        this.mtimes.set(sf.getFilePath(), this.getMtime(sf.getFilePath()));
      }

      this.project = project;
      return project;
    })();

    return this.loadPromise;
  }

  private getMtime(path: string): number {
    try {
      return statSync(path).mtimeMs;
    } catch {
      return 0;
    }
  }

  private refreshStale(project: Project): void {
    for (const sf of project.getSourceFiles()) {
      const path = sf.getFilePath();
      const current = this.getMtime(path);
      const last = this.mtimes.get(path) ?? 0;
      if (current > last) {
        sf.refreshFromFileSystemSync();
        this.mtimes.set(path, current);
      }
    }
  }

  relPath(path: string): string {
    return relative(this.rootDir, path) || path;
  }

  resolveInputPath(path: string): string {
    return isAbsolute(path) ? path : resolve(this.rootDir, path);
  }

  async findSourceFile(path: string): Promise<SourceFile | null> {
    const project = await this.ensureProject();
    this.refreshStale(project);
    const abs = this.resolveInputPath(path);
    return project.getSourceFile(abs) ?? null;
  }

  async findSymbols(name: string, fileHint?: string): Promise<SymbolHit[]> {
    const identifiers = await this.findDeclarationIdentifiers(name, fileHint);
    return identifiers.map((id) => this.identifierToHit(name, id));
  }

  async findReferences(name: string, fileHint?: string): Promise<ReferenceHit[]> {
    const identifiers = await this.findDeclarationIdentifiers(name, fileHint);
    if (identifiers.length === 0) return [];

    const refs: ReferenceHit[] = [];
    const seen = new Set<string>();

    for (const identifier of identifiers) {
      try {
        const found = identifier.findReferences();
        for (const symbolRefs of found) {
          for (const ref of symbolRefs.getReferences()) {
            const refNode = ref.getNode();
            const refSf = refNode.getSourceFile();
            const { line, column } = refSf.getLineAndColumnAtPos(refNode.getStart());
            const key = `${refSf.getFilePath()}:${line}:${column}`;
            if (seen.has(key)) continue;
            seen.add(key);
            refs.push({
              filePath: this.relPath(refSf.getFilePath()),
              line,
              column,
              snippet: this.getLineSnippet(refSf, line),
            });
          }
        }
      } catch {
        // findReferences can throw on nodes without symbol info
      }
    }

    return refs;
  }

  private async findDeclarationIdentifiers(
    name: string,
    fileHint?: string,
  ): Promise<Identifier[]> {
    const project = await this.ensureProject();
    this.refreshStale(project);

    const files = fileHint
      ? [project.getSourceFile(this.resolveInputPath(fileHint))].filter(
          (f): f is SourceFile => !!f,
        )
      : project.getSourceFiles();

    const identifiers: Identifier[] = [];
    const seen = new Set<string>();

    for (const sf of files) {
      for (const decl of this.enumerateNamedDeclarations(sf)) {
        const id = decl.getFirstChild(Node.isIdentifier);
        if (!id) continue;
        if (id.getText() !== name) continue;
        const key = `${sf.getFilePath()}:${id.getStart()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        identifiers.push(id);
      }
    }

    return identifiers;
  }

  private *enumerateNamedDeclarations(sf: SourceFile): Generator<Node> {
    yield* sf.getFunctions();
    yield* sf.getClasses();
    yield* sf.getInterfaces();
    yield* sf.getTypeAliases();
    yield* sf.getEnums();
    yield* sf.getVariableDeclarations();
    for (const cls of sf.getClasses()) {
      yield* cls.getMethods();
      yield* cls.getProperties();
    }
    for (const iface of sf.getInterfaces()) {
      yield* iface.getMethods();
      yield* iface.getProperties();
    }
  }

  async relatedFiles(path: string): Promise<{ imports: string[]; importedBy: string[] }> {
    const sf = await this.findSourceFile(path);
    if (!sf) return { imports: [], importedBy: [] };

    const imports = new Set<string>();
    for (const decl of sf.getImportDeclarations()) {
      const src = decl.getModuleSpecifierSourceFile();
      if (src) imports.add(this.relPath(src.getFilePath()));
    }
    for (const decl of sf.getExportDeclarations()) {
      const src = decl.getModuleSpecifierSourceFile();
      if (src) imports.add(this.relPath(src.getFilePath()));
    }

    const importedBy = new Set<string>();
    for (const referencing of sf.getReferencingSourceFiles()) {
      importedBy.add(this.relPath(referencing.getFilePath()));
    }

    return {
      imports: [...imports].sort(),
      importedBy: [...importedBy].sort(),
    };
  }

  async symbolsInFile(path: string): Promise<SymbolHit[]> {
    const sf = await this.findSourceFile(path);
    if (!sf) return [];

    const hits: SymbolHit[] = [];
    for (const [name, decls] of sf.getExportedDeclarations()) {
      for (const decl of decls) {
        const { line, column } = decl
          .getSourceFile()
          .getLineAndColumnAtPos(decl.getStart());
        hits.push({
          name,
          kind: decl.getKindName(),
          filePath: this.relPath(decl.getSourceFile().getFilePath()),
          line,
          column,
        });
      }
    }
    return hits;
  }

  async signatureOf(hit: SymbolHit): Promise<string> {
    const project = await this.ensureProject();
    const sf = project.getSourceFile(this.resolveInputPath(hit.filePath));
    if (!sf) return "";
    const node = sf.getDescendantAtPos(
      sf.compilerNode.getPositionOfLineAndCharacter(hit.line - 1, hit.column - 1),
    );
    if (!node) return "";

    const owner = node.getParent() ?? node;
    const text = owner.getText();
    const firstLine = text.split("\n")[0]?.trim() ?? "";
    if (firstLine.length <= 200) return firstLine;
    return firstLine.slice(0, 200) + "…";
  }

  private identifierToHit(name: string, id: Identifier): SymbolHit {
    const parent = id.getParent() ?? id;
    const sf = id.getSourceFile();
    const { line, column } = sf.getLineAndColumnAtPos(parent.getStart());
    return {
      name,
      kind: parent.getKindName(),
      filePath: this.relPath(sf.getFilePath()),
      line,
      column,
    };
  }

  private getLineSnippet(sf: SourceFile, line: number): string {
    const lines = sf.getFullText().split("\n");
    return (lines[line - 1] ?? "").trim().slice(0, 200);
  }
}
