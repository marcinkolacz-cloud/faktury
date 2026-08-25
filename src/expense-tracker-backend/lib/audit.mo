import List "mo:core/List";
import Array "mo:core/Array";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Types "../types";

module {
  public func record(
    log : List.List<Types.AuditEntry>,
    caller : Principal,
    action : Text,
    details : Text,
  ) {
    log.add({
      id = log.size();
      time = Time.now();
      byWhom = caller;
      action;
      details;
    });
  };

  // Newest first.
  public func listAll(log : List.List<Types.AuditEntry>) : [Types.AuditEntry] {
    let arr = log.toArray();
    let n = arr.size();
    Array.tabulate<Types.AuditEntry>(n, func(i) { arr[n - 1 - i] });
  };
};
