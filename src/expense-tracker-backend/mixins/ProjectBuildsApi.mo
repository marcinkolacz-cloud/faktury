import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import AccessLib "../lib/access";

// Interaktywny postęp budowy widoczny dla CAŁEGO zespołu z dostępem do
// modułu "agent" (nie tylko admina — to operacyjne śledzenie, nie
// kalibracja agenta, więc nie wymaga hasła/odblokowania). Harmonogram
// generowany w ProjectTemplatesPanel jest tu zapisywany jako realny build,
// a każdy członek zespołu może aktualizować status poszczególnych zadań —
// dzięki temu widać opóźnienia (planned end minął, a zadanie nie #done).
mixin (
  projectBuilds : Map.Map<Nat, Types.ProjectBuild>,
  accessRoles : Map.Map<Principal, Types.Role>,
  moduleAccess : Map.Map<Principal, [Text]>,
) {
  func requireBuildsAccess(caller : Principal) {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "agent")) { Runtime.trap("Module access required: agent"); };
  };

  func requireBuildsWrite(caller : Principal) {
    requireBuildsAccess(caller);
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
  };

  public query ({ caller }) func listProjectBuilds() : async [Types.ProjectBuild] {
    requireBuildsAccess(caller);
    var result = List.empty<Types.ProjectBuild>();
    for ((_, b) in projectBuilds.entries()) { result.add(b); };
    result.toArray();
  };

  public shared ({ caller }) func createProjectBuild(
    projectCode : Text,
    templateKey : Text,
    startDate : Text,
    tasks : [Types.ProjectBuildTask],
  ) : async Nat {
    requireBuildsWrite(caller);
    var maxId = 0;
    var any = false;
    for ((id, _) in projectBuilds.entries()) { if (not any or id >= maxId) { maxId := id; any := true; }; };
    let newId = if (any) { maxId + 1 } else { 0 };
    projectBuilds.add(newId, {
      id = newId;
      projectCode;
      templateKey;
      startDate;
      tasks;
      createdAt = Time.now();
    });
    newId;
  };

  public shared ({ caller }) func updateProjectBuildTaskStatus(
    buildId : Nat,
    taskId : Nat,
    status : Types.BuildTaskStatus,
    actualEnd : ?Text,
  ) : async () {
    requireBuildsWrite(caller);
    switch (projectBuilds.get(buildId)) {
      case (?b) {
        var newTasks = List.empty<Types.ProjectBuildTask>();
        for (t in b.tasks.vals()) {
          if (t.id == taskId) {
            newTasks.add({ t with status; actualEnd });
          } else {
            newTasks.add(t);
          };
        };
        projectBuilds.add(buildId, { b with tasks = newTasks.toArray() });
      };
      case null { Runtime.trap("Build not found"); };
    };
  };

  public shared ({ caller }) func deleteProjectBuild(buildId : Nat) : async () {
    requireBuildsWrite(caller);
    projectBuilds.remove(buildId);
  };
};
