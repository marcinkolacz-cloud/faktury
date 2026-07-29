import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import AccessLib "../lib/access";

mixin (
  advancePayments : Map.Map<Nat, Types.AdvancePayment>,
  accessRoles : Map.Map<Principal, Types.Role>,
) {
  public query func adminCountAllPayments() : async Nat {
    advancePayments.size();
  };

  public shared ({ caller }) func recordAdvancePayment(
    date : Text,
    amount : Float,
    currency : Text,
    note : Text,
  ) : async Nat {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    let newId = advancePayments.size();
    let payment : Types.AdvancePayment = {
      id = newId;
      date;
      amount;
      currency;
      note;
      createdAt = Time.now();
    };
    advancePayments.add(newId, payment);
    newId;
  };

  public query ({ caller }) func listMyAdvancePayments() : async [Types.AdvancePayment] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    var result = List.empty<Types.AdvancePayment>();
    for ((_, p) in advancePayments.entries()) {
      result.add(p);
    };
    result.toArray();
  };

  public shared ({ caller }) func updateAdvancePayment(
    id : Nat,
    date : Text,
    amount : Float,
    currency : Text,
    note : Text,
  ) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    switch (advancePayments.get(id)) {
      case (?existing) {
        advancePayments.add(id, { existing with date; amount; currency; note });
        true;
      };
      case null { false };
    };
  };

  public shared ({ caller }) func deleteAdvancePayment(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    switch (advancePayments.get(id)) {
      case (?_) {
        advancePayments.remove(id);
        true;
      };
      case null { false };
    };
  };
};
