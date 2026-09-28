import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Tool, ToolResult } from "../types.js";
import { ProjectWorkspace } from "./workspace.js";

export class ScaffoldProjectTool implements Tool {
  name = "scaffoldProject";
  description = "Creates only a minimal runnable project foundation. The AI agent must implement the actual product afterward.";

  constructor(private readonly workspace: ProjectWorkspace) {}

  async execute(input: string): Promise<ToolResult> {
    try {
      const brief = input.trim();
      if (!brief) return { success: false, output: "scaffoldProject requires a non-empty app brief" };

      const title = this.makeTitle(brief);
      let dir: string;
      try {
        dir = await this.workspace.existing(".");
      } catch {
        dir = await this.workspace.writable(".");
      }

      // Hard safety boundary: scaffolding is initialization, never an overwrite
      // mechanism. The planner may be wrong; the tool itself must still protect
      // the user's existing project.
      const entries = await readdir(dir, { withFileTypes: true });
      const meaningfulEntries = entries.filter((entry) => ![".git", "node_modules", "dist"].includes(entry.name));
      const starterOnly = meaningfulEntries.length > 0 && meaningfulEntries.every((entry) =>
        ["index.html", "style.css", "app.js"].includes(entry.name),
      );
      let canInitializeStarter = false;
      if (starterOnly) {
        try {
          const starterHtml = await readFile(join(dir, "index.html"), "utf8");
          const starterApp = await readFile(join(dir, "app.js"), "utf8");
          canInitializeStarter =
            /Проект готов\. Передайте задачу агенту — NEXUM спроектирует и соберёт приложение\./i.test(starterHtml) &&
            /NEXUM Agent готов заменить стартовый экран/i.test(starterApp);
        } catch {
          canInitializeStarter = false;
        }
      }
      if (meaningfulEntries.length > 0 && !canInitializeStarter) {
        return {
          success: false,
          output: "Refused to scaffold a non-empty project. Inspect and edit the existing files instead.",
        };
      }

      await mkdir(dir, { recursive: true });

      const isApi = /api|backend|бекенд|серверн|rest api|graphql/i.test(brief);
      const isReact = /react|vite|spa|single.?page|реакт|web app|веб-прилож|saas|dashboard|панель управления/i.test(brief);
      const files = isApi
        ? this.apiFiles(title)
        : isReact
          ? this.reactFiles(title, brief)
          : [
            ["index.html", this.indexHtml(title, brief)],
            ["style.css", "html,body{min-height:100%;margin:0}body{font-family:system-ui,sans-serif;background:#fff;color:#111}"],
            ["app.js", 'console.info("NEXUM project foundation ready");'],
          ] as const;

      for (const [path, content] of files) {
        const target = await this.workspace.writable(path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
      }

      return {
        success: true,
        output: isApi
          ? `Backend/API scaffold created for “${title}”. Run npm install and npm run build or npm run start as applicable.`
          : isReact
            ? `React/Vite scaffold created for “${title}”. Run npm install and npm run build to generate the production preview.`
            : `Website scaffold created: index.html, style.css, app.js for “${title}”.`,
      };
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : "Unable to scaffold project",
      };
    }
  }

  private reactFiles(title: string, brief: string): readonly [string, string][] {
    const safeTitle = this.escapeHtml(title);
    return [
      ["package.json", JSON.stringify({
        name: "nexum-app",
        private: true,
        version: "0.0.0",
        type: "module",
        scripts: { build: "vite build", dev: "vite --host 0.0.0.0" },
        dependencies: { react: "^19.1.1", "react-dom": "^19.1.1" },
        devDependencies: { vite: "^7.1.7", "@vitejs/plugin-react": "^5.0.4" }
      }, null, 2)],
      ["vite.config.js", 'import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nexport default defineConfig({ plugins: [react()] });\n'],
      ["index.html", '<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>'+safeTitle+'</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>'],
      ["src/main.jsx", 'import React from "react";\nimport { createRoot } from "react-dom/client";\nimport "./styles.css";\nimport App from "./App.jsx";\ncreateRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);\n'],
      ["src/App.jsx", 'export default function App(){return <main id="nexum-root" aria-label="Application"><h1>Loading product…</h1></main>}\n'],
      ["src/styles.css", 'html,body,#root{min-height:100%;margin:0}body{font-family:system-ui,sans-serif;background:#fff;color:#111}button,input,textarea,select{font:inherit}'],
    ];
  }



