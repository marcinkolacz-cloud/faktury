import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Blob "mo:core/Blob";
import Float "mo:core/Float";
import AccessLib "../lib/access";
import Sha256 "mo:sha2/Sha256";

// Gates changes to AI agent behaviour behind a second, per-admin password
// (separate from login). Once a principal verifies that password, the
// canister remembers them as "unlocked" (aiConfigUnlocked) so they don't
// have to retype it on every visit or every field save — nothing sensitive
// is ever stored client-side (no localStorage password), only a boolean
// tied to the IC-authenticated principal. Every accepted config change is
// still appended to an immutable audit log.
mixin (
  aiAgentConfig : Map.Map<Text, Types.AiAgentConfigEntry>,
  aiConfigPasswords : Map.Map<Principal, Blob>,
  aiConfigUnlocked : Map.Map<Principal, Bool>,
  aiConfigAuditLog : List.List<Types.AiConfigAuditEntry>,
  aiConfigAttempts : Map.Map<Principal, (Nat, Int)>,
  accessRoles : Map.Map<Principal, Types.Role>,
  moduleAccess : Map.Map<Principal, [Text]>,
) {
  func requireAdmin(caller : Principal) {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Admin access required"); };
  };

  // The config password (and the unlocked-flag it grants) is the real
  // security boundary here, not the app role — any logged-in staff member
  // with the "agent" module checked (and a password assigned to them by a
  // super-admin, via setAgentConfigPassword) can unlock and tune the agent.
  func requireStaff(caller : Principal) {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "agent")) { Runtime.trap("Module access required: agent"); };
  };

  func isUnlocked(caller : Principal) : Bool {
    aiConfigUnlocked.get(caller) == ?true;
  };

  func hashConfigPassword(caller : Principal, password : Text) : Blob {
    Sha256.fromBlob(#sha256, Text.encodeUtf8(Principal.toText(caller) # ":aiAgentConfig:" # password));
  };

  func describeValue(v : Types.AiAgentConfigValue) : Text {
    switch (v) {
      case (#bool(b)) { if (b) { "true" } else { "false" } };
      case (#text(t)) { t };
      case (#number(n)) { Float.toText(n) };
    };
  };

  // Rotating/assigning a password revokes any existing unlocked session for
  // that principal — they must re-verify with the new password.
  public shared ({ caller }) func setAgentConfigPassword(target : Principal, newPassword : Text) : async () {
    requireAdmin(caller);
    if (Text.size(newPassword) < 6) { Runtime.trap("Password must be at least 6 characters"); };
    aiConfigPasswords.add(target, hashConfigPassword(target, newPassword));
    aiConfigUnlocked.remove(target);
  };

  public query ({ caller }) func hasAgentConfigPassword() : async Bool {
    requireStaff(caller);
    aiConfigPasswords.get(caller) != null;
  };

  public query ({ caller }) func isAgentConfigUnlocked() : async Bool {
    requireStaff(caller);
    isUnlocked(caller);
  };

  func checkRateLimit(caller : Principal) {
    let now = Time.now();
    switch (aiConfigAttempts.get(caller)) {
      case (?(count, windowStart)) {
        if (now - windowStart > 900_000_000_000) {
          aiConfigAttempts.add(caller, (1, now));
        } else if (count >= 5) {
          Runtime.trap("Too many attempts, try again in 15 minutes");
        } else {
          aiConfigAttempts.add(caller, (count + 1, windowStart));
        };
      };
      case null { aiConfigAttempts.add(caller, (1, now)); };
    };
  };

  func verifyConfigPassword(caller : Principal, password : Text) : Bool {
    checkRateLimit(caller);
    switch (aiConfigPasswords.get(caller)) {
      case (?storedHash) { Blob.equal(storedHash, hashConfigPassword(caller, password)) };
      case null { false };
    };
  };

  // On success, marks the caller as unlocked from now on (until they
  // explicitly lock again or their password is rotated) — this is the only
  // place the password itself is ever checked.
  public shared ({ caller }) func verifyAgentConfigPasswordOnly(password : Text) : async Bool {
    requireStaff(caller);
    let ok = verifyConfigPassword(caller, password);
    if (ok) { aiConfigUnlocked.add(caller, true); };
    ok;
  };

  public shared ({ caller }) func lockAgentConfigForMe() : async () {
    requireStaff(caller);
    aiConfigUnlocked.remove(caller);
  };

  // Lets a super-admin instantly revoke ANY principal's unlocked state,
  // regardless of how they got unlocked or what their role/module access
  // is now — useful when someone was unlocked during earlier testing (e.g.
  // while they briefly had admin role) and later downgraded, since a role
  // or module change alone does NOT clear this flag (it's tracked
  // independently). This is the direct fix for that class of surprise.
  public shared ({ caller }) func adminForceLockAgentConfig(target : Principal) : async () {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Admin access required"); };
    aiConfigUnlocked.remove(target);
  };

  public shared ({ caller }) func setAgentConfigValue(key : Text, value : Types.AiAgentConfigValue) : async Bool {
    requireStaff(caller);
    if (not isUnlocked(caller)) { Runtime.trap("Locked — verify the AI agent configuration password first"); };
    let now = Time.now();
    let oldValueText = switch (aiAgentConfig.get(key)) {
      case (?e) { ?describeValue(e.value) };
      case null { null };
    };
    aiAgentConfig.add(key, { key; value; updatedBy = caller; updatedAt = now });
    aiConfigAuditLog.add({
      principal = caller;
      key;
      oldValue = oldValueText;
      newValue = describeValue(value);
      timestamp = now;
    });
    true;
  };

  public query ({ caller }) func listAgentConfig() : async [Types.AiAgentConfigEntry] {
    requireStaff(caller);
    var result = List.empty<Types.AiAgentConfigEntry>();
    for ((_, e) in aiAgentConfig.entries()) { result.add(e); };
    result.toArray();
  };

  public query ({ caller }) func getAgentConfigAuditLog() : async [Types.AiConfigAuditEntry] {
    requireStaff(caller);
    aiConfigAuditLog.toArray();
  };
};
