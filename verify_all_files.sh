#!/bin/bash
cd /home/marcin/expense-tracker || exit 1
echo "=== BACKEND ==="
check() { grep -q "$2" "$1" 2>/dev/null && echo "OK   $1  ($2)" || echo "MISS $1  ($2)"; }

check src/expense-tracker-backend/types.mo "AiAgentConfigValue"
check src/expense-tracker-backend/types.mo "FlaggedAction"
check src/expense-tracker-backend/types.mo "ProjectTemplateTask"
check src/expense-tracker-backend/main.mo "AiAgentConfigApi(aiAgentConfig, aiConfigPasswords, aiConfigUnlocked"
check src/expense-tracker-backend/main.mo "ProjectTemplatesApi(projectTemplates"
check src/expense-tracker-backend/main.mo "FlaggedActionsApi(orders"
check src/expense-tracker-backend/mixins/AiAgentConfigApi.mo "verifyAgentConfigPasswordOnly"
check src/expense-tracker-backend/mixins/AiAgentConfigApi.mo "isAgentConfigUnlocked"
check src/expense-tracker-backend/mixins/AiAgentConfigApi.mo "lockAgentConfigForMe"
check src/expense-tracker-backend/mixins/FlaggedActionsApi.mo "getFlaggedActions"
check src/expense-tracker-backend/mixins/ProjectTemplatesApi.mo "requireProjectTemplatesAccess"
check src/expense-tracker-backend/lib/access.mo '"agent"'

echo ""
echo "=== FRONTEND ==="
check src/frontend/src/components/AiAgentConfigModule.tsx "isAgentConfigUnlocked"
check src/frontend/src/components/AiAgentConfigModule.tsx "lockAgentConfigForMe"
check src/frontend/src/components/AgentModule.tsx "ProjectTemplatesPanel"
check src/frontend/src/components/HomeScreen.tsx "Agent AI"
check src/frontend/src/components/Dashboard.tsx "FlaggedActionsPanel"
check src/frontend/src/App.tsx "AgentModule"
check src/frontend/src/components/ModuleCheckboxes.tsx '"agent"'
check src/frontend/src/components/AdminPanel.tsx "Generuj hasło"
check src/frontend/src/components/FlaggedActionsPanel.tsx "getFlaggedActions"
check src/frontend/src/components/ProjectTemplatesPanel.tsx "saveProjectTemplate"

echo ""
echo "=== mops.toml ==="
check mops.toml "sha2"
