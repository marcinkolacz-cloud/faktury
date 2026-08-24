import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import AccessLib "../lib/access";

mixin (
  emailSubscribers : Map.Map<Nat, Types.Subscriber>,
  accessRoles : Map.Map<Principal, Types.Role>,
  moduleAccess : Map.Map<Principal, [Text]>,
) {
  func requireSubscribersAccess(caller : Principal) {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "emailSubscribers")) { Runtime.trap("Module access required: emailSubscribers"); };
  };

  public shared ({ caller }) func addSubscriber(email : Text, name : Text, notifyUrgent : Bool) : async Nat {
    requireSubscribersAccess(caller);
    var maxId = 0;
    var any = false;
    for ((id, _) in emailSubscribers.entries()) {
      if (not any or id >= maxId) { maxId := id; any := true; };
    };
    let newId = if (any) { maxId + 1 } else { 0 };
    let sub : Types.Subscriber = { id = newId; email; name; notifyUrgent; createdAt = Time.now() };
    emailSubscribers.add(newId, sub);
    newId;
  };

  public shared ({ caller }) func updateSubscriber(id : Nat, email : Text, name : Text, notifyUrgent : Bool) : async Bool {
    requireSubscribersAccess(caller);
    switch (emailSubscribers.get(id)) {
      case (?s) { emailSubscribers.add(id, { s with email; name; notifyUrgent }); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func setSubscriberNotifyUrgent(id : Nat, notifyUrgent : Bool) : async Bool {
    requireSubscribersAccess(caller);
    switch (emailSubscribers.get(id)) {
      case (?s) { emailSubscribers.add(id, { s with notifyUrgent }); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func removeSubscriber(id : Nat) : async Bool {
    requireSubscribersAccess(caller);
    switch (emailSubscribers.get(id)) {
      case (?_) { emailSubscribers.remove(id); true; };
      case null { false };
    };
  };

  public query ({ caller }) func listSubscribers() : async [Types.Subscriber] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "emailSubscribers")) { Runtime.trap("Module access required: emailSubscribers"); };
    var result = List.empty<Types.Subscriber>();
    for ((_, s) in emailSubscribers.entries()) { result.add(s); };
    result.toArray();
  };

  // Used by the "urgent notify" send flow: only addresses with the checkbox
  // enabled receive the broadcast. Any staff member with module access may
  // read this (needed to trigger the send), not just admins.
  public query ({ caller }) func getUrgentEmails() : async [Text] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "emailSubscribers")) { Runtime.trap("Module access required: emailSubscribers"); };
    var result = List.empty<Text>();
    for ((_, s) in emailSubscribers.entries()) {
      if (s.notifyUrgent) { result.add(s.email); };
    };
    result.toArray();
  };

  public shared ({ caller }) func importSubscribers(rows : [Types.Subscriber], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for (s in rows.vals()) {
      switch (emailSubscribers.get(s.id)) {
        case (?_) { if (overwrite) { emailSubscribers.add(s.id, s); count += 1; }; };
        case null { emailSubscribers.add(s.id, s); count += 1; };
      };
    };
    count;
  };
};
