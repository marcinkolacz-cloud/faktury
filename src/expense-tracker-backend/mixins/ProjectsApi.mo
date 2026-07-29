import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import AccessLib "../lib/access";

mixin (
  projects : Map.Map<Nat, Types.Project>,
  accessRoles : Map.Map<Principal, Types.Role>,
) {
  public shared ({ caller }) func createProject(name : Text) : async Nat {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    let newId = projects.size();
    let project : Types.Project = {
      id = newId;
      name;
      createdAt = Time.now();
    };
    projects.add(newId, project);
    newId;
  };

  public query ({ caller }) func listMyProjects() : async [Types.Project] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    var result = List.empty<Types.Project>();
    for ((_, p) in projects.entries()) {
      result.add(p);
    };
    result.toArray();
  };

  public shared ({ caller }) func deleteProject(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    switch (projects.get(id)) {
      case (?_) {
        projects.remove(id);
        true;
      };
      case null { false };
    };
  };
};