  private apiFiles(title: string): readonly [string, string][] {
    const safeTitle = this.escapeHtml(title);
    return [
      ["package.json", JSON.stringify({
        name: "nexum-api",
        private: true,
        version: "0.0.0",
        type: "module",
        scripts: { build: "tsc", start: "node dist/server.js", dev: "tsx src/server.ts" },
        dependencies: { express: "^5.1.0" },
        devDependencies: { "@types/express": "^5.0.5", "@types/node": "^24.0.0", tsx: "^4.20.3", typescript: "^5.9.2" }
      }, null, 2)],
      ["tsconfig.json", JSON.stringify({
        compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", outDir: "dist", rootDir: "src", strict: true, esModuleInterop: true, skipLibCheck: true },
        include: ["src/**/*.ts"]
      }, null, 2)],
      ["src/server.ts", `import express from "express";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, service: "${safeTitle}" }));

app.listen(3000, () => console.log("API listening on http://localhost:3000"));
`],
    ];
  }

  private makeTitle(brief: string): string {
    const compact = brief
      .replace(/^\s*(создай|сделай|разработай|build|create|make)\s+/i, "")
      .replace(/\s+/g, " ")
      .trim();
    const words = compact.split(" ").filter(Boolean).slice(0, 6);
    const title = words.join(" ");
    return (title || "NEXUM Project").slice(0, 60);
  }

  private indexHtml(title: string, brief: string): string {
    const safeTitle = this.escapeHtml(title);
    const safeBrief = this.escapeHtml(brief || "NEXUM project");
    return `<!doctype html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${safeBrief}"><title>${safeTitle}</title></head>
<body><main id="nexum-root" aria-label="Application"></main><script src="./app.js"></script></body>
</html>`;
  }


  private styleCss(): string {
    return `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111;background:#f5f5f2;font-synthesis:none}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;min-width:320px}
body:before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(circle at 50% 0%,rgba(255,255,255,.95),transparent 45%)}
.nav{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;padding:20px 28px;background:rgba(245,245,242,.76);backdrop-filter:blur(18px);border-bottom:1px solid rgba(17,17,17,.08)}
.brand{font-size:14px;font-weight:900;letter-spacing:.16em;color:#111;text-decoration:none}
.nav-button,.primary{border:0;border-radius:14px;padding:12px 18px;background:#111;color:#fff;font-weight:800;cursor:pointer}
main{width:min(1180px,100%);margin:auto;padding:48px 24px 96px}
.hero{min-height:62vh;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding:48px 0}
.eyebrow{font-size:12px;font-weight:900;letter-spacing:.16em;color:#737373}
h1{max-width:900px;margin:18px 0;font-size:clamp(48px,9vw,104px);line-height:.92;letter-spacing:-.06em}
.hero p{max-width:720px;font-size:clamp(18px,2vw,24px);line-height:1.5;color:#5f5f5f}
.actions{display:flex;gap:12px;align-items:center;margin-top:22px}
.secondary{padding:12px 18px;border:1px solid #d5d5d0;border-radius:14px;color:#111;text-decoration:none;background:#fff}
.feature-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.feature-grid article{padding:28px;border:1px solid #dddcd5;border-radius:22px;background:rgba(255,255,255,.75)}
.feature-grid span{font-size:12px;color:#888;font-weight:800}
.feature-grid h2{margin:38px 0 8px;font-size:24px}
.feature-grid p{margin:0;color:#686868;line-height:1.5}
.toast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,20px);opacity:0;pointer-events:none;padding:12px 16px;border-radius:999px;background:#111;color:#fff;transition:.2s}
.toast.visible{transform:translate(-50%,0);opacity:1}
@media(max-width:720px){.nav{padding:16px 18px}main{padding:28px 18px 72px}.hero{min-height:70vh}.feature-grid{grid-template-columns:1fr}h1{font-size:clamp(44px,14vw,76px)}}
`;
  }

  private appJs(): string {
    return `const toast=document.querySelector("#toast");
function showToast(message){toast.textContent=message;toast.classList.add("visible");window.setTimeout(()=>toast.classList.remove("visible"),2200)}
document.querySelectorAll("#openAction,#heroAction").forEach((button)=>button.addEventListener("click",()=>showToast("Your NEXUM preview is live.")));
`;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}
