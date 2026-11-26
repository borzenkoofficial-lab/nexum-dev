export type AgentProfileStorage = "database" | "memory" | "unknown";

export function profileSaveNotice(storage: AgentProfileStorage): string {
  if (storage === "database") return "Профиль сохранён в базе данных аккаунта.";
  if (storage === "memory") return "Профиль сохранён в памяти сервера и может быть потерян после его перезапуска.";
  return "Профиль сохранён. Тип хранилища не подтверждён.";
}
