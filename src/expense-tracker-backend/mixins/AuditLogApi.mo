import List "mo:core/List";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Types "../types";
import AuditLib "../lib/audit";

mixin (
  auditLog : List.List<Types.AuditEntry>,
  isAdmin : Principal -> Bool,
) {
  public query ({ caller }) func listAuditLog() : async [Types.AuditEntry] {
    if (not isAdmin(caller)) { Runtime.trap("Only admin can view the audit log"); };
    AuditLib.listAll(auditLog);
  };
};
