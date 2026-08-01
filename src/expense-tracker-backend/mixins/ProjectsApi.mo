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
  projectsTrashed : Map.Map<Nat, Int>,
) {
  public shared ({ caller }) func createProject(name : Text) : async Nat {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    var maxId = 0;
    var any = false;
    for ((id, _) in projects.entries()) {
      if (not any or id >= maxId) { maxId := id; any := true; };
    };
    let newId = if (any) { maxId + 1 } else { 0 };
    let project : Types.Project = {
      id = newId;
      name;
      createdAt = Time.now();
    };
    projects.add(newId, project);
    newId;
  };

  public shared ({ caller }) func importProjects(rows : [Types.Project]) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for (p in rows.vals()) {
      projects.add(p.id, p);
      count += 1;
    };
    count;
  };

  public query ({ caller }) func listMyProjects() : async [Types.Project] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    var result = List.empty<Types.Project>();
    for ((id, p) in projects.entries()) {
      if (projectsTrashed.get(id) == null) { result.add(p); };
    };
    result.toArray();
  };

  public shared ({ caller }) func trashProject(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    switch (projects.get(id)) {
      case (?_) { projectsTrashed.add(id, Time.now()); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func restoreProject(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    switch (projectsTrashed.get(id)) {
      case (?_) { projectsTrashed.remove(id); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func permanentlyDeleteProject(id : Nat) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can permanently delete"); };
    projectsTrashed.remove(id);
    switch (projects.get(id)) {
      case (?_) { projects.remove(id); true; };
      case null { false };
    };
  };

  public query ({ caller }) func listTrashedProjects() : async [Types.Project] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    var result = List.empty<Types.Project>();
    for ((id, _) in projectsTrashed.entries()) {
      switch (projects.get(id)) {
        case (?p) { result.add(p); };
        case null {};
      };
    };
    result.toArray();
  };

  public query ({ caller }) func listTrashedProjectEntries() : async [(Nat, Int)] {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can view this"); };
    var result = List.empty<(Nat, Int)>();
    for ((id, ts) in projectsTrashed.entries()) { result.add((id, ts)); };
    result.toArray();
  };

  public shared ({ caller }) func importTrashedProjects(entries : [(Nat, Int)]) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for ((id, ts) in entries.vals()) { projectsTrashed.add(id, ts); count += 1; };
    count;
  };
};
