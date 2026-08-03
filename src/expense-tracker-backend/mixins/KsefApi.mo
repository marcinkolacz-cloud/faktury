import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Int "mo:core/Int";
import AccessLib "../lib/access";

mixin (
  pendingInvoices : Map.Map<Text, Types.PendingInvoice>,
  accessRoles : Map.Map<Principal, Types.Role>,
  invoiceSharedToTeam : Map.Map<Text, Bool>,
  invoiceLineItems : Map.Map<Text, [Types.InvoiceLineItem]>,
  invoiceOneDriveLink : Map.Map<Text, Text>,
  moduleAccess : Map.Map<Principal, [Text]>,
) {
  public shared ({ caller }) func createManualInvoice(
    invoiceNumber : Text,
    issueDate : Text,
    sellerNip : Text,
    sellerName : Text,
    netAmount : Float,
    grossAmount : Float,
    vatAmount : Float,
    currency : Text,
  ) : async Text {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can add manual invoices"); };
    let ksefNumber = "MANUAL-" # Int.toText(Time.now());
    let invoice : Types.PendingInvoice = {
      ksefNumber;
      invoiceNumber;
      issueDate;
      sellerNip;
      sellerName;
      netAmount;
      grossAmount;
      vatAmount;
      currency;
      status = #pending;
      importedAt = Time.now();
    };
    pendingInvoices.add(ksefNumber, invoice);
    ksefNumber;
  };

  public shared ({ caller }) func importPendingInvoices(items : [Types.PendingInvoiceImportItem]) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import invoices"); };
    var count = 0;
    for (item in items.vals()) {
      switch (pendingInvoices.get(item.ksefNumber)) {
        case (?_) {};
        case null {
          let invoice : Types.PendingInvoice = {
            ksefNumber = item.ksefNumber;
            invoiceNumber = item.invoiceNumber;
            issueDate = item.issueDate;
            sellerNip = item.sellerNip;
            sellerName = item.sellerName;
            netAmount = item.netAmount;
            grossAmount = item.grossAmount;
            vatAmount = item.vatAmount;
            currency = item.currency;
            status = #pending;
            importedAt = Time.now();
          };
          pendingInvoices.add(item.ksefNumber, invoice);
          count += 1;
        };
      };
    };
    count;
  };

  public query ({ caller }) func listPendingInvoices() : async [Types.PendingInvoice] {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can view pending invoices"); };
    var result = List.empty<Types.PendingInvoice>();
    for ((_, inv) in pendingInvoices.entries()) {
      result.add(inv);
    };
    result.toArray();
  };

  public shared ({ caller }) func markInvoiceAddedToWarehouse(ksefNumber : Text) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can update invoices"); };
    switch (pendingInvoices.get(ksefNumber)) {
      case (?inv) { pendingInvoices.add(ksefNumber, { inv with status = #addedToWarehouse }); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func rejectPendingInvoice(ksefNumber : Text) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can update invoices"); };
    switch (pendingInvoices.get(ksefNumber)) {
      case (?inv) { pendingInvoices.add(ksefNumber, { inv with status = #rejected }); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func toggleShareInvoiceToTeam(ksefNumber : Text) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can share invoices"); };
    switch (pendingInvoices.get(ksefNumber)) {
      case (?_) {
        let current = switch (invoiceSharedToTeam.get(ksefNumber)) { case (?v) { v }; case null { false } };
        invoiceSharedToTeam.add(ksefNumber, not current);
        true;
      };
      case null { false };
    };
  };

  public query ({ caller }) func listSharedStatuses() : async [(Text, Bool)] {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can view this"); };
    var result = List.empty<(Text, Bool)>();
    for ((id, isShared) in invoiceSharedToTeam.entries()) {
      result.add((id, isShared));
    };
    result.toArray();
  };

  public query ({ caller }) func isInvoiceShared(ksefNumber : Text) : async Bool {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "ksef")) { Runtime.trap("Module access required: ksef"); };
    switch (invoiceSharedToTeam.get(ksefNumber)) { case (?v) { v }; case null { false } };
  };

  public query func isInvoiceSharedAnon(ksefNumber : Text) : async Bool {
    switch (invoiceSharedToTeam.get(ksefNumber)) { case (?v) { v }; case null { false } };
  };

  public shared ({ caller }) func restoreRejectedInvoice(ksefNumber : Text) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can restore invoices"); };
    switch (pendingInvoices.get(ksefNumber)) {
      case (?inv) { pendingInvoices.add(ksefNumber, { inv with status = #pending }); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func permanentlyDeletePendingInvoice(ksefNumber : Text) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can permanently delete"); };
    invoiceSharedToTeam.remove(ksefNumber);
    invoiceLineItems.remove(ksefNumber);
    invoiceOneDriveLink.remove(ksefNumber);
    switch (pendingInvoices.get(ksefNumber)) {
      case (?_) { pendingInvoices.remove(ksefNumber); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func addInvoiceToWarehouse(ksefNumber : Text, items : [Types.InvoiceLineItem], oneDriveLink : Text) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can add to warehouse"); };
    switch (pendingInvoices.get(ksefNumber)) {
      case (?inv) {
        pendingInvoices.add(ksefNumber, { inv with status = #addedToWarehouse });
        invoiceLineItems.add(ksefNumber, items);
        invoiceOneDriveLink.add(ksefNumber, oneDriveLink);
        true;
      };
      case null { false };
    };
  };

  public query ({ caller }) func getInvoiceDetails(ksefNumber : Text) : async (?[Types.InvoiceLineItem], ?Text) {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "ksef")) { Runtime.trap("Module access required: ksef"); };
    let isAdminCaller = AccessLib.isAdmin(accessRoles, caller);
    let isShared = switch (invoiceSharedToTeam.get(ksefNumber)) { case (?v) { v }; case null { false } };
    if (not isAdminCaller and not isShared) { Runtime.trap("Not authorized for this invoice"); };
    (invoiceLineItems.get(ksefNumber), invoiceOneDriveLink.get(ksefNumber));
  };

  public shared ({ caller }) func importPendingInvoicesFull(
    invoices : [Types.PendingInvoice],
    sharedStatuses : [(Text, Bool)],
    lineItemsData : [(Text, [Types.InvoiceLineItem])],
    links : [(Text, Text)],
  ) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for (inv in invoices.vals()) {
      switch (pendingInvoices.get(inv.ksefNumber)) {
        case (?_) {};
        case null { pendingInvoices.add(inv.ksefNumber, inv); count += 1; };
      };
    };
    for ((k, v) in sharedStatuses.vals()) {
      switch (invoiceSharedToTeam.get(k)) {
        case (?_) {};
        case null { invoiceSharedToTeam.add(k, v); };
      };
    };
    for ((k, v) in lineItemsData.vals()) {
      switch (invoiceLineItems.get(k)) {
        case (?_) {};
        case null { invoiceLineItems.add(k, v); };
      };
    };
    for ((k, v) in links.vals()) {
      switch (invoiceOneDriveLink.get(k)) {
        case (?_) {};
        case null { invoiceOneDriveLink.add(k, v); };
      };
    };
    count;
  };

  public query ({ caller }) func listSharedInvoices() : async [Types.PendingInvoice] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "ksef")) { Runtime.trap("Module access required: ksef"); };
    var result = List.empty<Types.PendingInvoice>();
    for ((id, inv) in pendingInvoices.entries()) {
      let isShared = switch (invoiceSharedToTeam.get(id)) { case (?v) { v }; case null { false } };
      if (isShared) { result.add(inv); };
    };
    result.toArray();
  };
};
