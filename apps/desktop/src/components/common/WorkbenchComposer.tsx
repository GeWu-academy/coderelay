import { useWorkbenchStore } from "../../stores/workbenchStore";
import { Composer } from "./Composer";

export interface WorkbenchComposerProps {
  compact?: boolean;
}

export function WorkbenchComposer({ compact = false }: WorkbenchComposerProps) {
  const form = useWorkbenchStore((s) => s.form);
  const running = useWorkbenchStore((s) => s.running);
  const discovery = useWorkbenchStore((s) => s.discovery);
  const setPrompt = useWorkbenchStore((s) => s.setPrompt);
  const setMode = useWorkbenchStore((s) => s.setMode);
  const setAgentModel = useWorkbenchStore((s) => s.setAgentModel);
  const setPermission = useWorkbenchStore((s) => s.setPermission);
  const startRun = useWorkbenchStore((s) => s.startRun);
  const cancelRun = useWorkbenchStore((s) => s.cancelRun);
  const previewRoute = useWorkbenchStore((s) => s.previewRoute);

  const agents = discovery?.agents ?? [];
  const selectedAgent = agents.find((agent) => agent.id === form.agent);

  return (
    <Composer
      compact={compact}
      prompt={form.prompt}
      onPromptChange={setPrompt}
      running={running}
      onStartRun={() => void startRun()}
      onCancelRun={() => void cancelRun()}
      mode={form.mode}
      routingModes={discovery?.routingModes ?? ["local"]}
      onModeChange={setMode}
      onPreviewRoute={() => void previewRoute()}
      agent={form.agent}
      model={form.model}
      onAgentModelChange={setAgentModel}
      permission={form.permission}
      permissions={discovery?.permissions ?? []}
      onPermissionChange={setPermission}
      agents={agents}
      catalogOptions={discovery?.catalog.options ?? []}
      selectedAgentLabel={selectedAgent?.label}
    />
  );
}
