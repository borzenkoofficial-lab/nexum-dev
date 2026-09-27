      await mkdir(attachmentDir, { recursive: true });
      for (const attachment of attachments.slice(0, 5)) {
        const safeName = attachment.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "attachment";
        const target = resolve(attachmentDir, safeName);
        if (attachment.content !== undefined) {
          await writeFile(target, attachment.content.slice(0, 80_000), "utf8");
          attachmentContext.push(`Attached text file ${safeName}:\\n${attachment.content.slice(0, 80_000)}`);
        } else if (attachment.data) {
          await writeFile(target, Buffer.from(attachment.data, "base64"));
          attachmentContext.push(`Attached binary file ${safeName} is stored at .nexum/attachments/${jobId}/${safeName}.`);
        }
        attachmentNames.push(safeName);
      }
    }
    job.attachments = attachmentNames;
    const compactConversation = conversation
      .slice(-8)
      .map((item) => `${item.role === "user" ? "Пользователь" : "NEXUM"}: ${item.content.slice(0, 900)}`)
      .join("\n");
    const projectContext = [
      "PROJECT CONTEXT LOCK:",
      `Текущий проект: «${project.name}»`,
      `ID проекта: ${project.id}`,
      "Все действия, файлы, команды и ответы относятся ТОЛЬКО к этому проекту.",
      "Не переносить файлы, дизайн, контент или предположения из других проектов.",
      compactConversation ? `Последние сообщения ЭТОГО проекта:\n${compactConversation}` : "Предыдущих сообщений в этом проекте нет.",
    ].join("\n");
    const agentMessage = [
      projectContext,
      message,
      attachmentContext.length ? `ATTACHED FILES:\n${attachmentContext.join("\n\n")}` : "",
    ].filter(Boolean).join("\n\n");
    console.log("[Nexum] chat job started", jobId, project.id, project.path);
    const agent = new NexumAgent(aiGateway, project.path);
    const agentLoop = new AgentLoop(
      agent,
      aiGateway,
      undefined,
      (step) => {
        job.steps = [...(job.steps ?? []), step];
        job.updatedAt = Date.now();
      },
      (event) => {
        job.events = [...(job.events ?? []), event].slice(-100);
        job.currentMessage = event.message;
        if (event.type === "thinking") {
          job.stage =
            event.phase === "analyze" ? "analyzing" :
            event.phase === "plan" ? "planning" :
            event.phase === "implement" ? "editing" :
            event.phase === "validate" ? "building" :
            event.phase === "repair" ? "error" :
            event.phase === "verify" ? "testing" :
            event.phase === "finish" ? "completed" : "planning";
        }
        if (event.type === "tool-start") {
          if (event.tool === "listFiles" || event.tool === "readFile" || event.tool === "searchFiles") job.stage = "reading";
          else if (event.tool === "writeFile" || event.tool === "scaffoldProject") job.stage = "editing";
          else if (event.tool === "runSandbox" || event.tool === "runCommand") job.stage = /test/i.test(event.message) ? "testing" : "building";
        }
        if (event.type === "tool-error" || event.type === "failed") job.stage = "error";
        job.updatedAt = Date.now();
        void agentHistory.record({ type: "agent-event", jobId, projectId, provider, model, iteration: event.iteration, tool: event.tool, status: event.type, message: event.message });
        if (event.type === "tool-error" || event.type === "failed") {
          job.problems = [