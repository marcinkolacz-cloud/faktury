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
      case null { ["invoices", "warehouse", "tickets", "ksef", "drive"] };
    };
  };
};
