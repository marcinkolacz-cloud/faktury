import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import AccessLib "../lib/access";

// Manually-curated "co trzeba zrobić" checklists per project archetype
// (BAS pełny, TRA, BAS bez kabiny/ekranów), used to generate a build plan
// with a production schedule for a new project of that type. Deliberately
// no LLM/outcalls here — this is just structured data + a lookup, so it's
// free to read and only costs a normal update call to edit.
mixin (
  projectTemplates : Map.Map<Text, Types.ProjectTemplate>,
  aiConfigUnlocked : Map.Map<Principal, Bool>,
  accessRoles : Map.Map<Principal, Types.Role>,
  moduleAccess : Map.Map<Principal, [Text]>,
) {
  func requireProjectTemplatesAccess(caller : Principal) {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "agent")) { Runtime.trap("Module access required: agent"); };
  };

  // Editing reuses the same "unlocked" flag as the rest of the agent
  // config (verified once via verifyAgentConfigPasswordOnly), so calibrating
  // the checklist is protected the same way as calibrating agent behaviour.
  func requireProjectTemplatesUnlocked(caller : Principal) {
    requireProjectTemplatesAccess(caller);
    if (aiConfigUnlocked.get(caller) != ?true) {
      Runtime.trap("Locked — verify the AI agent configuration password first");
    };
  };

  public query ({ caller }) func listProjectTemplates() : async [Types.ProjectTemplate] {
    requireProjectTemplatesAccess(caller);
    var result = List.empty<Types.ProjectTemplate>();
    for ((_, t) in projectTemplates.entries()) { result.add(t); };
    result.toArray();
  };

  // Replaces the whole task list for a template key — the frontend edits
  // the full list client-side and submits it in one call, so there's a
  // single audit-free-but-atomic write instead of many partial ones.
  public shared ({ caller }) func saveProjectTemplate(
    key : Text,
    title : Text,
    tasks : [Types.ProjectTemplateTask],
  ) : async () {
    requireProjectTemplatesUnlocked(caller);
    projectTemplates.add(key, { key; title; tasks });
  };
};
