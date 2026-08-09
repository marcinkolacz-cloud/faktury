import { useBackendActor } from "../lib/useBackend";
import { TopBar } from "./TopBar";
import { AiAgentConfigModule } from "./AiAgentConfigModule";
import { ProjectTemplatesPanel } from "./ProjectTemplatesPanel";

export function AgentModule({ onHome, onNavigate, currentModule }: { onHome: () => void; onNavigate: (m: string) => void; currentModule: string }) {
  const actor = useBackendActor();

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)]">
      <div className="max-w-[1600px] mx-auto p-6 space-y-6">
        <TopBar currentModule={currentModule} onNavigate={onNavigate} onHome={onHome} actor={actor} />
        <AiAgentConfigModule actor={actor} />
        <ProjectTemplatesPanel actor={actor} />
      </div>
    </div>
  );
}
