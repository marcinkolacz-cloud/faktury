import Map "mo:core/Map";
import List "mo:core/List";
import Principal "mo:core/Principal";
import Types "../types";

module {
  public func hasAnyRole(roles : Map.Map<Principal, Types.Role>, caller : Principal) : Bool {
    roles.get(caller) != null;
  };

  public func hasWriteAccess(roles : Map.Map<Principal, Types.Role>, caller : Principal) : Bool {
    switch (roles.get(caller)) {
      case (?#write) { true };
      case (?#admin) { true };
      case (_) { false };
    };
  };

  public func isAdmin(roles : Map.Map<Principal, Types.Role>, caller : Principal) : Bool {
    switch (roles.get(caller)) {
      case (?#admin) { true };
      case (_) { false };
    };
  };

  public func listAccess(roles : Map.Map<Principal, Types.Role>) : [Types.AccessEntry] {
    var result = List.empty<Types.AccessEntry>();
    for ((p, r) in roles.entries()) {
      result.add({ principal = p; role = r; addedAt = 0 });
    };
    result.toArray();
  };

  public func getAllowedModules(
    moduleAccess : Map.Map<Principal, [Text]>,
    caller : Principal,
  ) : [Text] {
    switch (moduleAccess.get(caller)) {
      case (?modules) { modules };
      case null { ["invoices", "warehouse", "tickets", "ksef", "drive", "projects", "calendar", "orders", "contracts"] };
      // "agent" is deliberately excluded from this default-allow fallback.
      // Every other module here defaults to allowed for backward
      // compatibility (accounts created before per-module checkboxes
      // existed never got an explicit moduleAccess entry, and losing
      // access to invoices/warehouse/etc. on deploy would lock people out
      // of their daily work). The AI agent module is different: it grants
      // a chatbot with CRUD write access across every module below, so it
      // must be opt-in only — an account with no explicit moduleAccess
      // entry gets zero agent access until an admin checks the box.
    };
  };
  public func hasModuleAccess(
    moduleAccess : Map.Map<Principal, [Text]>,
    caller : Principal,
    moduleName : Text,
  ) : Bool {
    let allowed = getAllowedModules(moduleAccess, caller);
    var found = false;
    for (m in allowed.vals()) {
      if (m == moduleName) { found := true; };
    };
    found;
  };
};
