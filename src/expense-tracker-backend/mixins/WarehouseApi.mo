import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import AccessLib "../lib/access";

mixin (
  warehouseItems : Map.Map<Nat, Types.WarehouseItem>,
  stockMovements : Map.Map<Nat, Types.StockMovement>,
  accessRoles : Map.Map<Principal, Types.Role>,
) {
  public shared ({ caller }) func bulkImportWarehouseItems(
    items : [(Text, Text, Text, Bool, Bool, Float, Text)]
  ) : async { added : Nat; skipped : Nat } {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    var added = 0;
    var skipped = 0;
    for ((name, partDescription, category, fnpt2, trainer, qty, note) in items.vals()) {
      var exists = false;
      for ((_, existing) in warehouseItems.entries()) {
        if (existing.name == name) { exists := true; };
      };
      if (exists) {
        skipped += 1;
      } else {
        var maxId2 = 0;
        var any2 = false;
        for ((id, _) in warehouseItems.entries()) {
          if (not any2 or id >= maxId2) { maxId2 := id; any2 := true; };
        };
        let newId = if (any2) { maxId2 + 1 } else { 0 };
        let item : Types.WarehouseItem = {
          id = newId;
          name;
          partDescription;
          model = "";
          link = "";
          manufacturer = "";
          serialNo = "";
          category;
          isReplacementPart = false;
          appliesFnpt2 = fnpt2;
          appliesTrainer = trainer;
          location = "";
          note;
          currentQuantity = qty;
          createdAt = Time.now();
        };
        warehouseItems.add(newId, item);
        added += 1;
      };
    };
    { added; skipped };
  };

  public shared ({ caller }) func createWarehouseItem(
    name : Text,
    partDescription : Text,
    model : Text,
    link : Text,
    manufacturer : Text,
    serialNo : Text,
    category : Text,
    isReplacementPart : Bool,
    appliesFnpt2 : Bool,
    appliesTrainer : Bool,
    location : Text,
    note : Text,
  ) : async Nat {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    var maxId1 = 0;
    var any1 = false;
    for ((id, _) in warehouseItems.entries()) {
      if (not any1 or id >= maxId1) { maxId1 := id; any1 := true; };
    };
    let newId = if (any1) { maxId1 + 1 } else { 0 };
    let item : Types.WarehouseItem = {
      id = newId;
      name; partDescription; model; link; manufacturer; serialNo; category;
      isReplacementPart; appliesFnpt2; appliesTrainer; location; note;
      currentQuantity = 0.0;
      createdAt = Time.now();
    };
    warehouseItems.add(newId, item);
    newId;
  };

  public query ({ caller }) func listWarehouseItems() : async [Types.WarehouseItem] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    var result = List.empty<Types.WarehouseItem>();
    for ((_, i) in warehouseItems.entries()) {
      result.add(i);
    };
    result.toArray();
  };

  public query ({ caller }) func listWarehouseCategories() : async [Text] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    var seen = List.empty<Text>();
    for ((_, i) in warehouseItems.entries()) {
      var found = false;
      for (c in seen.values()) {
        if (c == i.category) { found := true; };
      };
      if (not found and i.category != "") { seen.add(i.category); };
    };
    seen.toArray();
  };

  public shared ({ caller }) func updateWarehouseItem(
    id : Nat,
    name : Text,
    partDescription : Text,
    model : Text,
    link : Text,
    manufacturer : Text,
    serialNo : Text,
    category : Text,
    isReplacementPart : Bool,
    appliesFnpt2 : Bool,
    appliesTrainer : Bool,
    location : Text,
    note : Text,
  ) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    switch (warehouseItems.get(id)) {
      case (?existing) {
        warehouseItems.add(id, {
          existing with
          name; partDescription; model; link; manufacturer; serialNo; category;
          isReplacementPart; appliesFnpt2; appliesTrainer; location; note;
        });
        true;
      };
      case null { false };
    };
  };

  public shared ({ caller }) func deleteWarehouseItem(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    switch (warehouseItems.get(id)) {
      case (?_) {
        warehouseItems.remove(id);
        true;
      };
      case null { false };
    };
  };

  public shared ({ caller }) func recordStockMovement(
    itemId : Nat,
    movementType : Types.MovementType,
    quantity : Float,
    projectId : ?Nat,
    performedBy : Text,
    date : Text,
    note : Text,
  ) : async ?Nat {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    switch (warehouseItems.get(itemId)) {
      case (?item) {
        let delta = switch (movementType) {
          case (#in_) { quantity };
          case (#out_) { -quantity };
        };
        let newQty = item.currentQuantity + delta;
        warehouseItems.add(itemId, { item with currentQuantity = newQty });

        var maxId3 = 0;
        var any3 = false;
        for ((id, _) in stockMovements.entries()) {
          if (not any3 or id >= maxId3) { maxId3 := id; any3 := true; };
        };
        let newId = if (any3) { maxId3 + 1 } else { 0 };
        let movement : Types.StockMovement = {
          id = newId;
          itemId;
          movementType;
          quantity;
          projectId;
          performedBy;
          date;
          note;
          createdAt = Time.now();
        };
        stockMovements.add(newId, movement);
        ?newId;
      };
      case null { null };
    };
  };

  public query ({ caller }) func listStockMovements() : async [Types.StockMovement] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    var result = List.empty<Types.StockMovement>();
    for ((_, m) in stockMovements.entries()) {
      result.add(m);
    };
    result.toArray();
  };

  public shared ({ caller }) func updateStockMovement(
    id : Nat,
    quantity : Float,
    projectId : ?Nat,
    performedBy : Text,
    date : Text,
    note : Text,
  ) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    switch (stockMovements.get(id)) {
      case (?m) {
        switch (warehouseItems.get(m.itemId)) {
          case (?item) {
            let revertDelta = switch (m.movementType) {
              case (#in_) { -m.quantity };
              case (#out_) { m.quantity };
            };
            let applyDelta = switch (m.movementType) {
              case (#in_) { quantity };
              case (#out_) { -quantity };
            };
            let newQty = item.currentQuantity + revertDelta + applyDelta;
            warehouseItems.add(m.itemId, { item with currentQuantity = newQty });
          };
          case null {};
        };
        stockMovements.add(id, { m with quantity; projectId; performedBy; date; note });
        true;
      };
      case null { false };
    };
  };

  public shared ({ caller }) func deleteStockMovement(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    switch (stockMovements.get(id)) {
      case (?m) {
        switch (warehouseItems.get(m.itemId)) {
          case (?item) {
            let delta = switch (m.movementType) {
              case (#in_) { -m.quantity };
              case (#out_) { m.quantity };
            };
            warehouseItems.add(m.itemId, { item with currentQuantity = item.currentQuantity + delta });
          };
          case null {};
        };
        stockMovements.remove(id);
        true;
      };
      case null { false };
    };
  };
};
