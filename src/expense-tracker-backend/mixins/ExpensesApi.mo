import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import Time "mo:core/Time";
import AccessLib "../lib/access";

mixin (
  expenses : Map.Map<Nat, Types.Expense>,
  accessRoles : Map.Map<Principal, Types.Role>,
  expenseKsefSent : Map.Map<Nat, Bool>,
  expensesTrashed : Map.Map<Nat, Int>,
  moduleAccess : Map.Map<Principal, [Text]>,
) {
  public shared ({ caller }) func adminClearAllExpenses() : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can clear expenses"); };
    // SAFETY: this used to hard-delete every expense with no recovery path
    // (expenses.clear()). It now moves everything to trash instead, so a
    // misclick or compromised admin session can be undone via
    // restoreExpense, consistent with how every other entity in this app
    // handles deletion.
    var count = 0;
    for ((id, _) in expenses.entries()) {
      if (expensesTrashed.get(id) == null) {
        expensesTrashed.add(id, Time.now());
        count += 1;
      };
    };
    count;
  };

  public query ({ caller }) func adminCountAllExpenses() : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Admin access required"); };
    expenses.size();
  };

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
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "invoices")) { Runtime.trap("Module access required: invoices"); };
    var maxId = 0;
    var any = false;
    for ((id, _) in expenses.entries()) {
      if (not any or id >= maxId) { maxId := id; any := true; };
    };
    let newId = if (any) { maxId + 1 } else { 0 };
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
    };
    expenses.add(newId, expense);
    newId;
  };

  public shared ({ caller }) func bulkImportExpenses(
    rows : [(Nat, Text, Text, ?Float, ?Float, Text, Text, Text, Text, Bool, Bool, Bool)]
  ) : async Nat {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "invoices")) { Runtime.trap("Module access required: invoices"); };
    var count = 0;
    for ((projectId, productService, supplier, pricePln, priceNet, orderDate, paidBy, invoiceNumber, note, paid, hasInvoice, confirmed) in rows.vals()) {
      var maxId = 0;
      var any = false;
      for ((id, _) in expenses.entries()) {
        if (not any or id >= maxId) { maxId := id; any := true; };
      };
      let newId = if (any) { maxId + 1 } else { 0 };
      let expense : Types.Expense = {
        id = newId;
        projectId;
        productService;
        supplier;
        serialNumber = "";
        quantity = null;
        priceEur = null;
        priceUsd = null;
        pricePln;
        priceNet;
        orderDate;
        paid;
        paidBy;
        hasInvoice;
        invoiceNumber;
        confirmed;
        ksefNote = "";
        note;
      };
      expenses.add(newId, expense);
      count += 1;
    };
    count;
  };

  public shared ({ caller }) func importExpenses(rows : [Types.Expense], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for (e in rows.vals()) {
      switch (expenses.get(e.id)) {
        case (?_) { if (overwrite) { expenses.add(e.id, e); count += 1; }; };
        case null { expenses.add(e.id, e); count += 1; };
      };
    };
    count;
  };

  public shared ({ caller }) func importExpenseKsefSent(rows : [(Nat, Bool)], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for ((id, sent) in rows.vals()) {
      switch (expenseKsefSent.get(id)) {
        case (?_) { if (overwrite) { expenseKsefSent.add(id, sent); count += 1; }; };
        case null { expenseKsefSent.add(id, sent); count += 1; };
      };
    };
    count;
  };

  public query ({ caller }) func listMyExpenses() : async [Types.Expense] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "invoices")) { Runtime.trap("Module access required: invoices"); };
    var result = List.empty<Types.Expense>();
    for ((id, e) in expenses.entries()) {
      if (expensesTrashed.get(id) == null) { result.add(e); };
    };
    result.toArray();
  };

  public shared ({ caller }) func togglePaid(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "invoices")) { Runtime.trap("Module access required: invoices"); };
    switch (expenses.get(id)) {
      case (?e) {
        expenses.add(id, { e with paid = not e.paid });
        true;
      };
      case null { false };
    };
  };

  public shared ({ caller }) func toggleKsefSent(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "invoices")) { Runtime.trap("Module access required: invoices"); };
    switch (expenses.get(id)) {
      case (?_) {
        let current = switch (expenseKsefSent.get(id)) { case (?v) { v }; case null { false } };
        expenseKsefSent.add(id, not current);
        true;
      };
      case null { false };
    };
  };

  public query ({ caller }) func listExpenseKsefSent() : async [(Nat, Bool)] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "invoices")) { Runtime.trap("Module access required: invoices"); };
    var result = List.empty<(Nat, Bool)>();
    for ((id, sent) in expenseKsefSent.entries()) {
      result.add((id, sent));
    };
    result.toArray();
  };

  public shared ({ caller }) func toggleHasInvoice(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "invoices")) { Runtime.trap("Module access required: invoices"); };
    switch (expenses.get(id)) {
      case (?e) {
        expenses.add(id, { e with hasInvoice = not e.hasInvoice });
        true;
      };
      case null { false };
    };
  };

  public shared ({ caller }) func toggleConfirmed(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "invoices")) { Runtime.trap("Module access required: invoices"); };
    switch (expenses.get(id)) {
      case (?e) {
        expenses.add(id, { e with confirmed = not e.confirmed });
        true;
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
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "invoices")) { Runtime.trap("Module access required: invoices"); };
    switch (expenses.get(id)) {
      case (?existing) {
        expenses.add(id, {
          existing with
          projectId; productService; supplier; serialNumber; quantity;
          priceEur; priceUsd; pricePln; priceNet; orderDate; paidBy;
          invoiceNumber; ksefNote; note;
        });
        true;
      };
      case null { false };
    };
  };

  public shared ({ caller }) func trashExpense(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "invoices")) { Runtime.trap("Module access required: invoices"); };
    switch (expenses.get(id)) {
      case (?_) { expensesTrashed.add(id, Time.now()); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func restoreExpense(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "invoices")) { Runtime.trap("Module access required: invoices"); };
    switch (expensesTrashed.get(id)) {
      case (?_) { expensesTrashed.remove(id); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func permanentlyDeleteExpense(id : Nat) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can permanently delete"); };
    expensesTrashed.remove(id);
    switch (expenses.get(id)) {
      case (?_) { expenses.remove(id); true; };
      case null { false };
    };
  };

  public query ({ caller }) func listTrashedExpenses() : async [Types.Expense] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "invoices")) { Runtime.trap("Module access required: invoices"); };
    var result = List.empty<Types.Expense>();
    for ((id, _) in expensesTrashed.entries()) {
      switch (expenses.get(id)) {
        case (?e) { result.add(e); };
        case null {};
      };
    };
    result.toArray();
  };

  public query ({ caller }) func listTrashedExpenseEntries() : async [(Nat, Int)] {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can view this"); };
    var result = List.empty<(Nat, Int)>();
    for ((id, ts) in expensesTrashed.entries()) { result.add((id, ts)); };
    result.toArray();
  };

  public shared ({ caller }) func importTrashedExpenses(entries : [(Nat, Int)], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for ((id, ts) in entries.vals()) {
      switch (expensesTrashed.get(id)) {
        case (?_) { if (overwrite) { expensesTrashed.add(id, ts); count += 1; }; };
        case null { expensesTrashed.add(id, ts); count += 1; };
      };
    };
    count;
  };
};
