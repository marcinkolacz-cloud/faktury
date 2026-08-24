import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import AccessLib "../lib/access";

mixin (
  contracts : Map.Map<Nat, Types.Contract>,
  contractsTrashed : Map.Map<Nat, Int>,
  contractDriveFolders : Map.Map<Nat, Text>,
  accessRoles : Map.Map<Principal, Types.Role>,
  moduleAccess : Map.Map<Principal, [Text]>,
) {
  func requireContractsAccess(caller : Principal) {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "contracts")) { Runtime.trap("Module access required: contracts"); };
  };

  public shared ({ caller }) func createContract(
    title : Text,
    category : Text,
    counterparty : Text,
    description : Text,
    endDate : Text,
    createdBy : Text,
  ) : async Nat {
    requireContractsAccess(caller);
    var maxId = 0;
    var any = false;
    for ((id, _) in contracts.entries()) {
      if (not any or id >= maxId) { maxId := id; any := true; };
    };
    let newId = if (any) { maxId + 1 } else { 0 };
    let contract : Types.Contract = {
      id = newId;
      title;
      category;
      counterparty;
      description;
      endDate;
      driveFolderId = null;
      createdBy;
      createdAt = Time.now();
    };
    contracts.add(newId, contract);
    newId;
  };

  public shared ({ caller }) func updateContract(
    id : Nat,
    title : Text,
    category : Text,
    counterparty : Text,
    description : Text,
    endDate : Text,
  ) : async Bool {
    requireContractsAccess(caller);
    switch (contracts.get(id)) {
      case (?c) { contracts.add(id, { c with title; category; counterparty; description; endDate }); true; };
      case null { false };
    };
  };

  public query ({ caller }) func listContracts() : async [Types.Contract] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "contracts")) { Runtime.trap("Module access required: contracts"); };
    var result = List.empty<Types.Contract>();
    for ((id, c) in contracts.entries()) {
      if (contractsTrashed.get(id) == null) { result.add(c); };
    };
    result.toArray();
  };

  // Points at a real folder in OneDrive (Bartolini Drive), e.g. "Umowy/Umowa #3".
  // Stored in a separate map (contractDriveFolders) — see main.mo comment about not
  // retyping existing stable fields in place.
  public shared ({ caller }) func linkContractDriveFolder(id : Nat, path : Text) : async Bool {
    requireContractsAccess(caller);
    switch (contracts.get(id)) {
      case (?_) { contractDriveFolders.add(id, path); true; };
      case null { false };
    };
  };

  public query ({ caller }) func getContractDriveFolder(id : Nat) : async ?Text {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "contracts")) { Runtime.trap("Module access required: contracts"); };
    contractDriveFolders.get(id);
  };

  public shared ({ caller }) func unlinkContractDriveFolder(id : Nat) : async Bool {
    requireContractsAccess(caller);
    contractDriveFolders.remove(id);
    true;
  };

  public shared ({ caller }) func trashContract(id : Nat) : async Bool {
    requireContractsAccess(caller);
    switch (contracts.get(id)) {
      case (?_) { contractsTrashed.add(id, Time.now()); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func restoreContract(id : Nat) : async Bool {
    requireContractsAccess(caller);
    switch (contractsTrashed.get(id)) {
      case (?_) { contractsTrashed.remove(id); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func permanentlyDeleteContract(id : Nat) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can permanently delete"); };
    contractsTrashed.remove(id);
    switch (contracts.get(id)) {
      case (?_) { contracts.remove(id); true; };
      case null { false };
    };
  };

  public query ({ caller }) func listTrashedContracts() : async [Types.Contract] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "contracts")) { Runtime.trap("Module access required: contracts"); };
    var result = List.empty<Types.Contract>();
    for ((id, _) in contractsTrashed.entries()) {
      switch (contracts.get(id)) {
        case (?c) { result.add(c); };
        case null {};
      };
    };
    result.toArray();
  };

  public shared ({ caller }) func importContracts(rows : [Types.Contract], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for (c in rows.vals()) {
      switch (contracts.get(c.id)) {
        case (?_) { if (overwrite) { contracts.add(c.id, c); count += 1; }; };
        case null { contracts.add(c.id, c); count += 1; };
      };
    };
    count;
  };

  public shared ({ caller }) func importTrashedContracts(entries : [(Nat, Int)], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for ((id, ts) in entries.vals()) {
      switch (contractsTrashed.get(id)) {
        case (?_) { if (overwrite) { contractsTrashed.add(id, ts); count += 1; }; };
        case null { contractsTrashed.add(id, ts); count += 1; };
      };
    };
    count;
  };

  public query ({ caller }) func listTrashedContractEntries() : async [(Nat, Int)] {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can view this"); };
    var result = List.empty<(Nat, Int)>();
    for ((id, ts) in contractsTrashed.entries()) { result.add((id, ts)); };
    result.toArray();
  };
};
