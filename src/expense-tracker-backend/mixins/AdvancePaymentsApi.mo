import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";

mixin (
  advancePayments : Map.Map<Nat, Types.AdvancePayment>,
) {
  public shared ({ caller }) func recordAdvancePayment(
    date : Text,
    amount : Float,
    currency : Text,
    note : Text,
  ) : async Nat {
    if (caller.isAnonymous()) { Runtime.trap("Anonymous caller not allowed"); };
    let newId = advancePayments.size();
    let payment : Types.AdvancePayment = {
      id = newId;
      date;
      amount;
      currency;
      note;
      createdAt = Time.now();
      ownerId = caller;
    };
    advancePayments.add(newId, payment);
    newId;
  };

  public shared ({ caller }) func listMyAdvancePayments() : async [Types.AdvancePayment] {
    if (caller.isAnonymous()) { Runtime.trap("Anonymous caller not allowed"); };
    var result = List.empty<Types.AdvancePayment>();
    for ((_, p) in advancePayments.entries()) {
      if (Principal.equal(p.ownerId, caller)) {
        result.add(p);
      };
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
    if (caller.isAnonymous()) { Runtime.trap("Anonymous caller not allowed"); };
    switch (advancePayments.get(id)) {
      case (?existing) {
        if (Principal.equal(existing.ownerId, caller)) {
          advancePayments.add(id, { existing with date; amount; currency; note });
          true;
        } else { false };
      };
      case null { false };
    };
  };

  public shared ({ caller }) func deleteAdvancePayment(id : Nat) : async Bool {
    if (caller.isAnonymous()) { Runtime.trap("Anonymous caller not allowed"); };
    switch (advancePayments.get(id)) {
      case (?existing) {
        if (Principal.equal(existing.ownerId, caller)) {
          advancePayments.remove(id);
          true;
        } else { false };
      };
      case null { false };
    };
  };
};
