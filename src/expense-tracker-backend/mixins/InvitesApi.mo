import Map "mo:core/Map";
import Set "mo:core/Set";
import Types "../types";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import InvitesLib "../lib/invites";

mixin (
  inviteCodes : Map.Map<Text, InvitesLib.InviteCode>,
  grantedPrincipals : Set.Set<Principal>,
  isAdmin : Principal -> Bool,
) {
  public shared ({ caller }) func generateInviteCode() : async Text {
    if (not isAdmin(caller)) { Runtime.trap("Only admin can generate codes"); };
    let code = await InvitesLib.generateRandomCode();
    inviteCodes.add(code, { code; createdAt = 0; usedBy = null; usedAt = null });
    code;
  };

  public shared ({ caller }) func checkAccess(code : Text) : async Bool {
    if (caller.isAnonymous()) { Runtime.trap("Anonymous caller not allowed"); };
    let ok = InvitesLib.checkAndUseCode(inviteCodes, code, caller);
    if (ok) { grantedPrincipals.add(caller); };
    ok;
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
    grantedPrincipals.contains(caller);
  };
};
