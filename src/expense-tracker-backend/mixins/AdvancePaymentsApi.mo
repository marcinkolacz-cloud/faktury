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
  advancePaymentsTrashed : Map.Map<Nat, Int>,
) {
  public query ({ caller }) func adminCountAllPayments() : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Admin access required"); };
    advancePayments.size();
  };

  public shared ({ caller }) func recordAdvancePayment(
    date : Text,
    amount : Float,
    currency : Text,
    note : Text,
  ) : async Nat {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    var maxId = 0;
    var any = false;
    for ((id, _) in advancePayments.entries()) {
      if (not any or id >= maxId) { maxId := id; any := true; };
    };
    let newId = if (any) { maxId + 1 } else { 0 };
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

  public shared ({ caller }) func importAdvancePayments(rows : [Types.AdvancePayment]) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for (p in rows.vals()) {
      switch (advancePayments.get(p.id)) {
        case (?_) {};
        case null { advancePayments.add(p.id, p); count += 1; };
      };
    };
    count;
  };

  public query ({ caller }) func listMyAdvancePayments() : async [Types.AdvancePayment] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    var result = List.empty<Types.AdvancePayment>();
    for ((id, p) in advancePayments.entries()) {
      if (advancePaymentsTrashed.get(id) == null) { result.add(p); };
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

  public shared ({ caller }) func trashAdvancePayment(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    switch (advancePayments.get(id)) {
      case (?_) { advancePaymentsTrashed.add(id, Time.now()); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func restoreAdvancePayment(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    switch (advancePaymentsTrashed.get(id)) {
      case (?_) { advancePaymentsTrashed.remove(id); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func permanentlyDeleteAdvancePayment(id : Nat) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can permanently delete"); };
    advancePaymentsTrashed.remove(id);
    switch (advancePayments.get(id)) {
      case (?_) { advancePayments.remove(id); true; };
      case null { false };
    };
  };

  public query ({ caller }) func listTrashedAdvancePayments() : async [Types.AdvancePayment] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    var result = List.empty<Types.AdvancePayment>();
    for ((id, _) in advancePaymentsTrashed.entries()) {
      switch (advancePayments.get(id)) {
        case (?p) { result.add(p); };
        case null {};
      };
    };
    result.toArray();
  };

  public query ({ caller }) func listTrashedAdvancePaymentEntries() : async [(Nat, Int)] {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can view this"); };
    var result = List.empty<(Nat, Int)>();
    for ((id, ts) in advancePaymentsTrashed.entries()) { result.add((id, ts)); };
    result.toArray();
  };

  public shared ({ caller }) func importTrashedAdvancePayments(entries : [(Nat, Int)]) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for ((id, ts) in entries.vals()) {
      switch (advancePaymentsTrashed.get(id)) {
        case (?_) {};
        case null { advancePaymentsTrashed.add(id, ts); count += 1; };
      };
    };
    count;
  };
};
