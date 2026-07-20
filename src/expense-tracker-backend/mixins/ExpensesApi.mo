import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";

mixin (
  expenses : Map.Map<Nat, Types.Expense>,
) {
  public shared ({ caller }) func createExpense(
    projectId : Nat,
    productService : Text,
    supplier : Text,
    serialNumber : Text,
    quantity : ?Nat,
    priceEur : ?Float,
    priceUsd : ?Float,
    pricePln : ?Float,
    priceNet : ?Float,
    orderDate : Text,
    paidBy : Text,
    invoiceNumber : Text,
    ksefNote : Text,
    note : Text,
  ) : async Nat {
    if (caller.isAnonymous()) { Runtime.trap("Anonymous caller not allowed"); };
    let newId = expenses.size();
    let expense : Types.Expense = {
      id = newId;
      projectId;
      productService;
      supplier;
      serialNumber;
      quantity;
      priceEur;
      priceUsd;
      pricePln;
      priceNet;
      orderDate;
      paid = false;
      paidBy;
      hasInvoice = false;
      invoiceNumber;
      confirmed = false;
      ksefNote;
      note;
      ownerId = caller;
    };
    expenses.add(newId, expense);
    newId;
  };

  public shared ({ caller }) func listMyExpenses() : async [Types.Expense] {
    if (caller.isAnonymous()) { Runtime.trap("Anonymous caller not allowed"); };
    var result = List.empty<Types.Expense>();
    for ((_, e) in expenses.entries()) {
      if (Principal.equal(e.ownerId, caller)) {
        result.add(e);
      };
    };
    result.toArray();
  };

  public shared ({ caller }) func togglePaid(id : Nat) : async Bool {
    if (caller.isAnonymous()) { Runtime.trap("Anonymous caller not allowed"); };
    switch (expenses.get(id)) {
      case (?e) {
        if (Principal.equal(e.ownerId, caller)) {
          expenses.add(id, { e with paid = not e.paid });
          true;
        } else { false };
      };
      case null { false };
    };
  };

  public shared ({ caller }) func toggleHasInvoice(id : Nat) : async Bool {
    if (caller.isAnonymous()) { Runtime.trap("Anonymous caller not allowed"); };
    switch (expenses.get(id)) {
      case (?e) {
        if (Principal.equal(e.ownerId, caller)) {
          expenses.add(id, { e with hasInvoice = not e.hasInvoice });
          true;
        } else { false };
      };
      case null { false };
    };
  };

  public shared ({ caller }) func toggleConfirmed(id : Nat) : async Bool {
    if (caller.isAnonymous()) { Runtime.trap("Anonymous caller not allowed"); };
    switch (expenses.get(id)) {
      case (?e) {
        if (Principal.equal(e.ownerId, caller)) {
          expenses.add(id, { e with confirmed = not e.confirmed });
          true;
        } else { false };
      };
      case null { false };
    };
  };

  public shared ({ caller }) func updateExpense(
    id : Nat,
    projectId : Nat,
    productService : Text,
    supplier : Text,
    serialNumber : Text,
    quantity : ?Nat,
    priceEur : ?Float,
    priceUsd : ?Float,
    pricePln : ?Float,
    priceNet : ?Float,
    orderDate : Text,
    paidBy : Text,
    invoiceNumber : Text,
    ksefNote : Text,
    note : Text,
  ) : async Bool {
    if (caller.isAnonymous()) { Runtime.trap("Anonymous caller not allowed"); };
    switch (expenses.get(id)) {
      case (?existing) {
        if (Principal.equal(existing.ownerId, caller)) {
          expenses.add(id, {
            existing with
            projectId; productService; supplier; serialNumber; quantity;
            priceEur; priceUsd; pricePln; priceNet; orderDate; paidBy;
            invoiceNumber; ksefNote; note;
          });
          true;
        } else { false };
      };
      case null { false };
    };
  };

  public shared ({ caller }) func deleteExpense(id : Nat) : async Bool {
    if (caller.isAnonymous()) { Runtime.trap("Anonymous caller not allowed"); };
    switch (expenses.get(id)) {
      case (?existing) {
        if (Principal.equal(existing.ownerId, caller)) {
          expenses.remove(id);
          true;
        } else { false };
      };
      case null { false };
    };
  };
};
