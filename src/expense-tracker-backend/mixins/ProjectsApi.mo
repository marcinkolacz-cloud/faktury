import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";

mixin (
  projects : Map.Map<Nat, Types.Project>,
) {
  public shared ({ caller }) func createProject(name : Text) : async Nat {
    if (caller.isAnonymous()) { Runtime.trap("Anonymous caller not allowed"); };
    let newId = projects.size();
    let project : Types.Project = {
      id = newId;
      name;
      createdAt = Time.now();
      ownerId = caller;
    };
    projects.add(newId, project);
    newId;
  };

  public shared ({ caller }) func listMyProjects() : async [Types.Project] {
    if (caller.isAnonymous()) { Runtime.trap("Anonymous caller not allowed"); };
    var result = List.empty<Types.Project>();
    for ((_, p) in projects.entries()) {
      if (Principal.equal(p.ownerId, caller)) {
        result.add(p);
      };
    };
    result.toArray();
  };

  public shared ({ caller }) func deleteProject(id : Nat) : async Bool {
    if (caller.isAnonymous()) { Runtime.trap("Anonymous caller not allowed"); };
    switch (projects.get(id)) {
      case (?existing) {
        if (Principal.equal(existing.ownerId, caller)) {
          projects.remove(id);
          true;
        } else { false };
      };
      case null { false };
    };
  };
};
