import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import AccessLib "../lib/access";

mixin (
  orders : Map.Map<Nat, Types.Order>,
  ordersTrashed : Map.Map<Nat, Int>,
  folders : Map.Map<Nat, Types.Folder>,
  accessRoles : Map.Map<Principal, Types.Role>,
  moduleAccess : Map.Map<Principal, [Text]>,
) {
  func requireOrdersAccess(caller : Principal) {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "orders")) { Runtime.trap("Module access required: orders"); };
  };

  public shared ({ caller }) func createOrder(
    date : Text,
    name : Text,
    quantity : Float,
    supplierName : Text,
    totalAmount : Float,
    advanceAmount : Float,
    currency : Text,
    note : Text,
    createdBy : Text,
  ) : async Nat {
    requireOrdersAccess(caller);
    var maxId = 0;
    var any = false;
    for ((id, _) in orders.entries()) {
      if (not any or id >= maxId) { maxId := id; any := true; };
    };
    let newId = if (any) { maxId + 1 } else { 0 };
    let order : Types.Order = {
      id = newId;
      date;
      name;
      quantity;
      supplierName;
      totalAmount;
      advanceAmount;
      currency;
      note;
      status = #pending;
      driveFolderId = null;
      createdBy;
      createdAt = Time.now();
    };
    orders.add(newId, order);
    newId;
  };

  public shared ({ caller }) func updateOrder(
    id : Nat,
    date : Text,
    name : Text,
    quantity : Float,
    supplierName : Text,
    totalAmount : Float,
    advanceAmount : Float,
    currency : Text,
    note : Text,
  ) : async Bool {
    requireOrdersAccess(caller);
    switch (orders.get(id)) {
      case (?o) { orders.add(id, { o with date; name; quantity; supplierName; totalAmount; advanceAmount; currency; note }); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func updateOrderStatus(id : Nat, status : Types.OrderStatus) : async Bool {
    requireOrdersAccess(caller);
    switch (orders.get(id)) {
      case (?o) { orders.add(id, { o with status }); true; };
      case null { false };
    };
  };

  public query ({ caller }) func listOrders() : async [Types.Order] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "orders")) { Runtime.trap("Module access required: orders"); };
    var result = List.empty<Types.Order>();
    for ((id, o) in orders.entries()) {
      if (ordersTrashed.get(id) == null) { result.add(o); };
    };
    result.toArray();
  };

  public shared ({ caller }) func createDriveFolderForOrder(id : Nat, folderName : Text, parentId : ?Nat) : async ?Nat {
    requireOrdersAccess(caller);
    switch (orders.get(id)) {
      case null { null };
      case (?o) {
        var maxId = 0;
        var any = false;
        for ((fid, _) in folders.entries()) {
          if (not any or fid >= maxId) { maxId := fid; any := true; };
        };
        let newId = if (any) { maxId + 1 } else { 0 };
        folders.add(newId, { id = newId; name = folderName; parentId; createdBy = caller.toText(); createdAt = Time.now() });
        orders.add(id, { o with driveFolderId = ?newId });
        ?newId;
      };
    };
  };

  public shared ({ caller }) func linkOrderDriveFolder(id : Nat, folderId : Nat) : async Bool {
    requireOrdersAccess(caller);
    if (folders.get(folderId) == null) { return false; };
    switch (orders.get(id)) {
      case (?o) { orders.add(id, { o with driveFolderId = ?folderId }); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func unlinkOrderDriveFolder(id : Nat) : async Bool {
    requireOrdersAccess(caller);
    switch (orders.get(id)) {
      case (?o) { orders.add(id, { o with driveFolderId = null }); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func trashOrder(id : Nat) : async Bool {
    requireOrdersAccess(caller);
    switch (orders.get(id)) {
      case (?_) { ordersTrashed.add(id, Time.now()); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func restoreOrder(id : Nat) : async Bool {
    requireOrdersAccess(caller);
    switch (ordersTrashed.get(id)) {
      case (?_) { ordersTrashed.remove(id); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func permanentlyDeleteOrder(id : Nat) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can permanently delete"); };
    ordersTrashed.remove(id);
    switch (orders.get(id)) {
      case (?_) { orders.remove(id); true; };
      case null { false };
    };
  };

  public query ({ caller }) func listTrashedOrders() : async [Types.Order] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "orders")) { Runtime.trap("Module access required: orders"); };
    var result = List.empty<Types.Order>();
    for ((id, _) in ordersTrashed.entries()) {
      switch (orders.get(id)) {
        case (?o) { result.add(o); };
        case null {};
      };
    };
    result.toArray();
  };

  public shared ({ caller }) func importOrders(rows : [Types.Order]) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for (o in rows.vals()) {
      switch (orders.get(o.id)) {
        case (?_) {};
        case null { orders.add(o.id, o); count += 1; };
      };
    };
    count;
  };

  public shared ({ caller }) func importTrashedOrders(entries : [(Nat, Int)]) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for ((id, ts) in entries.vals()) {
      switch (ordersTrashed.get(id)) {
        case (?_) {};
        case null { ordersTrashed.add(id, ts); count += 1; };
      };
    };
    count;
  };
};
