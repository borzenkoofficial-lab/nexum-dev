import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Tool, ToolResult } from "../types.js";
import { ProjectWorkspace } from "./workspace.js";

export class ScaffoldProjectTool implements Tool {
  name = "scaffoldProject";
  description = "Creates a complete zero-dependency web starter (index.html, style.css, app.js) from the user's brief.";

  constructor(private readonly workspace: ProjectWorkspace) {}

  async execute(input: string): Promise<ToolResult> {
    try {
      const brief = input.trim();
      const title = this.makeTitle(brief);
      const dir = await this.workspace.existing(".");
      await mkdir(dir, { recursive: true });

      const isReact = /react|vite|spa|single.?page|реакт|spa/i.test(brief);
      const files = isReact
        ? this.reactFiles(title, brief)
        : [
        ["index.html", this.indexHtml(title, brief)],
        ["style.css", this.styleCss()],
        ["app.js", this.appJs()],
        ] as const;

      for (const [path, content] of files) {
        const target = await this.workspace.writable(path);
        await writeFile(target, content, "utf8");
      }

      return {
        success: true,
        output: isReact ? `React/Vite scaffold created for “${title}”. Run npm install and npm run build to generate the production preview.` : `Scaffold created: index.html, style.css, app.js for “${title}”.`,
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
    const safeBrief = this.escapeHtml(brief || "A new product built with NEXUM.");
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
      ["src/App.jsx", 'export default function App(){return <main className="app"><span className="eyebrow">BUILT WITH NEXUM.DEV</span><h1>'+safeTitle+'</h1><p>'+safeBrief+'</p><button onClick={()=>alert("NEXUM preview is live")}>Get started</button></main>}\n'],
      ["src/styles.css", 'body{margin:0;font-family:Inter,system-ui,sans-serif;background:#f5f5f2;color:#111}.app{min-height:100vh;display:grid;place-content:center;max-width:900px;margin:auto;padding:40px}.eyebrow{font-size:12px;letter-spacing:.16em;font-weight:800;color:#777}h1{font-size:clamp(48px,9vw,96px);line-height:.92;letter-spacing:-.06em;margin:18px 0}p{font-size:20px;line-height:1.5;color:#666}button{border:0;border-radius:14px;padding:13px 20px;background:#111;color:white;font-weight:800;cursor:pointer}'],
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
    const safeBrief = this.escapeHtml(brief || "A new product built with NEXUM.");
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${safeBrief}">
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <header class="nav">
    <a class="brand" href="./">NEXUM</a>
    <button class="nav-button" id="openAction" type="button">Get started</button>
  </header>
  <main>
    <section class="hero">
      <span class="eyebrow">BUILT WITH NEXUM.DEV</span>
      <h1>${safeTitle}</h1>
      <p>${safeBrief}</p>
      <div class="actions">
        <button class="primary" id="heroAction" type="button">Start now</button>
        <a class="secondary" href="#features">Explore</a>
      </div>
    </section>
    <section id="features" class="feature-grid">
      <article><span>01</span><h2>Fast</h2><p>A clean foundation ready for the next build step.</p></article>
      <article><span>02</span><h2>Editable</h2><p>Every file lives inside your project workspace.</p></article>
      <article><span>03</span><h2>Live</h2><p>Changes can be opened immediately in Preview.</p></article>
    </section>
  </main>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <script src="./app.js"></script>
</body>
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
