import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import InvitesLib "../lib/invites";
import AccessLib "../lib/access";

mixin (
  inviteCodes : Map.Map<Text, InvitesLib.InviteCode>,
  accessRoles : Map.Map<Principal, Types.Role>,
  moduleAccess : Map.Map<Principal, [Text]>,
  isAdmin : Principal -> Bool,
) {
  public shared ({ caller }) func generateInviteCode(role : Types.Role) : async Text {
    if (not isAdmin(caller)) { Runtime.trap("Only admin can generate codes"); };
    let code = await InvitesLib.generateRandomCode();
    inviteCodes.add(code, { code; role; createdAt = Time.now(); usedBy = null; usedAt = null });
    code;
  };

  public shared ({ caller }) func checkAccess(code : Text) : async Bool {
    if (caller.isAnonymous()) { Runtime.trap("Anonymous caller not allowed"); };
    switch (InvitesLib.checkAndUseCode(inviteCodes, code, caller)) {
      case (?role) {
        accessRoles.add(caller, role);
        true;
      };
      case null { false };
    };
  };

  public shared ({ caller }) func importInviteCodes(rows : [InvitesLib.InviteCode]) : async Nat {
    if (not isAdmin(caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for (c in rows.vals()) {
      switch (inviteCodes.get(c.code)) {
        case (?_) {};
        case null { inviteCodes.add(c.code, c); count += 1; };
      };
    };
    count;
  };

  public shared ({ caller }) func listInviteCodes() : async [InvitesLib.InviteCode] {
    if (not isAdmin(caller)) { Runtime.trap("Only admin can list codes"); };
    InvitesLib.listCodes(inviteCodes);
  };

  public shared ({ caller }) func revokeInviteCode(code : Text) : async Bool {
    if (not isAdmin(caller)) { Runtime.trap("Only admin can revoke codes"); };
    InvitesLib.revokeCode(inviteCodes, code);
  };

  public query ({ caller }) func isCallerGranted() : async Bool {
    AccessLib.hasAnyRole(accessRoles, caller);
  };

  public query ({ caller }) func getCallerRole() : async ?Types.Role {
    accessRoles.get(caller);
  };

  public shared ({ caller }) func listAccessEntries() : async [Types.AccessEntry] {
    if (not isAdmin(caller)) { Runtime.trap("Only admin can list access"); };
    AccessLib.listAccess(accessRoles);
  };

  public shared ({ caller }) func changeAccessRole(target : Principal, role : Types.Role) : async Bool {
    if (not isAdmin(caller)) { Runtime.trap("Only admin can change roles"); };
    accessRoles.add(target, role);
    true;
  };

  public shared ({ caller }) func revokeAccess(target : Principal) : async Bool {
    if (not isAdmin(caller)) { Runtime.trap("Only admin can revoke access"); };
    accessRoles.remove(target);
    moduleAccess.remove(target);
    true;
  };

  public query ({ caller }) func getMyModules() : async [Text] {
    AccessLib.getAllowedModules(moduleAccess, caller);
  };

  public shared ({ caller }) func setUserModules(target : Principal, modules : [Text]) : async Bool {
    if (not isAdmin(caller)) { Runtime.trap("Only admin can set modules"); };
    moduleAccess.add(target, modules);
    true;
  };

  public query ({ caller }) func getUserModules(target : Principal) : async [Text] {
    if (not isAdmin(caller)) { Runtime.trap("Only admin can view modules"); };
    AccessLib.getAllowedModules(moduleAccess, target);
  };
};
