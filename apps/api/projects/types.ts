export type ProjectStatus = "active" | "archived";

export interface Project {
  id: string;
  name: string;
  path: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectStore {
  projects: Project[];
  activeProjectId: string;
}
