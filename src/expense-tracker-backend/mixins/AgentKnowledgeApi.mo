import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import AccessLib "../lib/access";

// Baza wiedzy agenta — krótkie, wielokrotnego użytku notatki wydestylowane
// automatycznie z zakończonych rozmów (frontend robi to cicho przy
// zamknięciu okna czatu, bez udziału człowieka). Wspólna dla całego
// zespołu — każdy z dostępem do modułu "agent" widzi te same wpisy, bo
// o to chodzi: agent ma z czasem "wiedzieć więcej" niezależnie z kim
// rozmawia, nie tylko z tą samą osobą.
mixin (
  knowledgeEntries : Map.Map<Nat, Types.KnowledgeEntry>,
  accessRoles : Map.Map<Principal, Types.Role>,
  moduleAccess : Map.Map<Principal, [Text]>,
) {
  func requireKnowledgeAccess(caller : Principal) {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "agent")) { Runtime.trap("Module access required: agent"); };
  };

  public shared ({ caller }) func addKnowledgeEntry(text : Text) : async Nat {
    requireKnowledgeAccess(caller);
    var maxId = 0;
    var any = false;
    for ((id, _) in knowledgeEntries.entries()) {
      if (not any or id >= maxId) { maxId := id; any := true; };
    };
    let newId = if (any) { maxId + 1 } else { 0 };
    knowledgeEntries.add(newId, { id = newId; text; addedBy = caller; addedAt = Time.now() });
    newId;
  };

  public query ({ caller }) func listKnowledgeEntries() : async [Types.KnowledgeEntry] {
    requireKnowledgeAccess(caller);
    var result = List.empty<Types.KnowledgeEntry>();
    for ((_, e) in knowledgeEntries.entries()) { result.add(e); };
    result.toArray();
  };

  // Admin-only cleanup — bad/duplicate auto-extracted notes shouldn't
  // require anyone but an admin to be able to remove.
  public shared ({ caller }) func deleteKnowledgeEntry(id : Nat) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Admin access required"); };
    switch (knowledgeEntries.get(id)) {
      case (?_) { knowledgeEntries.remove(id); true; };
      case null { false };
    };
  };
};
